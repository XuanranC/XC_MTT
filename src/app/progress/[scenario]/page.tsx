'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  getProgress,
  getWeakHands,
  getPositionStats,
  getBBBucketStats,
  getAttemptsForHand,
  type ProgressData,
  type WeakHandEntry,
  type AttemptRecord,
} from '@/lib/progress';
import {
  SCENARIO_LABELS,
  ACTION_COLORS,
  ACTION_LABELS,
  type Chart,
} from '@/lib/types';
import { getScenarioData } from '@/lib/data';
import { RangeMatrixModal } from '@/components/RangeMatrixModal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelative(ts: number): string {
  const diffMs = Date.now() - ts;
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

function errorRateColor(rate: number, hasData: boolean = true): string {
  if (!hasData) return 'text-slate-500';
  if (rate >= 0.3) return 'text-rose-400';
  if (rate >= 0.15) return 'text-amber-400';
  return 'text-emerald-400';
}

function errorBarColor(rate: number): string {
  if (rate >= 0.3) return 'bg-rose-500/70';
  if (rate >= 0.15) return 'bg-amber-500/70';
  return 'bg-emerald-500/70';
}

// ---------------------------------------------------------------------------
// Hand Detail Modal (Level 3)
// ---------------------------------------------------------------------------

interface HandDetailModalProps {
  scenario: string;
  hand: WeakHandEntry;
  onClose: () => void;
  onOpenRangeModal: (attempt: AttemptRecord) => void;
}

function HandDetailModal({ scenario, hand, onClose, onOpenRangeModal }: HandDetailModalProps) {
  const attempts = useMemo(() => getAttemptsForHand(scenario, hand.hand, 30), [scenario, hand.hand]);
  const errorPct = Math.round(hand.errorRate * 100);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-sm p-3"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 rounded-xl w-full max-w-lg shadow-2xl border border-white/10 max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 sticky top-0 bg-slate-900 z-10">
          <div className="flex items-baseline gap-3 min-w-0">
            <span className="text-2xl font-extrabold text-white font-mono">{hand.hand}</span>
            <span className="text-xs text-slate-500 truncate">
              {SCENARIO_LABELS[scenario] || scenario}
            </span>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white text-2xl leading-none px-2">
            &times;
          </button>
        </div>

        {/* Summary row */}
        <div className="px-4 py-3 border-b border-white/5 flex items-center gap-4">
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Accuracy</div>
            <div className="text-lg font-bold tabular-nums">
              <span className="text-slate-200">{hand.correct}</span>
              <span className="text-slate-500">/{hand.total}</span>
            </div>
          </div>
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Error rate</div>
            <div className={`text-lg font-bold tabular-nums ${errorRateColor(hand.errorRate)}`}>
              {errorPct}%
            </div>
          </div>
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Attempts</div>
            <div className="text-lg font-bold text-slate-200 tabular-nums">{attempts.length}</div>
          </div>
        </div>

        {/* Attempts list */}
        <div className="px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Recent attempts</div>
          {attempts.length === 0 ? (
            <div className="text-sm text-slate-400 italic py-4 text-center">
              No detailed attempts recorded yet for this hand.
            </div>
          ) : (
            <div className="space-y-1.5">
              {attempts.map((a, i) => {
                const ctx = `${a.position}${a.vs ? ` vs ${a.vs}` : ''} · ${a.bb}bb`;
                const primary = a.gtoActions[0];
                const selectedColor = ACTION_COLORS[a.selected] || '#888';
                const primaryColor = primary ? ACTION_COLORS[primary.action] || '#888' : '#888';
                return (
                  <button
                    key={`${a.timestamp}-${i}`}
                    onClick={() => onOpenRangeModal(a)}
                    className={`
                      w-full text-left rounded-lg border transition-all
                      hover:bg-white/5 active:scale-[0.98]
                      ${a.isCorrect
                        ? 'border-emerald-700/40 bg-emerald-950/20'
                        : 'border-rose-700/40 bg-rose-950/20'}
                    `}
                  >
                    <div className="p-3 flex items-center gap-3">
                      <span className="text-lg shrink-0">
                        {a.isCorrect ? '\u2705' : '\u274C'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-xs font-mono text-slate-400 mb-1">
                          <span className="text-slate-300">{ctx}</span>
                          <span className="text-slate-600">·</span>
                          <span>{formatRelative(a.timestamp)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs flex-wrap">
                          <span className="text-slate-500">You:</span>
                          <span className="font-bold" style={{ color: selectedColor }}>
                            {ACTION_LABELS[a.selected] || a.selected}
                          </span>
                          <span className="text-slate-600">→</span>
                          <span className="text-slate-500">GTO:</span>
                          {a.gtoActions.slice(0, 3).map((g) => {
                            const reach = a.reach ?? 100;
                            const normalized = reach > 0.5 ? Math.round((g.pct / reach) * 100) : 0;
                            return (
                              <span
                                key={g.action}
                                className="font-semibold"
                                style={{ color: ACTION_COLORS[g.action] || '#888' }}
                              >
                                {ACTION_LABELS[g.action] || g.action} {normalized}%
                              </span>
                            );
                          })}
                        </div>
                      </div>
                      <span className="text-slate-600 text-sm shrink-0" aria-hidden>›</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* CTAs */}
        <div className="px-4 py-3 border-t border-white/5 flex flex-col sm:flex-row gap-2 bg-slate-900 sticky bottom-0">
          {attempts.length > 0 && (
            <button
              onClick={() => onOpenRangeModal(attempts[0])}
              className="flex-1 py-2.5 rounded-lg text-sm font-bold border border-sky-400/40 text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 active:scale-95 transition-all"
            >
              查看此手牌正确范围
            </button>
          )}
          <Link
            href={`/drill?scenario=${encodeURIComponent(scenario)}`}
            className="flex-1 py-2.5 rounded-lg text-sm font-bold text-center border border-emerald-400/40 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 active:scale-95 transition-all"
          >
            Drill this scenario ↗
          </Link>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ScenarioDetailPage() {
  const params = useParams<{ scenario: string }>();
  const scenario = decodeURIComponent(params.scenario);
  const label = SCENARIO_LABELS[scenario] || scenario;

  const [progress, setProgress] = useState<ProgressData | null>(null);
  // Chart cache values:
  //   Chart  — loaded successfully
  //   null   — loaded but no matching chart found (position/bb/vs mismatch)
  //   'loading' — fetch in flight
  //   absent (undefined in the map) — never fetched
  const [chartCache, setChartCache] = useState<Record<string, Chart | null | 'loading'>>({});
  // Ref mirror so the fetch effect can read cache state without subscribing
  // (subscribing causes the effect's cleanup to fire mid-fetch and set
  // cancelled=true, leaving the modal stuck in the loading state).
  const chartCacheRef = useRef(chartCache);
  chartCacheRef.current = chartCache;
  const [selectedHand, setSelectedHand] = useState<WeakHandEntry | null>(null);
  const [rangeModalAttempt, setRangeModalAttempt] = useState<AttemptRecord | null>(null);

  useEffect(() => {
    setProgress(getProgress());
  }, []);

  // Lazy-load chart when the range modal opens so the common "skim weak
  // hands without opening range modal" path doesn't pay the network cost.
  useEffect(() => {
    if (!rangeModalAttempt) return;
    const key = `${rangeModalAttempt.scenario}|${rangeModalAttempt.position}|${rangeModalAttempt.vs ?? ''}|${rangeModalAttempt.bb}`;
    if (chartCacheRef.current[key] !== undefined) return;

    let cancelled = false;
    setChartCache((prev) => ({ ...prev, [key]: 'loading' }));
    getScenarioData(rangeModalAttempt.scenario)
      .then((data) => {
        if (cancelled) return;
        const chart = data?.charts.find((c) =>
          c.position === rangeModalAttempt.position &&
          c.bb === rangeModalAttempt.bb &&
          (c.vs ?? undefined) === (rangeModalAttempt.vs ?? undefined)
        );
        // Distinguish "loaded but no match" (null) from "never loaded".
        setChartCache((prev) => ({ ...prev, [key]: chart ?? null }));
      })
      .catch(() => {
        if (cancelled) return;
        setChartCache((prev) => ({ ...prev, [key]: null }));
      });
    return () => { cancelled = true; };
  }, [rangeModalAttempt]);

  const weakHands = useMemo(
    () => (progress ? getWeakHands(scenario, { minAttempts: 3, minErrorRate: 0.3, limit: 20 }) : []),
    [progress, scenario],
  );
  const positionStats = useMemo(
    () => (progress ? getPositionStats(scenario) : []),
    [progress, scenario],
  );
  const bbStats = useMemo(
    () => (progress ? getBBBucketStats(scenario) : []),
    [progress, scenario],
  );

  if (!progress) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  const scenarioStat = progress.byScenario[scenario];
  const total = scenarioStat?.total ?? 0;
  const correct = scenarioStat?.correct ?? 0;
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  const errorRate = total > 0 ? (total - correct) / total : 0;

  // The attempt chart used by the range modal
  const currentChartEntry = rangeModalAttempt
    ? chartCache[
        `${rangeModalAttempt.scenario}|${rangeModalAttempt.position}|${rangeModalAttempt.vs ?? ''}|${rangeModalAttempt.bb}`
      ]
    : undefined;
  const currentChart =
    currentChartEntry && currentChartEntry !== 'loading' ? currentChartEntry : null;
  const chartIsLoading = currentChartEntry === 'loading' || currentChartEntry === undefined;
  const chartNotFound = currentChartEntry === null;

  return (
    <div className="max-w-3xl mx-auto px-4 py-5 pb-24 md:pb-5">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <Link
          href="/progress"
          className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          aria-label="Back"
        >
          ←
        </Link>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Scenario</div>
          <h1 className="text-xl font-bold text-slate-100 truncate">{label}</h1>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-2xl font-bold tabular-nums ${errorRateColor(errorRate, total > 0)}`}>
            {total > 0 ? `${pct}%` : '—'}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 tabular-nums">
            {total > 0 ? `${correct}/${total}` : 'no data'}
          </div>
        </div>
      </div>

      {total === 0 ? (
        <div className="bg-slate-800 rounded-xl p-8 text-center border border-dashed border-slate-700">
          <div className="text-4xl mb-3">🎯</div>
          <h2 className="text-lg font-bold text-slate-200 mb-1">Not drilled yet</h2>
          <p className="text-sm text-slate-400 mb-5">Start a drill for this scenario to see weak hands, positions, and bb ranges.</p>
          <Link
            href={`/drill?scenario=${encodeURIComponent(scenario)}`}
            className="inline-block px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold transition-colors"
          >
            Start drilling
          </Link>
        </div>
      ) : (
        <>
          {/* (A) Weak Hands */}
          <section className="bg-slate-800/80 rounded-xl p-4 mb-4 border border-slate-700/60">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-bold text-slate-200">Weak Hands</h2>
              <span className="text-[11px] text-slate-500">{'>'}30% err · min 3 attempts</span>
            </div>
            {weakHands.length === 0 ? (
              <div className="text-sm text-slate-400 italic py-3 text-center">
                No weak hands yet — keep drilling to surface them.
              </div>
            ) : (
              <div className="space-y-1">
                {weakHands.map((h) => {
                  const errPct = Math.round(h.errorRate * 100);
                  return (
                    <button
                      key={h.hand}
                      onClick={() => setSelectedHand(h)}
                      className="w-full text-left flex items-center justify-between py-2 px-2 rounded-lg hover:bg-white/5 active:scale-[0.98] transition-all group"
                    >
                      <span className="font-mono font-bold text-white text-base">{h.hand}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-400 tabular-nums">
                          {h.correct}/{h.total}
                        </span>
                        <span className="text-sm text-rose-400 font-bold tabular-nums w-14 text-right">
                          {errPct}% err
                        </span>
                        <span className="text-slate-600 text-sm group-hover:text-slate-400 transition-colors">›</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* (B) Weak Positions */}
          <section className="bg-slate-800/80 rounded-xl p-4 mb-4 border border-slate-700/60">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-bold text-slate-200">Weak Positions</h2>
              <span className="text-[11px] text-slate-500">by error rate</span>
            </div>
            {positionStats.length === 0 ? (
              <div className="text-sm text-slate-400 italic py-3 text-center">
                No position data yet.
              </div>
            ) : (
              <div className="space-y-2.5">
                {positionStats.map((p) => {
                  const errPct = Math.round(p.errorRate * 100);
                  return (
                    <div key={p.position} className="flex items-center gap-3">
                      <span className="font-mono font-bold text-slate-200 w-12 shrink-0 text-sm">
                        {p.position}
                      </span>
                      <div className="flex-1 h-2 bg-slate-700/50 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${errorBarColor(p.errorRate)} transition-all duration-500`}
                          style={{ width: `${Math.max(errPct, 2)}%` }}
                        />
                      </div>
                      <span className={`text-sm font-bold tabular-nums w-12 text-right ${errorRateColor(p.errorRate)}`}>
                        {errPct}%
                      </span>
                      <span className="text-[11px] text-slate-500 tabular-nums w-12 text-right">
                        {p.correct}/{p.total}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* (C) Weak BB Ranges */}
          <section className="bg-slate-800/80 rounded-xl p-4 mb-4 border border-slate-700/60">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-bold text-slate-200">Weak BB Ranges</h2>
              <span className="text-[11px] text-slate-500">by stack depth</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {bbStats.map((b) => {
                const hasData = b.total > 0;
                const errPct = Math.round(b.errorRate * 100);
                return (
                  <div
                    key={b.bucket}
                    className={`
                      rounded-lg p-3 border transition-all
                      ${hasData
                        ? b.errorRate >= 0.3
                          ? 'border-rose-500/40 bg-rose-950/20'
                          : b.errorRate >= 0.15
                          ? 'border-amber-500/30 bg-amber-950/10'
                          : 'border-emerald-500/30 bg-emerald-950/10'
                        : 'border-slate-700 bg-slate-800/40 border-dashed'}
                    `}
                  >
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">{b.label}</div>
                    <div className="text-sm font-mono text-slate-300 mb-2 tabular-nums">{b.bucket} bb</div>
                    {hasData ? (
                      <>
                        <div className={`text-2xl font-bold tabular-nums ${errorRateColor(b.errorRate)}`}>
                          {errPct}%
                        </div>
                        <div className="text-[11px] text-slate-500 tabular-nums">
                          {b.correct}/{b.total} correct
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-slate-600 italic py-1">No data</div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}

      {/* Hand Detail Modal (Level 3) */}
      {selectedHand && (
        <HandDetailModal
          scenario={scenario}
          hand={selectedHand}
          onClose={() => setSelectedHand(null)}
          onOpenRangeModal={(attempt) => setRangeModalAttempt(attempt)}
        />
      )}

      {/* Range Matrix Modal (on top of Hand Detail) */}
      {rangeModalAttempt && currentChart && (
        <RangeMatrixModal
          chart={currentChart}
          title={`${SCENARIO_LABELS[rangeModalAttempt.scenario] || rangeModalAttempt.scenario} · ${rangeModalAttempt.position}${rangeModalAttempt.vs ? ` vs ${rangeModalAttempt.vs}` : ''} · ${rangeModalAttempt.bb}bb`}
          highlightHand={rangeModalAttempt.hand}
          scenario={rangeModalAttempt.scenario}
          position={rangeModalAttempt.position}
          vs={rangeModalAttempt.vs}
          bb={rangeModalAttempt.bb}
          onClose={() => setRangeModalAttempt(null)}
        />
      )}

      {/* Loading state while chart fetches */}
      {rangeModalAttempt && chartIsLoading && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setRangeModalAttempt(null)}
        >
          <div className="bg-slate-900 px-5 py-3 rounded-lg text-slate-300 text-sm">
            Loading chart…
          </div>
        </div>
      )}

      {/* Chart not found — bb/position combo doesn't exist in this scenario */}
      {rangeModalAttempt && chartNotFound && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setRangeModalAttempt(null)}
        >
          <div
            className="bg-slate-900 px-5 py-4 rounded-lg border border-white/10 max-w-sm text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-amber-400 text-xs font-bold uppercase tracking-wider mb-2">Chart unavailable</div>
            <div className="text-sm text-slate-300 mb-3">
              No chart for {rangeModalAttempt.position} · {rangeModalAttempt.bb}bb
              {rangeModalAttempt.vs ? ` vs ${rangeModalAttempt.vs}` : ''} in this scenario.
            </div>
            <button
              onClick={() => setRangeModalAttempt(null)}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-white transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
