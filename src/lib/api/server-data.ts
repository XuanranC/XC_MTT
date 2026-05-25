/**
 * Server-side scenario JSON loader with module-scope caching.
 *
 * The frontend's `src/lib/data.ts` uses `fetch('/data/...')` which only works
 * in the browser. API routes (Node runtime) instead read directly from the
 * project's `public/data/` directory.
 *
 * Cache lifetime = process lifetime. Vercel cold-starts hit `fs.readFile` +
 * `JSON.parse` once per scenario per instance; subsequent reads are free.
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { IndexData, ScenarioData, Chart } from '../types';

const DATA_DIR = path.join(process.cwd(), 'public', 'data');

let indexCache: IndexData | null = null;
let indexPromise: Promise<IndexData> | null = null;
const scenarioCache: Map<string, ScenarioData> = new Map();
const scenarioPromises: Map<string, Promise<ScenarioData | null>> = new Map();

/** Atomically load and cache the global index.json. */
export async function loadIndex(): Promise<IndexData> {
  if (indexCache) return indexCache;
  if (indexPromise) return indexPromise;
  indexPromise = (async () => {
    const raw = await fs.readFile(path.join(DATA_DIR, 'index.json'), 'utf-8');
    const parsed = JSON.parse(raw) as IndexData;
    indexCache = parsed;
    return parsed;
  })();
  try {
    return await indexPromise;
  } finally {
    indexPromise = null;
  }
}

/** Atomically load and cache one scenario file by its internal name. */
export async function loadScenario(name: string): Promise<ScenarioData | null> {
  if (scenarioCache.has(name)) return scenarioCache.get(name)!;
  const existing = scenarioPromises.get(name);
  if (existing) return existing;

  const filePath = path.join(DATA_DIR, `${name}.json`);
  const promise = (async () => {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as ScenarioData;
      scenarioCache.set(name, parsed);
      return parsed;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return null;
      throw e;
    }
  })();
  scenarioPromises.set(name, promise);
  try {
    return await promise;
  } finally {
    scenarioPromises.delete(name);
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
