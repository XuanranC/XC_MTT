'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { IndexData, ScenarioMeta, SCENARIO_LABELS, compareScenarios } from '@/lib/types';
import { getIndex, setGameType, DEFAULT_GAME_TYPE } from '@/lib/data';
import type { GameType } from '@/lib/data';

const GAME_TYPE_STORAGE_KEY = 'gto_drill_game_type';

function sortScenarios(scenarios: ScenarioMeta[]): ScenarioMeta[] {
  return [...scenarios].sort((a, b) => compareScenarios(a.name, b.name));
}

export default function Home() {
  const [gameType, setGameTypeState] = useState<GameType>(DEFAULT_GAME_TYPE);
  const [index, setIndex] = useState<IndexData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // On mount: restore game type from localStorage, set in data module, then load index.
  useEffect(() => {
    let initial: GameType = DEFAULT_GAME_TYPE;
    try {
      const saved = localStorage.getItem(GAME_TYPE_STORAGE_KEY);
      if (saved === 'mtt' || saved === '6max_100bb') initial = saved;
    } catch { /* SSR / disabled storage */ }
    setGameType(initial);
    setGameTypeState(initial);
    getIndex()
      .then(setIndex)
      .catch((err) => setError(err.message));
  }, []);

  const handleGameTypeChange = useCallback(async (gt: GameType) => {
    if (gt === gameType) return;
    setGameType(gt);
    setGameTypeState(gt);
    try { localStorage.setItem(GAME_TYPE_STORAGE_KEY, gt); } catch { /* noop */ }
    setIndex(null);
    setError(null);
    try {
      const idx = await getIndex();
      setIndex(idx);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [gameType]);

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <p className="text-fold text-lg font-medium mb-2">
            Failed to load scenarios
          </p>
          <p className="text-text-secondary text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">
          Preflop Scenarios
        </h1>
        <p className="text-text-secondary text-sm sm:text-base">
          Select a scenario to study GTO preflop ranges.
        </p>
      </div>

      {/* Game type tab — MTT vs 6-Max 100bb */}
      <div className="mb-6 flex gap-2">
        {([
          { gt: 'mtt' as GameType, label: 'MTT', sub: '短栈训练 2-100bb' },
          { gt: '6max_100bb' as GameType, label: '6-Max 100bb', sub: '线上常规桌' },
        ]).map(({ gt, label, sub }) => {
          const active = gameType === gt;
          return (
            <button
              key={gt}
              onClick={() => handleGameTypeChange(gt)}
              className={`flex-1 sm:flex-initial px-4 py-3 rounded-lg text-sm font-medium transition-colors text-left ${
                active
                  ? 'bg-purple-600 text-white shadow-lg'
                  : 'bg-bg-card text-text-secondary hover:bg-bg-hover'
              }`}
            >
              <div className="font-bold">{label}</div>
              <div className={`text-xs mt-0.5 ${active ? 'text-purple-100' : 'text-text-secondary/60'}`}>{sub}</div>
            </button>
          );
        })}
      </div>

      {!index ? (
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-text-secondary text-sm">Loading scenarios...</p>
          </div>
        </div>
      ) : (
        <>
          <p className="text-text-secondary text-sm mb-4">
            {index.scenarios.length} scenarios available · 当前模式: {gameType === 'mtt' ? 'MTT' : '6-Max 100bb'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortScenarios(index.scenarios).map((scenario: ScenarioMeta) => (
              <ScenarioCard key={scenario.name} scenario={scenario} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ScenarioCard({ scenario }: { scenario: ScenarioMeta }) {
  const label = SCENARIO_LABELS[scenario.name] || scenario.name;
  const bbMin = Math.min(...scenario.bbs);
  const bbMax = Math.max(...scenario.bbs);
  const bbRange = bbMin === bbMax ? `${bbMin}bb` : `${bbMin}-${bbMax}bb`;

  return (
    <Link
      href={`/study/${scenario.name}`}
      className="group block rounded-lg border border-white/8 bg-bg-card hover:border-accent/40 hover:bg-bg-hover/60 transition-all duration-200"
    >
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <h2 className="text-base font-semibold text-text-primary group-hover:text-accent transition-colors leading-tight">
            {label}
          </h2>
          <span className="shrink-0 ml-2 text-xs font-mono bg-white/5 text-text-secondary rounded px-2 py-0.5">
            {scenario.chart_count}
          </span>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-text-secondary w-16 shrink-0">
              Positions
            </span>
            <div className="flex flex-wrap gap-1">
              {scenario.positions.slice(0, 6).map((pos) => (
                <span
                  key={pos}
                  className="text-xs font-mono bg-white/8 text-text-primary rounded px-1.5 py-0.5"
                >
                  {pos}
                </span>
              ))}
              {scenario.positions.length > 6 && (
                <span className="text-xs text-text-secondary">
                  +{scenario.positions.length - 6}
                </span>
              )}
            </div>
          </div>

          {scenario.vs_positions && scenario.vs_positions.length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-text-secondary w-16 shrink-0">VS</span>
              <div className="flex flex-wrap gap-1">
                {scenario.vs_positions.slice(0, 5).map((pos) => (
                  <span
                    key={pos}
                    className="text-xs font-mono bg-white/8 text-text-primary rounded px-1.5 py-0.5"
                  >
                    {pos}
                  </span>
                ))}
                {scenario.vs_positions.length > 5 && (
                  <span className="text-xs text-text-secondary">
                    +{scenario.vs_positions.length - 5}
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 text-sm">
            <span className="text-text-secondary w-16 shrink-0">BB</span>
            <span className="text-xs font-mono text-accent/80">{bbRange}</span>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between">
          <span className="text-xs text-text-secondary">
            {scenario.chart_count} chart{scenario.chart_count !== 1 ? 's' : ''}
          </span>
          <span className="text-xs text-accent opacity-0 group-hover:opacity-100 transition-opacity">
            Study &rarr;
          </span>
        </div>
      </div>
    </Link>
  );
}
