/**
 * Public scenario routing.
 *
 * The API exposes 11 logical scenarios; internally there are 12 JSON files
 * because VS_OPEN is split into VS_OPEN_BB (BB defense — chart.position is
 * the OPENER's position) and VS_OPEN_nonBB (non-BB defense — chart.position
 * is HERO, chart.vs is the opener).
 *
 * Callers always speak the logical name. This module hides the routing logic
 * and exposes a unified merged metadata view for /api/v1/scenarios.
 */

import type { IndexData, ScenarioData, ScenarioMeta, Chart } from '../types';
import { loadIndex, loadScenario, findChart as findChartRaw, chartsBbsFor as chartsBbsForRaw } from './server-data';

/** Logical API scenario names (what K仔 sends in `scenario=`). */
export const API_SCENARIO_NAMES = [
  'RFI',
  'BVB',
  'VS_OPEN',
  'VS_3BET',
  'CALL_ALLIN',
  'CALL_REJAM',
  'VS_OPEN_CALL',
  'VS_OPEN_3BET',
  'VS_OPEN_ALLIN',
  'HU_ONLINE',
  'HU_OFFLINE_ANTE',
] as const;

export type ApiScenarioName = (typeof API_SCENARIO_NAMES)[number];

/** Friendly descriptions surfaced via /api/v1/scenarios. */
const DESCRIPTIONS: Record<ApiScenarioName, string> = {
  RFI: 'Raise First In',
  BVB: 'Blind vs Blind',
  VS_OPEN: 'Defending vs single open (BB and non-BB merged)',
  VS_3BET: 'Open-raiser facing a 3-bet',
  CALL_ALLIN: 'Calling vs short-stack all-in shove',
  CALL_REJAM: 'Calling vs re-jam (4-bet shove)',
  VS_OPEN_CALL: 'Squeeze scenarios — call branches',
  VS_OPEN_3BET: 'Squeeze scenarios — 3-bet branches',
  VS_OPEN_ALLIN: 'Squeeze scenarios — all-in branches',
  HU_ONLINE: 'Heads-up online (no ante)',
  HU_OFFLINE_ANTE: 'Heads-up offline (ante present)',
};

export function isApiScenario(name: string): name is ApiScenarioName {
  return (API_SCENARIO_NAMES as readonly string[]).includes(name);
}

/**
 * Resolve a logical API scenario + position to the internal file(s) and the
 * chart-lookup parameters that should be used.
 *
 * Specifically handles VS_OPEN's BB/non-BB split:
 *   - position=BB / BB_* → internal=VS_OPEN_BB, chart.position = opener (vs_position)
 *   - position=BTN / CO / ... → internal=VS_OPEN_nonBB, chart.position = hero
 *
 * Returns the candidate internal file names to try; in BB defense the chart
 * lookup uses `chartPosition` (the opener) and `chartVs` (null).
 */
export interface RouteContext {
  internalName: string;
  // The position to look up in chart.position (may differ from the API's `position` param)
  chartPosition: string;
  // The vs to look up in chart.vs (null if the file doesn't use vs)
  chartVs: string | null;
  // Whether vs_position was required for this lookup
  requiresVs: boolean;
}

/**
 * Decide how to query the underlying data for an API request.
 *
 * Returns either a single RouteContext or an error string (caller maps to
 * appropriate HTTP status). The vs_position rules are:
 *   - VS_OPEN with position=BB* → vs_position REQUIRED and used as chart.position
 *   - VS_OPEN with other position → vs_position REQUIRED and used as chart.vs
 *   - Any scenario where the file has vs_positions != null → vs_position REQUIRED
 *   - RFI, BVB, VS_OPEN_BB-style files (vs_positions null) → vs_position MUST be omitted
 */
export async function routeRequest(
  apiScenario: ApiScenarioName,
  position: string,
  vs: string | null
): Promise<{ ok: true; route: RouteContext } | { ok: false; reason: 'INVALID_VS_POSITION'; available: string[] }> {
  if (apiScenario === 'VS_OPEN') {
    const isBBDefense = position === 'BB' || position.startsWith('BB_');
    if (isBBDefense) {
      const scen = await loadScenario('VS_OPEN_BB');
      const available = scen?.positions ?? []; // BB_BB file lists opener positions as chart.position
      if (!vs) {
        return { ok: false, reason: 'INVALID_VS_POSITION', available };
      }
      if (!available.includes(vs)) {
        return { ok: false, reason: 'INVALID_VS_POSITION', available };
      }
      return {
        ok: true,
        route: {
          internalName: 'VS_OPEN_BB',
          chartPosition: vs, // opener encoded as chart.position
          chartVs: null,
          requiresVs: true,
        },
      };
    }
    const scen = await loadScenario('VS_OPEN_nonBB');
    const available = scen?.vs_positions ?? [];
    if (!vs) {
      return { ok: false, reason: 'INVALID_VS_POSITION', available };
    }
    if (!available.includes(vs)) {
      return { ok: false, reason: 'INVALID_VS_POSITION', available };
    }
    return {
      ok: true,
      route: {
        internalName: 'VS_OPEN_nonBB',
        chartPosition: position,
        chartVs: vs,
        requiresVs: true,
      },
    };
  }

  // All other scenarios map 1:1 to a file with matching name.
  const internalName = apiScenario;
  const scen = await loadScenario(internalName);
  const fileVsPositions = scen?.vs_positions ?? null;

  if (fileVsPositions === null || fileVsPositions.length === 0) {
    // Scenario file has no vs concept (RFI, BVB).
    return {
      ok: true,
      route: {
        internalName,
        chartPosition: position,
        chartVs: null,
        requiresVs: false,
      },
    };
  }

  // Scenario expects vs.
  if (!vs) {
    return { ok: false, reason: 'INVALID_VS_POSITION', available: fileVsPositions };
  }
  if (!fileVsPositions.includes(vs)) {
    return { ok: false, reason: 'INVALID_VS_POSITION', available: fileVsPositions };
  }
  return {
    ok: true,
    route: {
      internalName,
      chartPosition: position,
      chartVs: vs,
      requiresVs: true,
    },
  };
}

export async function findChartViaRoute(
  route: RouteContext,
  bb: number
): Promise<Chart | null> {
  const data = await loadScenario(route.internalName);
  if (!data) return null;
  return findChartRaw(data, route.chartPosition, bb, route.chartVs);
}

export async function chartBbsForRoute(route: RouteContext): Promise<number[]> {
  const data = await loadScenario(route.internalName);
  if (!data) return [];
  return chartsBbsForRaw(data, route.chartPosition, route.chartVs);
}

/**
 * Build the merged scenario list for /api/v1/scenarios.
 * VS_OPEN_BB + VS_OPEN_nonBB are merged into a single VS_OPEN entry.
 */
export async function listApiScenarios(): Promise<
  Array<{
    name: ApiScenarioName;
    description: string;
    positions: string[];
    vs_positions: string[] | null;
    bbs: number[];
    total_charts: number;
    note?: string;
  }>
> {
  const idx = await loadIndex();
  const byName = new Map<string, ScenarioMeta>();
  for (const s of idx.scenarios) byName.set(s.name, s);

  const result = [];
  for (const apiName of API_SCENARIO_NAMES) {
    if (apiName === 'VS_OPEN') {
      const bb = byName.get('VS_OPEN_BB');
      const nonBb = byName.get('VS_OPEN_nonBB');
      if (!bb && !nonBb) continue;
      const allPositions = new Set<string>();
      for (const p of bb?.positions ?? []) allPositions.add(p);
      for (const p of nonBb?.positions ?? []) allPositions.add(p);
      // BB defense always has hero = BB, but the position param is what users
      // pass — add explicit BB/BB_* and the openers as accepted positions.
      allPositions.add('BB');
      const vsPositions = new Set<string>();
      // Openers for BB defense are chart.position values in VS_OPEN_BB.
      for (const p of bb?.positions ?? []) vsPositions.add(p);
      // Openers for non-BB defense are in vs_positions of VS_OPEN_nonBB.
      for (const p of nonBb?.vs_positions ?? []) vsPositions.add(p);

      const bbs = new Set<number>();
      for (const v of bb?.bbs ?? []) bbs.add(v);
      for (const v of nonBb?.bbs ?? []) bbs.add(v);

      result.push({
        name: 'VS_OPEN' as ApiScenarioName,
        description: DESCRIPTIONS.VS_OPEN,
        positions: Array.from(allPositions).sort(),
        vs_positions: Array.from(vsPositions).sort(),
        bbs: Array.from(bbs).sort((a, b) => a - b),
        total_charts: (bb?.chart_count ?? 0) + (nonBb?.chart_count ?? 0),
        note: 'Internally split into VS_OPEN_BB (BB defense; vs_position = opener) and VS_OPEN_nonBB (non-BB defense)',
      });
      continue;
    }

    const meta = byName.get(apiName);
    if (!meta) continue;
    result.push({
      name: apiName,
      description: DESCRIPTIONS[apiName],
      positions: meta.positions,
      vs_positions: meta.vs_positions,
      bbs: meta.bbs,
      total_charts: meta.chart_count,
    });
  }
  return result;
}

/** For /api/v1/health — count distinct scenario JSON files. */
export function totalScenarioFiles(): number {
  return 12; // BVB, CALL_ALLIN, CALL_REJAM, HU_OFFLINE_ANTE, HU_ONLINE, RFI,
             // VS_3BET, VS_OPEN_3BET, VS_OPEN_ALLIN, VS_OPEN_BB, VS_OPEN_CALL,
             // VS_OPEN_nonBB
}
