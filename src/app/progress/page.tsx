'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { SCENARIO_LABELS, SCENARIO_ORDER } from '@/lib/types';
import {
  getProgress,
  countWeakHands,
  type ProgressData,
} from '@/lib/progress';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelative(ts: number): string {
  const now = Date.now();
  const diffMs = now - ts;
  if (diffMs < 60_000) return 'just now';
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

/** Pick the accent color stripe for a scenario card based on error rate. */
function accentForErrorRate(errorRate: number, hasData: boolean): {
  stripe: string; ring: string; text: string;
} {
  if (!hasData) return { stripe: 'bg-slate-700', ring: 'stroke-slate-700', text: 'text-slate-500' };
  if (errorRate >= 0.3) return { stripe: 'bg-rose-500', ring: 'stroke-rose-400', text: 'text-rose-300' };
  if (errorRate >= 0.15) return { stripe: 'bg-amber-500', ring: 'stroke-amber-400', text: 'text-amber-300' };
  return { stripe: 'bg-emerald-500', ring: 'stroke-emerald-400', text: 'text-emerald-300' };
}

// ---------------------------------------------------------------------------
// Progress ring — SVG circular progress
// ---------------------------------------------------------------------------

function ProgressRing({
  pct,
  ringClass,
  size = 56,
  stroke = 4,
}: {
  pct: number;
  ringClass: string;
  size?: number;
  stroke?: number;
}) {
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const offset = circ * (1 - pct / 100);
  return (
    <svg width={size} height={size} className="shrink-0" style={{ transform: 'rotate(-90deg)' }}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        className="stroke-slate-700"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        className={`${ringClass} transition-[stroke-dashoffset] duration-500`}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Scenario mastery card
// ---------------------------------------------------------------------------

interface ScenarioCardProps {
  scenario: string;
  total: number;
  correct: number;
  lastPracticed: number | null;
  weakSpotCount: number;
}

function ScenarioCard({ scenario, total, correct, lastPracticed, weakSpotCount }: ScenarioCardProps) {
  const hasData = total > 0;
  const pct = hasData ? Math.round((correct / total) * 100) : 0;
  const errorRate = hasData ? (total - correct) / total : 0;
  const accent = accentForErrorRate(errorRate, hasData);
  const label = SCENARIO_LABELS[scenario] || scenario;

  return (
    <Link
      href={`/progress/${encodeURIComponent(scenario)}`}
      className={`
        relative block rounded-xl overflow-hidden
        bg-slate-800/80 border border-slate-700/60
        hover:border-slate-500 hover:bg-slate-800 active:scale-[0.98]
        transition-all
        ${!hasData ? 'border-dashed' : ''}
      `}
    >
      {/* Left accent stripe */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${accent.stripe}`} />

      <div className="pl-4 pr-4 py-3 flex items-center gap-4">
        {/* Ring */}
        <ProgressRing pct={pct} ringClass={accent.ring} />

        {/* Middle column */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div className="font-bold text-slate-100 truncate">{label}</div>
            {weakSpotCount > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 tabular-nums">
                {weakSpotCount} weak
              </span>
            )}
          </div>
          {hasData ? (
            <div className="text-xs text-slate-400 tabular-nums">
              <span className="text-slate-300 font-semibold">{correct}</span>
              <span className="text-slate-500">/{total}</span>
              <span className="mx-2 text-slate-600">·</span>
              <span className={accent.text + ' font-semibold'}>{pct}%</span>
              {lastPracticed && (
                <>
                  <span className="mx-2 text-slate-600">·</span>
                  <span>{formatRelative(lastPracticed)}</span>
                </>
              )}
            </div>
          ) : (
            <div className="text-xs text-slate-500 italic">Not drilled yet — start now →</div>
          )}
        </div>

        {/* Chevron */}
        <div className="text-slate-500 text-lg shrink-0">›</div>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProgressPage() {
  const [progress, setProgress] = useState<ProgressData | null>(null);

  useEffect(() => {
    setProgress(getProgress());
  }, []);

  const scenarioCards = useMemo(() => {
    if (!progress) return [];
    const cards: Array<ScenarioCardProps & {
      errorRate: number;
      practiced: boolean;
    }> = SCENARIO_ORDER.map((scenario) => {
      const stat = progress.byScenario[scenario];
      const total = stat?.total ?? 0;
      const correct = stat?.correct ?? 0;
      return {
        scenario,
        total,
        correct,
        lastPracticed: stat?.lastPracticed ?? null,
        weakSpotCount: total > 0 ? countWeakHands(scenario) : 0,
        errorRate: total > 0 ? (total - correct) / total : 0,
        practiced: total > 0,
      };
    });

    // Sort: practiced scenarios first (by error rate desc — weakest on top),
    // then unpracticed scenarios (in declaration order).
    cards.sort((a, b) => {
      if (a.practiced && !b.practiced) return -1;
      if (!a.practiced && b.practiced) return 1;
      if (!a.practiced && !b.practiced) return 0;
      return b.errorRate - a.errorRate || b.total - a.total;
    });
    return cards;
  }, [progress]);

  if (!progress) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  const totalSessions = progress.sessions.length;
  const totalQuestions = progress.sessions.reduce((s, r) => s + r.total, 0);
  const totalCorrect = progress.sessions.reduce((s, r) => s + r.correct, 0);
  const overallPct = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;

  const recentSessions = [...progress.sessions]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 10);

  if (totalSessions === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="text-center py-16">
          <div className="text-6xl mb-4">📊</div>
          <h2 className="text-xl font-bold text-slate-200 mb-2">No Progress Yet</h2>
          <p className="text-slate-400 mb-6">Start drilling to track your progress here.</p>
          <Link
            href="/drill"
            className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold transition-colors"
          >
            Start Drilling
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-24 md:pb-6">
      <h1 className="text-2xl font-bold text-slate-100 mb-6">Progress Dashboard</h1>

      {/* Hero stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-slate-800 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-slate-100 tabular-nums">{totalSessions}</div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 mt-1">Sessions</div>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-slate-100 tabular-nums">{totalQuestions}</div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 mt-1">Questions</div>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 text-center">
          <div className={`text-3xl font-bold tabular-nums ${
            overallPct >= 80 ? 'text-emerald-400' : overallPct >= 60 ? 'text-amber-400' : 'text-rose-400'
          }`}>{overallPct}%</div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 mt-1">Accuracy</div>
        </div>
      </div>

      {/* Scenario Mastery */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3 px-1">
          <h2 className="font-bold text-slate-200">Scenario Mastery</h2>
          <span className="text-[11px] text-slate-500 uppercase tracking-wider">Tap to drill down</span>
        </div>
        <div className="space-y-2">
          {scenarioCards.map((c) => (
            <ScenarioCard key={c.scenario} {...c} />
          ))}
        </div>
      </div>

      {/* Recent Sessions */}
      <div className="bg-slate-800 rounded-xl p-4 mb-6">
        <h2 className="font-bold text-slate-200 mb-4">Recent Sessions</h2>
        <div className="space-y-2">
          {recentSessions.map((s) => {
            const pct = s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
            const date = new Date(s.timestamp);
            return (
              <div key={s.id} className="flex items-center justify-between py-2 border-b border-slate-700 last:border-0">
                <div className="min-w-0">
                  <div className="text-sm text-slate-300 truncate">
                    {(s.scenario.split(',').map((x) => SCENARIO_LABELS[x] || x)).join(', ')}
                  </div>
                  <div className="text-xs text-slate-500 tabular-nums">
                    {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <div className="text-right tabular-nums">
                  <div className={`font-bold ${pct >= 80 ? 'text-emerald-400' : pct >= 60 ? 'text-amber-400' : 'text-rose-400'}`}>
                    {pct}%
                  </div>
                  <div className="text-xs text-slate-400">
                    {s.correct}/{s.total}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Data sync */}
      <div className="bg-slate-800 rounded-xl p-4">
        <h2 className="font-bold text-slate-200 mb-3">Data Sync</h2>
        <p className="text-sm text-slate-400 mb-3">
          Export your progress to sync across devices, or import from a backup.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => {
              const data = JSON.stringify(progress, null, 2);
              const blob = new Blob([data], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `gto-drill-progress-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold transition-colors"
          >
            Export JSON
          </button>
          <label className="flex-1">
            <div className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-semibold transition-colors text-center cursor-pointer">
              Import JSON
            </div>
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  try {
                    const data = JSON.parse(reader.result as string);
                    localStorage.setItem('drillProgressV2', JSON.stringify(data));
                    setProgress(data);
                    alert('Progress imported successfully!');
                  } catch {
                    alert('Invalid file format.');
                  }
                };
                reader.readAsText(file);
              }}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
