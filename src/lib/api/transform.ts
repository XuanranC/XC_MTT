/**
 * DB → public API format converters.
 *
 * Internal storage:
 *   - action pcts stored 0-100 and sum to `reach` (not to 100)
 *   - reach stored 0-100, default 100 when absent
 *   - edges pct stored 0-100
 *
 * Public API:
 *   - all frequencies normalized to 0-1, conditional on reach (sum to 1.0)
 *   - reach normalized to 0-1
 *   - 3 decimal places to keep responses readable
 */

import type { Chart, HandData, EdgeInfo } from '../types';

const ACTION_KEYS_FIXED = ['fold', 'call', 'raise', 'allin'] as const;
export type FixedActionKey = (typeof ACTION_KEYS_FIXED)[number];

/** 3-decimal round → number. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export interface ApiActionFreqs {
  fold: number;
  call: number;
  raise: number;
  allin: number;
  // Optional extra action present in some scenarios (mostly SB limp branches).
  limp?: number;
}

export interface ApiHandResponse {
  actions: ApiActionFreqs;
  primary_action: string;
  ev: number | null;
  reach: number;
}

/**
 * Normalize a stored HandData to the API shape. Frequencies become conditional
 * shares of reach (summing to 1.0) — matching the spec's claim that
 * actions are "the strategy given you reached this node".
 *
 * If the hand has no data (undefined), returns a fully-folded entry.
 */
export function toApiHand(hand: HandData | undefined): ApiHandResponse {
  if (!hand) {
    return {
      actions: { fold: 1.0, call: 0, raise: 0, allin: 0 },
      primary_action: 'fold',
      ev: null,
      reach: 1.0,
    };
  }

  const reachPct = hand.reach ?? 100;
  const denom = reachPct > 0 ? reachPct : 100; // guard divide-by-zero on truly-unreachable combos

  const fold = round3((hand.fold ?? 0) / denom);
  const call = round3((hand.call ?? 0) / denom);
  const raise = round3((hand.raise ?? 0) / denom);
  const allin = round3((hand.allin ?? 0) / denom);

  // Detect limp (present in some SB scenarios) by reading the field directly.
  const limpPct = (hand as HandData & { limp?: number }).limp;
  const limp = limpPct != null ? round3(limpPct / denom) : undefined;

  const actions: ApiActionFreqs = { fold, call, raise, allin };
  if (limp != null) actions.limp = limp;

  // primary = max-freq action
  let primary: string = 'fold';
  let primaryPct = -1;
  for (const [k, v] of Object.entries(actions)) {
    if (typeof v === 'number' && v > primaryPct) {
      primary = k;
      primaryPct = v;
    }
  }

  return {
    actions,
    primary_action: primary,
    ev: hand.ev != null ? round3(hand.ev) : null,
    reach: round3(reachPct / 100),
  };
}

/** Build hand → series map from index series_definitions, preserving order. */
let cachedHandToSeries: Map<string, string[]> | null = null;
export function buildHandToSeriesMap(seriesDefinitions: Record<string, string[]>): Map<string, string[]> {
  if (cachedHandToSeries) return cachedHandToSeries;
  const m = new Map<string, string[]>();
  // Preserve key order from series_definitions (insertion order)
  for (const seriesKey of Object.keys(seriesDefinitions)) {
    for (const hand of seriesDefinitions[seriesKey]) {
      const list = m.get(hand) ?? [];
      list.push(seriesKey);
      m.set(hand, list);
    }
  }
  cachedHandToSeries = m;
  return m;
}

/**
 * For a given hand, find the most informative edge_series in a chart.
 *
 * Rule (spec §5.6): pick the FIRST series (in series_definitions order) that
 * contains this hand AND is present in chart.edges.
 *
 * Returns null when no series applies (e.g., pair hands when 'Pairs' isn't in
 * edges, or genuinely-orphan hands).
 */
export interface EdgeAnnotation {
  is_edge: boolean;
  edge_series: string | null;
  edge_floor: string | null;
}

export function computeEdgeAnnotation(
  hand: string,
  chart: Chart,
  seriesDefinitions: Record<string, string[]>
): EdgeAnnotation {
  const map = buildHandToSeriesMap(seriesDefinitions);
  const seriesList = map.get(hand) ?? [];
  for (const seriesKey of seriesList) {
    const edge = chart.edges?.[seriesKey];
    if (!edge) continue;
    return {
      is_edge: hand === edge.floor,
      edge_series: seriesKey,
      edge_floor: edge.floor,
    };
  }
  return { is_edge: false, edge_series: null, edge_floor: null };
}

/** Normalize a chart.edges entry to the API format (pct 0-100 → 0-1). */
export function toApiEdge(e: EdgeInfo): {
  floor: string;
  action: string;
  pct: number;
  fold_pct: number;
} {
  return {
    floor: e.floor,
    action: e.action,
    pct: round3(e.pct / 100),
    fold_pct: round3(e.fold_pct / 100),
  };
}

/** Compute summary stats over an entire chart (vpip / pfr / total combos). */
export function computeStats(
  chart: Chart
): { vpip: number; pfr: number; total_combos: number } {
  let vpipSum = 0;
  let pfrSum = 0;
  let count = 0;
  for (const hand of Object.values(chart.hands)) {
    const reach = hand.reach ?? 100;
    if (reach <= 0) continue;
    const fold = hand.fold ?? 0;
    const raise = hand.raise ?? 0;
    const allin = hand.allin ?? 0;
    // Conditional on reach
    const vpip = (reach - fold) / reach;
    const pfr = (raise + allin) / reach;
    vpipSum += vpip;
    pfrSum += pfr;
    count++;
  }
  if (count === 0) return { vpip: 0, pfr: 0, total_combos: 0 };
  return {
    vpip: round3(vpipSum / count),
    pfr: round3(pfrSum / count),
    total_combos: count,
  };
}
