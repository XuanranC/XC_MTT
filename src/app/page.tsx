'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { IndexData, ScenarioMeta, SCENARIO_LABELS, compareScenarios } from '@/lib/types';

function sortScenarios(scenarios: ScenarioMeta[]): ScenarioMeta[] {
  return [...scenarios].sort((a, b) => compareScenarios(a.name, b.name));
}

export default function Home() {
  const [index, setIndex] = useState<IndexData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/data/index.json')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load scenarios');
        return res.json();
      })
      .then((data: IndexData) => setIndex(data))
      .catch((err) => setError(err.message));
  }, []);

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

  if (!index) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-text-secondary text-sm">Loading scenarios...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">
          Preflop Scenarios
        </h1>
        <p className="text-text-secondary text-sm sm:text-base">
          Select a scenario to study GTO preflop ranges. {index.scenarios.length}{' '}
          scenarios available.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sortScenarios(index.scenarios).map((scenario: ScenarioMeta) => (
          <ScenarioCard key={scenario.name} scenario={scenario} />
        ))}
      </div>
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
