import type { DrillAnswer, DrillQuestion } from './types';

const PROGRESS_KEY = 'drillProgressV2';
const LAST_ANSWERS_KEY = 'lastDrillAnswers';
const PROGRESS_VERSION = 2;
const ATTEMPTS_CAP = 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BBBucketKey = '2-10' | '11-20' | '21-40' | '41-100';

export const BB_BUCKETS: BBBucketKey[] = ['2-10', '11-20', '21-40', '41-100'];

export const BB_BUCKET_LABEL: Record<BBBucketKey, string> = {
  '2-10': 'Short',
  '11-20': 'Mid-Short',
  '21-40': 'Mid',
  '41-100': 'Deep',
};

export function bbBucket(bb: number): BBBucketKey {
  if (bb <= 10) return '2-10';
  if (bb <= 20) return '11-20';
  if (bb <= 40) return '21-40';
  return '41-100';
}

export interface ProgressStat {
  total: number;
  correct: number;
}

export interface SessionRecord {
  id: string;
  scenario: string;
  total: number;
  correct: number;
  timestamp: number;
}

export interface ScenarioStat {
  total: number;
  correct: number;
  lastPracticed: number;
}

export interface ScenarioBreakdown {
  byHand: Record<string, ProgressStat>;
  byPosition: Record<string, ProgressStat>;
  byBB: Record<string, ProgressStat>;
}

export interface AttemptRecord {
  hand: string;
  scenario: string;
  position: string;
  bb: number;
  vs?: string;
  selected: string;
  gtoActions: Array<{ action: string; pct: number }>;
  reach?: number;
  isCorrect: boolean;
  timestamp: number;
}

export interface ProgressData {
  version: number;
  sessions: SessionRecord[];
  byScenario: Record<string, ScenarioStat>;
  scenarioBreakdowns: Record<string, ScenarioBreakdown>;
  attempts: AttemptRecord[];
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

function emptyProgress(): ProgressData {
  return {
    version: PROGRESS_VERSION,
    sessions: [],
    byScenario: {},
    scenarioBreakdowns: {},
    attempts: [],
  };
}

function emptyScenarioBreakdown(): ScenarioBreakdown {
  return { byHand: {}, byPosition: {}, byBB: {} };
}

export function getProgress(): ProgressData {
  if (typeof window === 'undefined') return emptyProgress();
  try {
    const stored = localStorage.getItem(PROGRESS_KEY);
    if (!stored) return emptyProgress();
    const parsed = JSON.parse(stored);
    // V1 data lives under the old 'drillProgress' key — we deliberately do
    // not migrate it (user opted to reset). Only consume V2 payloads here.
    if (parsed?.version !== PROGRESS_VERSION) return emptyProgress();
    return {
      version: PROGRESS_VERSION,
      sessions: parsed.sessions ?? [],
      byScenario: parsed.byScenario ?? {},
      scenarioBreakdowns: parsed.scenarioBreakdowns ?? {},
      attempts: parsed.attempts ?? [],
    };
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(data: ProgressData): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

function bumpStat(
  obj: Record<string, ProgressStat>,
  key: string,
  isCorrect: boolean,
): void {
  if (!obj[key]) obj[key] = { total: 0, correct: 0 };
  obj[key].total += 1;
  if (isCorrect) obj[key].correct += 1;
}

function primaryGTOActions(q: DrillQuestion): Array<{ action: string; pct: number }> {
  const c = q.correct;
  const actions: Array<{ action: string; pct: number }> = [];
  if (c.raise != null && c.raise > 0) actions.push({ action: 'raise', pct: c.raise });
  if (c.call != null && c.call > 0) actions.push({ action: 'call', pct: c.call });
  if (c.allin != null && c.allin > 0) actions.push({ action: 'allin', pct: c.allin });
  if (c.fold != null && c.fold > 0) actions.push({ action: 'fold', pct: c.fold });
  // Sort by descending pct — the dominant GTO action comes first.
  actions.sort((a, b) => b.pct - a.pct);
  return actions;
}

export function recordDrillSession(
  answers: DrillAnswer[],
  scenario: string,
): void {
  const progress = getProgress();
  const now = Date.now();

  const total = answers.length;
  const correct = answers.filter((a) => a.isCorrect).length;

  progress.sessions.push({
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    scenario,
    total,
    correct,
    timestamp: now,
  });

  answers.forEach((ans, i) => {
    const q = ans.question;

    // Global per-scenario stats
    if (!progress.byScenario[q.scenario]) {
      progress.byScenario[q.scenario] = { total: 0, correct: 0, lastPracticed: now };
    }
    progress.byScenario[q.scenario].total += 1;
    if (ans.isCorrect) progress.byScenario[q.scenario].correct += 1;
    progress.byScenario[q.scenario].lastPracticed = now;

    // Per-scenario breakdowns
    if (!progress.scenarioBreakdowns[q.scenario]) {
      progress.scenarioBreakdowns[q.scenario] = emptyScenarioBreakdown();
    }
    const bd = progress.scenarioBreakdowns[q.scenario];
    bumpStat(bd.byHand, q.hand, ans.isCorrect);
    bumpStat(bd.byPosition, q.position, ans.isCorrect);
    bumpStat(bd.byBB, bbBucket(q.bb), ans.isCorrect);

    // Per-attempt record (newest first for cheap prefix reads)
    // Stamp sequential micro-offsets so attempts from the same session keep
    // their original order after sorting.
    progress.attempts.unshift({
      hand: q.hand,
      scenario: q.scenario,
      position: q.position,
      bb: q.bb,
      vs: q.vs,
      selected: ans.selectedAction,
      gtoActions: primaryGTOActions(q),
      reach: q.correct.reach,
      isCorrect: ans.isCorrect,
      timestamp: now + i,
    });
  });

  // Cap attempt history so localStorage doesn't grow unbounded.
  if (progress.attempts.length > ATTEMPTS_CAP) {
    progress.attempts = progress.attempts.slice(0, ATTEMPTS_CAP);
  }

  saveProgress(progress);

  if (typeof window !== 'undefined') {
    localStorage.setItem(LAST_ANSWERS_KEY, JSON.stringify(answers));
  }
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

export function getScenarioBreakdown(scenario: string): ScenarioBreakdown | null {
  return getProgress().scenarioBreakdowns[scenario] ?? null;
}

export function getAttemptsForHand(
  scenario: string,
  hand: string,
  limit: number = 20,
): AttemptRecord[] {
  return getProgress()
    .attempts
    .filter((a) => a.scenario === scenario && a.hand === hand)
    .slice(0, limit);
}

export interface WeakHandEntry {
  hand: string;
  total: number;
  correct: number;
  errorRate: number;
}

export function getWeakHands(
  scenario: string,
  opts: { minAttempts?: number; minErrorRate?: number; limit?: number } = {},
): WeakHandEntry[] {
  const minAttempts = opts.minAttempts ?? 3;
  const minErrorRate = opts.minErrorRate ?? 0.3;
  const limit = opts.limit ?? 10;
  const bd = getScenarioBreakdown(scenario);
  if (!bd) return [];
  return Object.entries(bd.byHand)
    .map(([hand, stat]) => ({
      hand,
      total: stat.total,
      correct: stat.correct,
      errorRate: stat.total > 0 ? (stat.total - stat.correct) / stat.total : 0,
    }))
    .filter((x) => x.total >= minAttempts && x.errorRate >= minErrorRate)
    .sort((a, b) => b.errorRate - a.errorRate || b.total - a.total)
    .slice(0, limit);
}

export interface WeakPositionEntry {
  position: string;
  total: number;
  correct: number;
  errorRate: number;
}

export function getPositionStats(scenario: string): WeakPositionEntry[] {
  const bd = getScenarioBreakdown(scenario);
  if (!bd) return [];
  return Object.entries(bd.byPosition)
    .map(([position, stat]) => ({
      position,
      total: stat.total,
      correct: stat.correct,
      errorRate: stat.total > 0 ? (stat.total - stat.correct) / stat.total : 0,
    }))
    .sort((a, b) => b.errorRate - a.errorRate || b.total - a.total);
}

export interface BBBucketEntry {
  bucket: BBBucketKey;
  label: string;
  total: number;
  correct: number;
  errorRate: number;
}

export function getBBBucketStats(scenario: string): BBBucketEntry[] {
  const bd = getScenarioBreakdown(scenario);
  const out: BBBucketEntry[] = [];
  for (const bucket of BB_BUCKETS) {
    const stat = bd?.byBB?.[bucket];
    const total = stat?.total ?? 0;
    const correct = stat?.correct ?? 0;
    out.push({
      bucket,
      label: BB_BUCKET_LABEL[bucket],
      total,
      correct,
      errorRate: total > 0 ? (total - correct) / total : 0,
    });
  }
  return out;
}

export function countWeakHands(
  scenario: string,
  opts: { minAttempts?: number; minErrorRate?: number } = {},
): number {
  return getWeakHands(scenario, { ...opts, limit: 9999 }).length;
}
