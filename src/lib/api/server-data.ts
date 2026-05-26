/**
 * Server-side scenario JSON loader with module-scope caching.
 *
 * The frontend's `src/lib/data.ts` uses `fetch('/data/...')` which only works
 * in the browser. API routes (Node runtime) instead read directly from the
 * project's `public/data/` directory.
 *
 * Game type namespacing:
 *   gameType='mtt'         → public/data/{name}.json           (root, legacy)
 *   gameType='6max_100bb'  → public/data/6max_100bb/{name}.json (subdir)
 *
 * Cache lifetime = process lifetime. Vercel cold-starts hit `fs.readFile` +
 * `JSON.parse` once per (gameType, scenario) per instance; subsequent reads
 * are free.
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { IndexData, ScenarioData, Chart } from '../types';

export type GameType = 'mtt' | '6max_100bb';
export const GAME_TYPES: readonly GameType[] = ['mtt', '6max_100bb'];
export const DEFAULT_GAME_TYPE: GameType = 'mtt';

export function isGameType(s: string): s is GameType {
  return (GAME_TYPES as readonly string[]).includes(s);
}

const DATA_ROOT = path.join(process.cwd(), 'public', 'data');

function dataDirFor(gameType: GameType): string {
  return gameType === 'mtt' ? DATA_ROOT : path.join(DATA_ROOT, gameType);
}

function cacheKey(gameType: GameType, name: string): string {
  return `${gameType}::${name}`;
}

const indexCache: Map<GameType, IndexData> = new Map();
const indexPromises: Map<GameType, Promise<IndexData>> = new Map();
const scenarioCache: Map<string, ScenarioData> = new Map();
const scenarioPromises: Map<string, Promise<ScenarioData | null>> = new Map();

/** Atomically load and cache the global index.json for a game type. */
export async function loadIndex(gameType: GameType = DEFAULT_GAME_TYPE): Promise<IndexData> {
  const cached = indexCache.get(gameType);
  if (cached) return cached;
  const existing = indexPromises.get(gameType);
  if (existing) return existing;
  const promise = (async () => {
    const raw = await fs.readFile(path.join(dataDirFor(gameType), 'index.json'), 'utf-8');
    const parsed = JSON.parse(raw) as IndexData;
    indexCache.set(gameType, parsed);
    return parsed;
  })();
  indexPromises.set(gameType, promise);
  try {
    return await promise;
  } finally {
    indexPromises.delete(gameType);
  }
}

/** Atomically load and cache one scenario file by its internal name. */
export async function loadScenario(
  name: string,
  gameType: GameType = DEFAULT_GAME_TYPE
): Promise<ScenarioData | null> {
  const key = cacheKey(gameType, name);
  if (scenarioCache.has(key)) return scenarioCache.get(key)!;
  const existing = scenarioPromises.get(key);
  if (existing) return existing;

  const filePath = path.join(dataDirFor(gameType), `${name}.json`);
  const promise = (async () => {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as ScenarioData;
      scenarioCache.set(key, parsed);
      return parsed;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return null;
      throw e;
    }
  })();
  scenarioPromises.set(key, promise);
  try {
    return await promise;
  } finally {
    scenarioPromises.delete(key);
  }
}

/**
 * Find a chart in a scenario file by matching position, bb, and optional vs.
 * `vs` must match exactly when provided; if the chart has no vs field but
 * `vs` is requested, no match (and vice versa).
 */
export function findChart(
  data: ScenarioData,
  position: string,
  bb: number,
  vs: string | null
): Chart | null {
  for (const c of data.charts) {
    if (c.position !== position) continue;
    if (c.bb !== bb) continue;
    const chartVs = c.vs ?? null;
    if (chartVs !== (vs ?? null)) continue;
    return c;
  }
  return null;
}

/**
 * Return the chart's stack of available bbs for a (position, vs) pair —
 * used by the nearest-bb matcher to snap free-form input.
 */
export function chartsBbsFor(
  data: ScenarioData,
  position: string,
  vs: string | null
): number[] {
  const bbs: number[] = [];
  for (const c of data.charts) {
    if (c.position !== position) continue;
    const chartVs = c.vs ?? null;
    if (chartVs !== (vs ?? null)) continue;
    bbs.push(c.bb);
  }
  return bbs.sort((a, b) => a - b);
}

/** For /api/v1/health: how many scenario JSON files are currently cached. */
export function loadedScenarioCount(): number {
  return scenarioCache.size;
}
