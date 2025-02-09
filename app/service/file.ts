import pick from 'lodash/pick';
import fse from 'fs-extra';
import fs_, { promises as fs } from 'fs';
import * as path from 'path';
import { TextDecoder, TextEncoder } from 'util';
import { Readable } from 'stream';

import { IChampionBuild, IChampionCdnDataItem, IFileResult } from '@interfaces/commonTypes';
import { appConfig } from './config';

const ItemSetProps = [
  'title',
  'type',
  'associatedMaps',
  'associatedChampions',
  'map',
  'mode',
  'preferredItemSlots',
  'sortrank',
  'startedFrom',
  'blocks',
];

export const utf8ToGb18030 = (str: string) => {
  const uint8array = new TextEncoder().encode(str);
  const ret = new TextDecoder(`gb18030`).decode(uint8array);
  return ret;
};

export const makeBuildFile = (
  { fileName, title, championId, champion, blocks, position = `` }: IChampionBuild,
  aramOnly = false,
) => ({
  fileName,
  title,
  key: champion.toLowerCase(),
  champion: champion,
  position,

  type: 'custom',
  associatedMaps: aramOnly ? [12] : [11, 12],
  associatedChampions: [+championId],
  map: 'any',
  mode: 'any',
  preferredItemSlots: [],
  sortrank: 1,
  startedFrom: 'blank',

  blocks: blocks.filter(Boolean),
});

export const saveToFile = async (
  desDir: string,
  data: IChampionBuild,
  stripProps = true,
  sortrank: number,
): Promise<IFileResult | Error> => {
  try {
    const appendGameToDir = appConfig.get(`appendGameToDir`);
    const hasCjkChar = appConfig.get(`lolDirHasCJKChar`);

    const tencentFile = `${desDir}/Game/Config/Champions/${data.champion}/Recommended/${sortrank}_${data.fileName}.json`;
    const riotFile = `${desDir}/Config/Champions/${data.champion}/Recommended/${sortrank}_${data.fileName}.json`;
    const content = stripProps ? pick(data, ItemSetProps) : data;

    await Promise.all([
      fse.outputFile(tencentFile, JSON.stringify(content, null, 4)),
      fse.outputFile(riotFile, JSON.stringify(content, null, 4)),
    ]);

    if (appendGameToDir && hasCjkChar) {
      const cnFile = utf8ToGb18030(tencentFile);
      await fse.outputFile(cnFile, JSON.stringify(content, null, 4));
    }

    return {
      champion: data.champion,
      position: data.position,
    };
  } catch (error) {
    return error;
  }
};

export const removeFolderContent = async (dir: string) => {
  try {
    await fse.emptyDir(dir);
    return true;
  } catch (error) {
    return error;
  }
};

export const getLatestLogFile = async (dir: string) => {
  try {
    const files = await fs.readdir(dir);
    const latest = files
      .filter((f: string) => f.includes(`renderer.log`))
      .sort((a: string, b: string) => a.localeCompare(b))
      .pop();
    const info = await fs.stat(`${dir}/${latest}`);
    return info;
  } catch (err) {
    return;
  }
};

const authReg = /https:\/\/riot:.+@127\.0\.0\.1:\d+\/index.html/;

export const getLcuTokenFromLog = async (dirPath: string) => {
  const appendGameToDir = appConfig.get(`appendGameToDir`);
  const dir = `${appendGameToDir ? `${dirPath}/Game` : dirPath}/Logs/LeagueClient Logs`;

  try {
    const files = await fs.readdir(dir);
    const rendererLogs = files
      .filter((f: string) => f.includes(`renderer.log`))
      .sort((a: string, b: string) => b.localeCompare(a));

    let content = '';
    for (const f of rendererLogs) {
      content = await fs.readFile(`${dir}/${f}`, 'utf8');
      if (authReg.test(content)) {
        console.info(`target log file is: `, `${dir}/${f}`);
        break;
      }
      continue;
    }

    if (!content) {
      console.error(`[LCU] cannot find target renderer log.`);
      return [null, null, null];
    }

    const url = content.match(/https(.*)\/index\.html/)?.[1] ?? ``;
    const token = url.match(/riot:(.*)@/)?.[1] ?? null;
    const port = url.match(/:(\d+)$/)?.[1] ?? null;
    const urlWithAuth = `https${url}`;

    return [token, port, urlWithAuth];
  } catch (err) {
    return [null, null, null];
  }
};

export const getLcuToken = async (dirPath: string) => {
  const appendGameToDir = appConfig.get(`appendGameToDir`); // if lcu is CN client
  const lockfilePath = path.join(dirPath, appendGameToDir ? 'LeagueClient' : '', 'lockfile');

  try {
    const lockfile = await fs.readFile(lockfilePath, 'utf8');
    const port = lockfile.split(`:`)[2];
    const token = lockfile.split(`:`)[3];
    const url = `://riot:${token}@127.0.0.1:${port}`;
    const urlWithAuth = `https${url}`;

    return [token, port, urlWithAuth];
  } catch (err) {
    return [null, null, null];
  }
};

export function bufferToStream(b: Buffer) {
  return new Readable({
    read() {
      this.push(Buffer.from(b));
      this.push(null);
    },
  });
}

export async function updateDirStats(dir: string, version: string = ``) {
  try {
    let files = await fs.readdir(dir);
    let tasks = files.map(f => {
      return new Promise((resolve) => {
        fs_.stat(path.join(dir, f), (err, stats) => {
          if (err) {
            resolve([f, 0]);
            return;
          }

          resolve([f, stats.mtime.getTime()]);
        });
      });
    });
    let arr = await Promise.all(tasks);
    let ret: { [f: string]: number | string } = {
      version,
    };
    for (let i of arr) {
      const [name, mtime] = i as [string, number];
      ret[name] = mtime;
    }
    await fse.writeJSON(path.join(dir, '.stats'), ret);
    console.log(`[npm] updated file stats, ${arr.length} files in ${dir}`);
    return ret;
  } catch (e) {
    console.error(e);
  }
}

export async function getAllFileContent(dir: string): Promise<IChampionCdnDataItem[][]> {
  try {
    let files = await fs.readdir(dir);
    let tasks = files.filter(i => i !== `index.json` && i !== `package.json` && i.endsWith(`.json`)).map(f => {
      return fse.readJSON(path.join(dir, f));
    });
    return await Promise.all(tasks);
  } catch (e) {
    console.error(e);
    return Promise.reject(e);
  }
}
