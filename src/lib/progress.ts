import type { DrillAnswer, DrillQuestion } from './types';
import type { GameType } from './data';
import { DEFAULT_GAME_TYPE } from './data';

const PROGRESS_KEY = 'drillProgressV2';
const LAST_ANSWERS_KEY = 'lastDrillAnswers';
// Bumped to v3 when 6-Max namespacing was introduced. v2 had no game_type
// concept so every record was implicitly MTT — migration prepends "mtt::"
// to every scenario-keyed bucket on read.
const PROGRESS_VERSION = 3;
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
  gameType: GameType;
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
  gameType: GameType;
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
  // Keyed by `${gameType}::${scenario}` to keep MTT and 6-Max stats separate.
  byScenario: Record<string, ScenarioStat>;
  scenarioBreakdowns: Record<string, ScenarioBreakdown>;
  attempts: AttemptRecord[];
}

// ---------------------------------------------------------------------------
// Key composition — every stat is bucketed by game_type to prevent collision
// when both MTT and 6-Max have a scenario called "RFI".
// ---------------------------------------------------------------------------

export function makeStatKey(gameType: GameType, scenario: string): string {
  return `${gameType}::${scenario}`;
}

export function parseStatKey(key: string): { gameType: GameType; scenario: string } | null {
  const idx = key.indexOf('::');
  if (idx < 0) return null;
  const gt = key.slice(0, idx);
  const scenario = key.slice(idx + 2);
  if (gt !== 'mtt' && gt !== '6max_100bb') return null;
  return { gameType: gt, scenario };
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

/**
 * Migrate a v2 payload to v3 by tagging every record/key as MTT.
 * Returns a fresh ProgressData. v2 schema:
 *   sessions: [{id, scenario, total, correct, timestamp}]
 *   byScenario: { [scenario]: ScenarioStat }
 *   scenarioBreakdowns: { [scenario]: ScenarioBreakdown }
 *   attempts: [{...no gameType}]
 */
function migrateV2toV3(v2: {
  sessions?: Array<Omit<SessionRecord, 'gameType'>>;
  byScenario?: Record<string, ScenarioStat>;
  scenarioBreakdowns?: Record<string, ScenarioBreakdown>;
  attempts?: Array<Omit<AttemptRecord, 'gameType'>>;
}): ProgressData {
  const out: ProgressData = emptyProgress();
  for (const s of v2.sessions ?? []) {
    out.sessions.push({ ...s, gameType: 'mtt' });
  }
  for (const [scenario, stat] of Object.entries(v2.byScenario ?? {})) {
    out.byScenario[makeStatKey('mtt', scenario)] = stat;
  }
  for (const [scenario, bd] of Object.entries(v2.scenarioBreakdowns ?? {})) {
    out.scenarioBreakdowns[makeStatKey('mtt', scenario)] = bd;
  }
  for (const a of v2.attempts ?? []) {
    out.attempts.push({ ...a, gameType: 'mtt' });
  }
  return out;
}

export function getProgress(): ProgressData {
  if (typeof window === 'undefined') return emptyProgress();
  try {
    const stored = localStorage.getItem(PROGRESS_KEY);
    if (!stored) return emptyProgress();
    const parsed = JSON.parse(stored);
    if (parsed?.version === PROGRESS_VERSION) {
      return {
        version: PROGRESS_VERSION,
        sessions: parsed.sessions ?? [],
        byScenario: parsed.byScenario ?? {},
        scenarioBreakdowns: parsed.scenarioBreakdowns ?? {},
        attempts: parsed.attempts ?? [],
      };
    }
    if (parsed?.version === 2) {
      const migrated = migrateV2toV3(parsed);
      saveProgress(migrated);
      return migrated;
    }
    // Unknown / pre-v2: discard.
    return emptyProgress();
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
  gameType: GameType = DEFAULT_GAME_TYPE,
): void {
  const progress = getProgress();
  const now = Date.now();

  const total = answers.length;
  const correct = answers.filter((a) => a.isCorrect).length;

  progress.sessions.push({
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    scenario,
    gameType,
    total,
    correct,
    timestamp: now,
  });

  answers.forEach((ans, i) => {
    const q = ans.question;
    const key = makeStatKey(gameType, q.scenario);

    // Global per-scenario stats
    if (!progress.byScenario[key]) {
      progress.byScenario[key] = { total: 0, correct: 0, lastPracticed: now };
    }
    progress.byScenario[key].total += 1;
    if (ans.isCorrect) progress.byScenario[key].correct += 1;
    progress.byScenario[key].lastPracticed = now;

    // Per-scenario breakdowns
    if (!progress.scenarioBreakdowns[key]) {
      progress.scenarioBreakdowns[key] = emptyScenarioBreakdown();
    }
    const bd = progress.scenarioBreakdowns[key];
    bumpStat(bd.byHand, q.hand, ans.isCorrect);
    bumpStat(bd.byPosition, q.position, ans.isCorrect);
    bumpStat(bd.byBB, bbBucket(q.bb), ans.isCorrect);

    // Per-attempt record (newest first for cheap prefix reads)
    // Stamp sequential micro-offsets so attempts from the same session keep
    // their original order after sorting.
    progress.attempts.unshift({
      hand: q.hand,
      scenario: q.scenario,
      gameType,
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
    // Persist the last drill payload + its game_type so /review knows which
    // namespace the answers belong to.
    localStorage.setItem(
      LAST_ANSWERS_KEY,
      JSON.stringify({ version: 3, gameType, answers }),
    );
  }
}

// ---------------------------------------------------------------------------
// Read helpers — every per-scenario query takes a gameType so MTT/6-Max
// stats stay independent.
// ---------------------------------------------------------------------------

export function getScenarioBreakdown(
  scenario: string,
  gameType: GameType = DEFAULT_GAME_TYPE,
): ScenarioBreakdown | null {
  return getProgress().scenarioBreakdowns[makeStatKey(gameType, scenario)] ?? null;
}

export function getScenarioStat(
  scenario: string,
  gameType: GameType = DEFAULT_GAME_TYPE,
): ScenarioStat | null {
  return getProgress().byScenario[makeStatKey(gameType, scenario)] ?? null;
}

export function getAttemptsForHand(
  scenario: string,
  hand: string,
  gameType: GameType = DEFAULT_GAME_TYPE,
  limit: number = 20,
): AttemptRecord[] {
  return getProgress()
    .attempts
    .filter((a) => a.gameType === gameType && a.scenario === scenario && a.hand === hand)
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
  gameType: GameType = DEFAULT_GAME_TYPE,
  opts: { minAttempts?: number; minErrorRate?: number; limit?: number } = {},
): WeakHandEntry[] {
  const minAttempts = opts.minAttempts ?? 3;
  const minErrorRate = opts.minErrorRate ?? 0.3;
  const limit = opts.limit ?? 10;
  const bd = getScenarioBreakdown(scenario, gameType);
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

export function getPositionStats(
  scenario: string,
  gameType: GameType = DEFAULT_GAME_TYPE,
): WeakPositionEntry[] {
  const bd = getScenarioBreakdown(scenario, gameType);
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

export function getBBBucketStats(
  scenario: string,
  gameType: GameType = DEFAULT_GAME_TYPE,
): BBBucketEntry[] {
  const bd = getScenarioBreakdown(scenario, gameType);
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
  gameType: GameType = DEFAULT_GAME_TYPE,
  opts: { minAttempts?: number; minErrorRate?: number } = {},
): number {
  return getWeakHands(scenario, gameType, { ...opts, limit: 9999 }).length;
}

// ---------------------------------------------------------------------------
// Last-answers payload (for /review). Schema bumped to v3 alongside progress
// so the review page knows which game_type the answers came from.
// ---------------------------------------------------------------------------

export interface LastAnswersPayload {
  version: 3;
  gameType: GameType;
  answers: DrillAnswer[];
}

export function getLastAnswers(): LastAnswersPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LAST_ANSWERS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // v3 payload — direct.
    if (parsed?.version === 3 && Array.isArray(parsed.answers)) {
      return {
        version: 3,
        gameType: parsed.gameType === '6max_100bb' ? '6max_100bb' : 'mtt',
        answers: parsed.answers,
      };
    }
    // Legacy: raw answers[] array. Treat as MTT.
    if (Array.isArray(parsed)) {
      return { version: 3, gameType: 'mtt', answers: parsed };
    }
    return null;
  } catch {
    return null;
  }
}
