import { DrillAnswer, DrillSession } from './types';

const PROGRESS_KEY = 'drillProgress';
const LAST_ANSWERS_KEY = 'lastDrillAnswers';

interface SessionRecord {
  id: string;
  scenario: string;
  total: number;
  correct: number;
  timestamp: number;
}

interface ProgressData {
  sessions: SessionRecord[];
  byScenario: Record<string, { total: number; correct: number; lastPracticed: number }>;
  byHand: Record<string, { total: number; correct: number }>;
}

function getProgress(): ProgressData {
  const defaultData: ProgressData = {
    sessions: [],
    byScenario: {},
    byHand: {},
  };
  try {
    const stored = localStorage.getItem(PROGRESS_KEY);
    if (stored) return JSON.parse(stored);
  } catch {
    // ignore
  }
  return defaultData;
}

function saveProgress(data: ProgressData): void {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(data));
}

export function recordDrillSession(
  answers: DrillAnswer[],
  scenario: string
): void {
  const progress = getProgress();
  const now = Date.now();

  const total = answers.length;
  const correct = answers.filter((a) => a.isCorrect).length;

  // Add session record
  progress.sessions.push({
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    scenario,
    total,
    correct,
    timestamp: now,
  });

  // Update scenario stats
  if (!progress.byScenario[scenario]) {
    progress.byScenario[scenario] = { total: 0, correct: 0, lastPracticed: now };
  }
  progress.byScenario[scenario].total += total;
  progress.byScenario[scenario].correct += correct;
  progress.byScenario[scenario].lastPracticed = now;

  // Update hand stats
  for (const ans of answers) {
    const hand = ans.question.hand;
    if (!progress.byHand[hand]) {
      progress.byHand[hand] = { total: 0, correct: 0 };
    }
    progress.byHand[hand].total += 1;
    if (ans.isCorrect) {
      progress.byHand[hand].correct += 1;
    }
  }

  saveProgress(progress);

  // Also save last answers for review page
  localStorage.setItem(LAST_ANSWERS_KEY, JSON.stringify(answers));
}

export function getWeakHands(minAttempts: number = 3): { hand: string; errorRate: number; total: number }[] {
  const progress = getProgress();
  return Object.entries(progress.byHand)
    .map(([hand, stat]) => ({
      hand,
      errorRate: stat.total > 0 ? (stat.total - stat.correct) / stat.total : 0,
      total: stat.total,
    }))
    .filter((h) => h.total >= minAttempts && h.errorRate > 0.3)
    .sort((a, b) => b.errorRate - a.errorRate);
}
