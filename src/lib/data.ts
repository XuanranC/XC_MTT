import { IndexData, ScenarioData, Chart, HandData } from './types';

let indexCache: IndexData | null = null;
const scenarioCache: Record<string, ScenarioData> = {};

export async function getIndex(): Promise<IndexData> {
  if (indexCache) return indexCache;
  const res = await fetch('/data/index.json');
  indexCache = await res.json();
  return indexCache!;
}

export async function getScenarioData(scenario: string): Promise<ScenarioData> {
  if (scenarioCache[scenario]) return scenarioCache[scenario];
  const res = await fetch(`/data/${scenario}.json`);
  const data: ScenarioData = await res.json();
  scenarioCache[scenario] = data;
  return data;
}

export function findChart(
  data: ScenarioData,
  position: string,
  bb: number,
  vs?: string
): Chart | undefined {
  return data.charts.find(
    (c) =>
      c.position === position &&
      c.bb === bb &&
      (vs ? c.vs === vs : true)
  );
}

export function getPrimaryAction(hand: HandData): { action: string; pct: number } | null {
  const actions: [string, number][] = [];
  if (hand.raise) actions.push(['raise', hand.raise]);
  if (hand.call) actions.push(['call', hand.call]);
  if (hand.fold) actions.push(['fold', hand.fold]);
  if (hand.allin) actions.push(['allin', hand.allin]);
  if (actions.length === 0) return null;
  actions.sort((a, b) => b[1] - a[1]);
  return { action: actions[0][0], pct: actions[0][1] };
}

export function getHandActions(hand: HandData): { action: string; pct: number }[] {
  const actions: { action: string; pct: number }[] = [];
  if (hand.raise) actions.push({ action: 'raise', pct: hand.raise });
  if (hand.call) actions.push({ action: 'call', pct: hand.call });
  if (hand.fold) actions.push({ action: 'fold', pct: hand.fold });
  if (hand.allin) actions.push({ action: 'allin', pct: hand.allin });
  return actions.sort((a, b) => b.pct - a.pct);
}

// Conditional-reach probability. Absent ⇒ 100 (node is always reachable).
export function getReach(hand: HandData): number {
  return hand.reach ?? 100;
}

// A hand is "mixed" when its primary action doesn't fully explain the reached
// probability — i.e. primary_pct < reach. Uses reach_pct as the denominator
// so conditional nodes evaluate correctly.
export function isMixed(hand: HandData): boolean {
  const actions = getHandActions(hand);
  if (actions.length < 2) return false;
  return actions[0].pct < getReach(hand) - 0.5;
}

export function isEdgeHand(hand: HandData): boolean {
  if (!hand.fold || hand.fold === 100) return false;
  if (hand.fold === 0) return false;
  // Edge = has non-trivial fold AND non-trivial play action
  return hand.fold > 10 && hand.fold < 90;
}

// Compute overall range percentage (hands that are not 100% fold)
export function getRangePercent(chart: Chart): number {
  const total = Object.keys(chart.hands).length;
  if (total === 0) return 0;
  const playing = Object.values(chart.hands).filter(
    (h) => !h.fold || h.fold < 100
  ).length;
  return Math.round((playing / total) * 100);
}

// Get available actions for a scenario (what actions appear in charts)
export function getAvailableActions(chart: Chart): string[] {
  const actions = new Set<string>();
  for (const hand of Object.values(chart.hands)) {
    if (hand.raise && hand.raise > 0) actions.add('raise');
    if (hand.call && hand.call > 0) actions.add('call');
    if (hand.fold && hand.fold > 0) actions.add('fold');
    if (hand.allin && hand.allin > 0) actions.add('allin');
  }
  return Array.from(actions);
}
