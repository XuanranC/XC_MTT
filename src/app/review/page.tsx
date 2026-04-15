'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { DrillAnswer, SCENARIO_LABELS, ACTION_COLORS, RANKS } from '@/lib/types';

interface SeriesGroup {
  series: string;
  errors: DrillAnswer[];
  // Edge line info across bb levels
  edgeLine?: { bb: number; floor: string }[];
}

function getHandSeries(hand: string): string {
  if (hand.length === 2) return 'Pairs';
  const hi = hand[0];
  const suffix = hand[2]; // 's' or 'o'
  return `${hi}x${suffix}`;
}

function getMemoryAnchor(group: SeriesGroup): string {
  if (group.errors.length === 0) return '';
  const err = group.errors[0];
  const pos = err.question.position;
  const scenario = err.question.scenario;
  const bb = err.question.bb;
  const hand = err.question.hand;

  const actions = Object.entries(err.question.correct)
    .filter(([k, v]) => k !== 'ev' && (v as number) > 0)
    .sort(([, a], [, b]) => (b as number) - (a as number));

  const primaryAction = actions[0]?.[0] || 'fold';
  const primaryPct = actions[0]?.[1] || 0;

  if (group.edgeLine && group.edgeLine.length > 1) {
    const changes = group.edgeLine.map((e) => `${e.bb}bb→${e.floor}`).join(', ');
    return `${pos} ${SCENARIO_LABELS[scenario] || scenario} ${group.series}: ${hand}在${bb}bb是${primaryAction} ${primaryPct}%. 边缘变化: ${changes}`;
  }

  return `${pos} ${SCENARIO_LABELS[scenario] || scenario} ${bb}bb: ${hand}应该${primaryAction} ${primaryPct}%`;
}

function ActionBar({ actions }: { actions: { action: string; pct: number }[] }) {
  return (
    <div className="flex h-3 w-full rounded-full overflow-hidden bg-slate-700">
      {actions.map((a) => (
        <div
          key={a.action}
          style={{
            width: `${a.pct}%`,
            backgroundColor: ACTION_COLORS[a.action] || '#666',
          }}
          title={`${a.action}: ${a.pct}%`}
        />
      ))}
    </div>
  );
}

function ComparisonTable({
  group,
}: {
  group: SeriesGroup;
}) {
  if (!group.edgeLine || group.edgeLine.length === 0) return null;

  return (
    <div className="mt-2 overflow-x-auto">
      <table className="text-xs border-collapse">
        <thead>
          <tr>
            <th className="px-2 py-1 text-slate-400 text-left">BB</th>
            {group.edgeLine.map((e) => (
              <th key={e.bb} className="px-2 py-1 text-slate-400">
                {e.bb}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="px-2 py-1 text-slate-300">{group.series} floor</td>
            {group.edgeLine.map((e) => (
              <td key={e.bb} className="px-2 py-1 text-center font-mono text-green-400">
                {e.floor}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function ReviewPage() {
  const [answers, setAnswers] = useState<DrillAnswer[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('lastDrillAnswers');
    if (stored) {
      try {
        setAnswers(JSON.parse(stored));
      } catch {
        // ignore
      }
    }
    setLoaded(true);
  }, []);

  const { totalCorrect, totalQuestions, groups, allErrors } = useMemo(() => {
    const correct = answers.filter((a) => a.isCorrect).length;
    const errors = answers.filter((a) => !a.isCorrect);

    // Group errors by hand series
    const seriesMap = new Map<string, DrillAnswer[]>();
    for (const err of errors) {
      const series = getHandSeries(err.question.hand);
      const key = `${series}|${err.question.scenario}|${err.question.position}`;
      if (!seriesMap.has(key)) seriesMap.set(key, []);
      seriesMap.get(key)!.push(err);
    }

    const grouped: SeriesGroup[] = [];
    for (const [key, errs] of seriesMap) {
      const series = key.split('|')[0];
      grouped.push({
        series,
        errors: errs.sort((a, b) => a.question.bb - b.question.bb),
      });
    }
    grouped.sort((a, b) => b.errors.length - a.errors.length);

    return {
      totalCorrect: correct,
      totalQuestions: answers.length,
      groups: grouped,
      allErrors: errors,
    };
  }, [answers]);

  if (!loaded) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  if (answers.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="text-center py-16">
          <div className="text-6xl mb-4">📝</div>
          <h2 className="text-xl font-bold text-slate-200 mb-2">No Drill Results Yet</h2>
          <p className="text-slate-400 mb-6">Complete a drill session to see your review here.</p>
          <Link
            href="/drill"
            className="inline-block px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
          >
            Start Drilling
          </Link>
        </div>
      </div>
    );
  }

  const pct = Math.round((totalCorrect / totalQuestions) * 100);
  const grade =
    pct >= 90 ? 'A' : pct >= 80 ? 'B' : pct >= 70 ? 'C' : pct >= 60 ? 'D' : 'F';
  const gradeColor =
    pct >= 90
      ? 'text-green-400'
      : pct >= 70
        ? 'text-yellow-400'
        : 'text-red-400';

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-24 md:pb-6">
      {/* Score Card */}
      <div className="bg-slate-800 rounded-xl p-6 mb-6 text-center">
        <h1 className="text-lg text-slate-400 mb-2">Drill Results</h1>
        <div className={`text-6xl font-bold ${gradeColor} mb-2`}>{grade}</div>
        <div className="text-2xl text-slate-200">
          {totalCorrect}/{totalQuestions} correct ({pct}%)
        </div>
        <div className="flex justify-center gap-6 mt-4 text-sm">
          <div>
            <span className="text-green-400 font-bold">{totalCorrect}</span>
            <span className="text-slate-400 ml-1">correct</span>
          </div>
          <div>
            <span className="text-red-400 font-bold">{allErrors.length}</span>
            <span className="text-slate-400 ml-1">wrong</span>
          </div>
        </div>
      </div>

      {/* Error Analysis by Series */}
      {groups.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-bold text-slate-200 mb-4 flex items-center gap-2">
            <span>❌</span> Error Analysis by Series
          </h2>

          {groups.map((group, gi) => (
            <div key={gi} className="bg-slate-800 rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-slate-200">
                  {group.series} Series
                  <span className="text-sm text-red-400 ml-2">
                    ({group.errors.length} error{group.errors.length > 1 ? 's' : ''})
                  </span>
                </h3>
              </div>

              {group.errors.map((err, ei) => {
                const q = err.question;
                const correctActions = Object.entries(q.correct)
                  .filter(([k, v]) => k !== 'ev' && (v as number) > 0)
                  .map(([k, v]) => ({ action: k, pct: v as number }))
                  .sort((a, b) => b.pct - a.pct);

                return (
                  <div
                    key={ei}
                    className="border-t border-slate-700 pt-3 mt-3 first:border-0 first:pt-0 first:mt-0"
                  >
                    <div className="flex items-center gap-2 text-sm text-slate-400 mb-2">
                      <span className="bg-slate-700 px-2 py-0.5 rounded text-xs">
                        {SCENARIO_LABELS[q.scenario] || q.scenario}
                      </span>
                      <span>{q.position}</span>
                      {q.vs && <span>vs {q.vs}</span>}
                      <span>{q.bb}bb</span>
                    </div>

                    <div className="flex items-center gap-4 mb-2">
                      <span className="font-mono text-lg text-white font-bold">
                        {q.hand}
                      </span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 text-sm mb-1">
                          <span className="text-red-400">Your:</span>
                          <span className="text-slate-300">
                            {err.selectedAction} {err.selectedPct}%
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-green-400">GTO:</span>
                          <span className="text-slate-300">
                            {correctActions.map((a) => `${a.action} ${a.pct}%`).join(' / ')}
                          </span>
                        </div>
                      </div>
                    </div>

                    <ActionBar actions={correctActions} />
                  </div>
                );
              })}

              {/* Memory Anchor */}
              <div className="mt-4 bg-slate-900 rounded-lg p-3 border border-slate-600">
                <div className="text-xs text-amber-400 font-bold mb-1">📌 Memory Anchor</div>
                <div className="text-sm text-slate-300">{getMemoryAnchor(group)}</div>
              </div>

              <ComparisonTable group={group} />
            </div>
          ))}
        </div>
      )}

      {/* All Answers */}
      <div className="mb-6">
        <h2 className="text-lg font-bold text-slate-200 mb-4">All Answers</h2>
        <div className="space-y-2">
          {answers.map((ans, i) => {
            const q = ans.question;
            const correctActions = Object.entries(q.correct)
              .filter(([k, v]) => k !== 'ev' && (v as number) > 0)
              .map(([k, v]) => ({ action: k, pct: v as number }))
              .sort((a, b) => b.pct - a.pct);
            const primary = correctActions[0];

            return (
              <div
                key={i}
                className={`flex items-center gap-3 p-3 rounded-lg ${
                  ans.isCorrect ? 'bg-green-950/30' : 'bg-red-950/30'
                }`}
              >
                <span className="text-lg">{ans.isCorrect ? '✅' : '❌'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono font-bold text-white">{q.hand}</span>
                    <span className="text-slate-400 text-xs truncate">
                      {q.position} {q.vs ? `vs ${q.vs}` : ''} {q.bb}bb
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {ans.selectedAction} {ans.selectedPct}% →{' '}
                    {primary ? `${primary.action} ${primary.pct}%` : 'N/A'}
                  </div>
                </div>
                <div className="w-20">
                  <ActionBar actions={correctActions} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Link
          href="/drill"
          className="flex-1 text-center px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
        >
          Drill Again
        </Link>
        <Link
          href="/"
          className="flex-1 text-center px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
        >
          Home
        </Link>
      </div>
    </div>
  );
}
