// Core data types for GTO Preflop Drill

export interface HandData {
  raise?: number;
  call?: number;
  fold?: number;
  allin?: number;
  ev?: number;
  // Conditional probability this combo reaches this node (0..100).
  // Absent ⇒ 100 (always reaches). Invariant: raise+call+fold+allin == reach.
  reach?: number;
}

export interface EdgeInfo {
  floor: string;
  action: string;
  pct: number;
  fold_pct: number;
}

export interface Chart {
  id: number;
  position: string;
  bb: number;
  vs?: string;
  hands: Record<string, HandData>;
  edges: Record<string, EdgeInfo>;
}

export interface ScenarioData {
  scenario: string;
  positions: string[];
  vs_positions: string[] | null;
  bbs: number[];
  chart_count: number;
  charts: Chart[];
}

export interface ScenarioMeta {
  name: string;
  positions: string[];
  vs_positions: string[] | null;
  bbs: number[];
  chart_count: number;
}

export interface IndexData {
  scenarios: ScenarioMeta[];
  hand_matrix: string[][];
  series_definitions: Record<string, string[]>;
}

// Drill types
export interface DrillQuestion {
  scenario: string;
  position: string;
  vs?: string;
  bb: number;
  hand: string;
  correct: HandData;
  chartId: number;
}

export interface DrillAnswer {
  question: DrillQuestion;
  selectedAction: string;
  selectedPct: number;
  isCorrect: boolean;
  actionCorrect: boolean;
  pctError: number;
  timestamp: number;
}

export interface DrillSession {
  id: string;
  scenario: string;
  filters: DrillFilters;
  questions: DrillQuestion[];
  answers: DrillAnswer[];
  startedAt: number;
  completedAt?: number;
}

export interface DrillFilters {
  scenarios: string[];
  positions: string[];
  vsPositions?: string[];
  bbRange: [number, number];
  questionCount: number;
  mode: 'random' | 'weak' | 'edge';
}

// Progress types
export interface HandStat {
  total: number;
  correct: number;
  avgPctError: number;
}

export interface ScenarioStat {
  total: number;
  correct: number;
  lastPracticed?: number;
}

export interface UserProgress {
  byScenario: Record<string, ScenarioStat>;
  byHand: Record<string, HandStat>;
  weakSpots: string[]; // "hand|scenario|position|bb" combos with error rate > 40%
  sessions: DrillSession[];
}

// Display helpers
export const SCENARIO_ORDER: string[] = [
  'RFI',
  'BVB',
  'VS_OPEN_BB',
  'VS_OPEN_nonBB',
  'VS_3BET',
  'CALL_ALLIN',
  'CALL_REJAM',
  'VS_OPEN_CALL',
  'VS_OPEN_3BET',
  'VS_OPEN_ALLIN',
  'HU_ONLINE',
  'HU_OFFLINE_ANTE',
];

export function compareScenarios(a: string, b: string): number {
  const ia = SCENARIO_ORDER.indexOf(a);
  const ib = SCENARIO_ORDER.indexOf(b);
  if (ia === -1 && ib === -1) return a.localeCompare(b);
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
}

export const SCENARIO_LABELS: Record<string, string> = {
  RFI: 'RFI',
  BVB: 'BVB',
  VS_OPEN_BB: 'VS_OPEN (BB)',
  VS_OPEN_nonBB: 'VS_OPEN (non-BB)',
  VS_3BET: 'VS_3BET',
  CALL_ALLIN: 'CALL_ALLIN',
  CALL_REJAM: 'CALL_REJAM',
  VS_OPEN_CALL: 'VS_OPEN_CALL',
  VS_OPEN_3BET: 'VS_OPEN_3BET',
  VS_OPEN_ALLIN: 'VS_OPEN_ALLIN',
  HU_ONLINE: 'HU_ONLINE',
  HU_OFFLINE_ANTE: 'HU_OFFLINE_ANTE',
};

export const ACTION_COLORS: Record<string, string> = {
  call: '#22c55e',   // green
  raise: '#eab308',  // yellow
  allin: '#ef4444',  // red
  fold: '#6b7280',   // gray
};

export const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
