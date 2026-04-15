'use client';

import { use, useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  getScenarioData,
  getIndex,
  findChart,
  getHandActions,
  getPrimaryAction,
  getRangePercent,
} from '@/lib/data';
import {
  ScenarioData,
  IndexData,
  Chart,
  HandData,
  SCENARIO_LABELS,
  ACTION_COLORS,
  RANKS,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Position action order (early to late)
const POSITION_ORDER: string[] = [
  // Full-ring action order
  'UTG', 'UTG1', 'LJ', 'HJ', 'CO', 'BTN',
  // BVB SB side: open, then limp-based lines, then raise-based lines
  'SB', 'SB_LR', 'SB_LA', 'SB_R3', 'SB_RA', 'SB_A',
  // HU SB/BTN combined (sits conceptually like SB)
  'SBBTN', 'SBBTN_LR', 'SBBTN_LA',
  // BB side: default, then faced with limp/raise/allin
  'BB', 'BB_L', 'BB_R', 'BB_A',
];

function sortPositions(positions: string[]): string[] {
  return [...positions].sort((a, b) => {
    const ia = POSITION_ORDER.indexOf(a);
    const ib = POSITION_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

function handName(row: number, col: number): string {
  if (row === col) return `${RANKS[row]}${RANKS[col]}`;
  if (row < col) return `${RANKS[row]}${RANKS[col]}s`;
  return `${RANKS[col]}${RANKS[row]}o`;
}

// ---------------------------------------------------------------------------
// Blind-scenario model (BVB / HU)
//
// These scenarios encode the hero side (SB-side vs BB-side) and the action
// being faced (Open / LR / LA / R3 / RA / L / R / A) in an inconsistent mix of
// `position` and `vs_position` fields. We normalize to (side, action) for the UI.
// ---------------------------------------------------------------------------

const BLIND_SCENARIOS = new Set(['BVB', 'HU_OFFLINE_ANTE', 'HU_ONLINE']);
function isBlindScenario(scenario: string): boolean { return BLIND_SCENARIOS.has(scenario); }

// Multi-vs scenarios: vs_position is encoded "{actor2}_over_{opener}".
// We surface three rows: Position (hero), Open (opener), and the action.
const MULTI_VS_SCENARIOS: Record<string, string> = {
  VS_OPEN_CALL: 'Call',
  VS_OPEN_3BET: '3-Bet',
  VS_OPEN_ALLIN: 'All-In',
};
function isMultiVsScenario(s: string): boolean { return s in MULTI_VS_SCENARIOS; }
function parseMultiVs(vs: string | undefined): { opener: string; actor2: string } | null {
  if (!vs) return null;
  const idx = vs.indexOf('_over_');
  if (idx < 0) return null;
  return { actor2: vs.slice(0, idx), opener: vs.slice(idx + '_over_'.length) };
}
function makeMultiVs(opener: string, actor2: string): string {
  return `${actor2}_over_${opener}`;
}

type BlindSide = 'SB' | 'BB';
const SB_ACTIONS = ['Open', 'LR', 'LA', 'R3', 'RA'] as const;
const BB_ACTIONS = ['L', 'R', 'A'] as const;
const BLIND_ACTION_ORDER = ['Open', 'LR', 'LA', 'R3', 'RA', 'L', 'R', 'A'] as const;
type BlindAction = typeof BLIND_ACTION_ORDER[number];

const BLIND_ACTION_LABELS: Record<BlindAction, string> = {
  Open: 'Open', LR: 'LR', LA: 'LA', R3: 'R3', RA: 'RA', L: 'L', R: 'R', A: 'A',
};
const BLIND_ACTION_TOOLTIPS: Record<BlindAction, string> = {
  Open: 'RFI / 开牌',
  LR: 'Limp → Raise',
  LA: 'Limp → All-In',
  R3: 'Raise → 3-Bet',
  RA: 'Raise → All-In',
  L: '对手 Limp',
  R: '对手 Raise',
  A: '对手 All-In',
};

function blindSideLabel(data: ScenarioData, side: BlindSide): string {
  if (side === 'BB') return 'BB';
  // HU uses SBBTN (SB/BTN combined); BVB uses plain SB
  return data.charts.some(c => c.position === 'SBBTN' || c.position.startsWith('SBBTN_')) ? 'SB/BTN' : 'SB';
}

// Resolve (side, action) → underlying (position, vs) if data exists, else null.
function blindToRaw(data: ScenarioData, side: BlindSide, action: BlindAction): { position: string; vs: string | undefined } | null {
  const sbKey = data.charts.some(c => c.position === 'SB' || c.position.startsWith('SB_')) ? 'SB' : 'SBBTN';
  const sideKey = side === 'SB' ? sbKey : 'BB';
  const candidates: [string, string | undefined][] = action === 'Open'
    ? [[sideKey, undefined]]
    : [[`${sideKey}_${action}`, undefined], [sideKey, action]];
  for (const [p, v] of candidates) {
    if (data.charts.some(c => c.position === p && (v ? c.vs === v : c.vs == null))) {
      return { position: p, vs: v };
    }
  }
  return null;
}

// Parse underlying (position, vs) → (side, action). Falls back to defaults.
function rawToBlind(position: string, vs: string | undefined): { side: BlindSide; action: BlindAction } {
  if (position === 'SB' || position === 'SBBTN') {
    return { side: 'SB', action: (vs as BlindAction) ?? 'Open' };
  }
  if (position.startsWith('SB_')) return { side: 'SB', action: position.slice(3) as BlindAction };
  if (position.startsWith('SBBTN_')) return { side: 'SB', action: position.slice(6) as BlindAction };
  if (position === 'BB') return { side: 'BB', action: (vs as BlindAction) ?? 'L' };
  if (position.startsWith('BB_')) return { side: 'BB', action: position.slice(3) as BlindAction };
  return { side: 'SB', action: 'Open' };
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function cellBackground(hand: HandData | undefined): string {
  // Missing entry ⇒ unreachable at this node (or pure fold pruned from JSON).
  if (!hand) return 'rgba(0,0,0,0.15)';
  const reach = hand.reach ?? 100;
  // Unreachable ⇒ darker void so user sees "此节点不涉及此手牌".
  if (reach < 0.5) return 'rgba(0,0,0,0.55)';
  const actions = getHandActions(hand);
  if (actions.length === 0) return 'rgba(0,0,0,0.15)';
  // Filter trivial slivers (< 1% of reach, i.e. < reach/100) so pixel noise
  // doesn't paint visible stripes.
  const threshold = Math.max(0.5, reach * 0.01);
  const nonFold = actions.filter((a) => a.action !== 'fold' && a.pct >= threshold);
  if (nonFold.length === 0) return 'rgba(0,0,0,0.15)';
  // Alpha inside the reached portion tracks play share WITHIN reach.
  // K5o reach=100 call=36.5 → alpha=0.365. TT reach=50 call=40 → alpha=0.8.
  const totalNonFold = nonFold.reduce((s, a) => s + a.pct, 0);
  const alpha = Math.max(Math.min(totalNonFold / reach, 1), 0.2);
  // Build the action gradient (135° diagonal) within the reached portion.
  let actionGrad: string;
  if (nonFold.length === 1) {
    actionGrad = hexToRgba(ACTION_COLORS[nonFold[0].action] ?? '#888', alpha);
  } else {
    let cumulative = 0;
    const stops: string[] = [];
    for (const a of nonFold) {
      const scaledPct = (a.pct / totalNonFold) * 100;
      const color = hexToRgba(ACTION_COLORS[a.action] ?? '#888', alpha);
      stops.push(`${color} ${cumulative.toFixed(1)}%`);
      cumulative += scaledPct;
      stops.push(`${color} ${cumulative.toFixed(1)}%`);
    }
    actionGrad = `linear-gradient(135deg, ${stops.join(', ')})`;
  }
  // If the node is always reached, just return the action gradient.
  if (reach >= 99.5) return actionGrad;
  // Otherwise overlay a dark band over the top (100-reach)% so the filled
  // area visually equals reach%. Bottom fill = reached, top void = unreached.
  const voidColor = 'rgba(0,0,0,0.72)';
  return `linear-gradient(to top, transparent 0%, transparent ${reach.toFixed(1)}%, ${voidColor} ${reach.toFixed(1)}%, ${voidColor} 100%), ${actionGrad}`;
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    raise: 'Raise',
    call: 'Call',
    fold: 'Fold',
    allin: 'All-In',
  };
  return labels[action] ?? action;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FilterBar({
  scenarioData,
  positions,
  vsPositions,
  bbs,
  selectedPosition,
  selectedVs,
  selectedBb,
  onPositionChange,
  onVsChange,
  onBbChange,
}: {
  scenarioData: ScenarioData;
  positions: string[];
  vsPositions: string[] | null;
  bbs: number[];
  selectedPosition: string;
  selectedVs: string | undefined;
  selectedBb: number;
  onPositionChange: (p: string) => void;
  onVsChange: (v: string | undefined) => void;
  onBbChange: (b: number) => void;
}) {
  // Build validity sets from actual chart data
  const validVsForPosition = useMemo(() => {
    const set = new Set<string>();
    for (const c of scenarioData.charts) {
      if (c.position === selectedPosition && c.vs) set.add(c.vs);
    }
    return set;
  }, [scenarioData, selectedPosition]);

  const validBbsForCombo = useMemo(() => {
    const set = new Set<number>();
    for (const c of scenarioData.charts) {
      if (c.position === selectedPosition && (selectedVs ? c.vs === selectedVs : true)) set.add(c.bb);
    }
    return set;
  }, [scenarioData, selectedPosition, selectedVs]);

  const blind = isBlindScenario(scenarioData.scenario);
  const currentBlind = blind ? rawToBlind(selectedPosition, selectedVs) : null;

  // ---------- Multi-vs (VS_OPEN_CALL / 3BET / ALLIN) ----------
  const multi = isMultiVsScenario(scenarioData.scenario);
  const multiActionLabel = multi ? MULTI_VS_SCENARIOS[scenarioData.scenario] : '';
  const currentMulti = multi ? parseMultiVs(selectedVs) : null;

  // Hero positions = scenarioData.positions, sorted
  const sortedHeroes = useMemo(() => sortPositions(scenarioData.positions), [scenarioData.positions]);

  // Openers available given the current hero
  const openersForHero = useMemo(() => {
    if (!multi) return [] as string[];
    const set = new Set<string>();
    for (const c of scenarioData.charts) {
      if (c.position !== selectedPosition || !c.vs) continue;
      const p = parseMultiVs(c.vs);
      if (p) set.add(p.opener);
    }
    return sortPositions(Array.from(set));
  }, [multi, scenarioData, selectedPosition]);

  // Actor2 positions available given (hero, opener)
  const actor2sForOpener = useMemo(() => {
    if (!multi || !currentMulti) return [] as string[];
    const set = new Set<string>();
    for (const c of scenarioData.charts) {
      if (c.position !== selectedPosition || !c.vs) continue;
      const p = parseMultiVs(c.vs);
      if (p && p.opener === currentMulti.opener) set.add(p.actor2);
    }
    return sortPositions(Array.from(set));
  }, [multi, currentMulti, scenarioData, selectedPosition]);

  // For "Position" row — disable heroes that have no data at all
  const heroHasData = useMemo(() => {
    if (!multi) return new Set<string>();
    const set = new Set<string>();
    for (const c of scenarioData.charts) if (c.vs && parseMultiVs(c.vs)) set.add(c.position);
    return set;
  }, [multi, scenarioData]);

  // Helper: pick first valid (opener, actor2) for a hero
  function firstValidForHero(hero: string): { opener: string; actor2: string } | null {
    const candidates: { opener: string; actor2: string }[] = [];
    for (const c of scenarioData.charts) {
      if (c.position !== hero || !c.vs) continue;
      const p = parseMultiVs(c.vs);
      if (p) candidates.push(p);
    }
    if (candidates.length === 0) return null;
    // Prefer keeping current opener if possible
    if (currentMulti) {
      const same = candidates.find(x => x.opener === currentMulti.opener);
      if (same) return same;
    }
    return candidates[0];
  }

  return (
    <div className="space-y-3">
      {multi ? (
        <>
          {/* Row 1: Position (hero) */}
          <div>
            <label className="block text-xs uppercase tracking-wide text-gray-400 mb-1">Position</label>
            <div className="flex gap-1 overflow-x-auto pb-1">
              {sortedHeroes.map((p) => {
                const valid = heroHasData.has(p);
                return (
                  <button key={p} disabled={!valid}
                    onClick={() => {
                      if (!valid) return;
                      const pick = firstValidForHero(p);
                      onPositionChange(p);
                      if (pick) onVsChange(makeMultiVs(pick.opener, pick.actor2));
                    }}
                    className={`shrink-0 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                      !valid
                        ? 'bg-gray-900 text-gray-600 cursor-not-allowed opacity-40'
                        : p === selectedPosition
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    }`}>{p}</button>
                );
              })}
            </div>
          </div>
          {/* Row 2: Open (opener) */}
          <div>
            <label className="block text-xs uppercase tracking-wide text-gray-400 mb-1">Open</label>
            <div className="flex gap-1 overflow-x-auto pb-1">
              {openersForHero.map((o) => {
                const active = currentMulti?.opener === o;
                return (
                  <button key={o}
                    onClick={() => {
                      // Pick first valid actor2 for (hero, this opener), prefer current actor2.
                      const candidates = new Set<string>();
                      for (const c of scenarioData.charts) {
                        if (c.position !== selectedPosition || !c.vs) continue;
                        const p = parseMultiVs(c.vs);
                        if (p && p.opener === o) candidates.add(p.actor2);
                      }
                      const list = sortPositions(Array.from(candidates));
                      if (list.length === 0) return;
                      const keep = currentMulti && list.includes(currentMulti.actor2) ? currentMulti.actor2 : list[0];
                      onVsChange(makeMultiVs(o, keep));
                    }}
                    className={`shrink-0 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                      active ? 'bg-amber-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    }`}>{o}</button>
                );
              })}
            </div>
          </div>
          {/* Row 3: Action (Call/3-Bet/All-In) — selects actor2 */}
          <div>
            <label className="block text-xs uppercase tracking-wide text-gray-400 mb-1">{multiActionLabel}</label>
            <div className="flex gap-1 overflow-x-auto pb-1">
              {actor2sForOpener.map((a) => {
                const active = currentMulti?.actor2 === a;
                return (
                  <button key={a}
                    onClick={() => {
                      if (!currentMulti) return;
                      onVsChange(makeMultiVs(currentMulti.opener, a));
                    }}
                    className={`shrink-0 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                      active ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    }`}>{a}</button>
                );
              })}
            </div>
          </div>
        </>
      ) : blind && currentBlind ? (
        <>
          {/* Side selector: SB/BTN vs BB */}
          <div>
            <label className="block text-xs uppercase tracking-wide text-gray-400 mb-1">Position</label>
            <div className="flex gap-1 overflow-x-auto pb-1">
              {(['SB', 'BB'] as BlindSide[]).map((s) => (
                <button key={s}
                  onClick={() => {
                    // When side changes, keep the current action if valid, else pick first valid.
                    const candidateActions = s === 'SB' ? SB_ACTIONS : BB_ACTIONS;
                    const first = candidateActions.find(a => blindToRaw(scenarioData, s, a));
                    if (!first) return;
                    const raw = blindToRaw(scenarioData, s, first)!;
                    onPositionChange(raw.position);
                    // vs must be set via onVsChange; signal empty string convention
                    if ((raw.vs ?? undefined) !== selectedVs) onVsChange(raw.vs);
                  }}
                  className={`shrink-0 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                    s === currentBlind.side ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}>{blindSideLabel(scenarioData, s)}</button>
              ))}
            </div>
          </div>
          {/* Action selector */}
          <div>
            <label className="block text-xs uppercase tracking-wide text-gray-400 mb-1">VS Action</label>
            <div className="flex gap-1 overflow-x-auto pb-1">
              {BLIND_ACTION_ORDER.map((a) => {
                const belongs = currentBlind.side === 'SB' ? (SB_ACTIONS as readonly string[]).includes(a) : (BB_ACTIONS as readonly string[]).includes(a);
                const raw = belongs ? blindToRaw(scenarioData, currentBlind.side, a) : null;
                const valid = !!raw;
                return (
                  <button key={a}
                    disabled={!valid}
                    onClick={() => {
                      if (!raw) return;
                      onPositionChange(raw.position);
                      if ((raw.vs ?? undefined) !== (selectedVs ?? undefined)) onVsChange(raw.vs);
                    }}
                    title={valid ? BLIND_ACTION_TOOLTIPS[a] : `${currentBlind.side === 'SB' ? blindSideLabel(scenarioData, 'SB') : 'BB'} 不会有 ${a} 的数据`}
                    className={`shrink-0 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                      !valid
                        ? 'bg-gray-900 text-gray-600 cursor-not-allowed opacity-40'
                        : a === currentBlind.action
                          ? 'bg-purple-600 text-white'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    }`}>{BLIND_ACTION_LABELS[a]}</button>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <>
          <div>
            <label className="block text-xs uppercase tracking-wide text-gray-400 mb-1">Position</label>
            <div className="flex gap-1 overflow-x-auto pb-1">
              {positions.map((p) => (
                <button key={p} onClick={() => onPositionChange(p)}
                  className={`shrink-0 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                    p === selectedPosition ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}>{p}</button>
              ))}
            </div>
          </div>
          {vsPositions && vsPositions.length > 0 && (
            <div>
              <label className="block text-xs uppercase tracking-wide text-gray-400 mb-1">VS Position</label>
              <div className="flex gap-1 overflow-x-auto pb-1">
                {sortPositions(vsPositions).map((v) => {
                  const valid = validVsForPosition.has(v);
                  return (
                    <button key={v} onClick={() => valid && onVsChange(v)} disabled={!valid}
                      title={valid ? '' : `${selectedPosition} 不会面对 ${v}`}
                      className={`shrink-0 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                        !valid
                          ? 'bg-gray-900 text-gray-600 cursor-not-allowed opacity-40'
                          : v === selectedVs
                            ? 'bg-purple-600 text-white'
                            : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}>{v}</button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
      <div>
        <label className="block text-xs uppercase tracking-wide text-gray-400 mb-1">Stack Depth: {selectedBb} BB</label>
        <div className="flex gap-1 overflow-x-auto pb-1">
          {bbs.map((b) => {
            const valid = validBbsForCombo.has(b);
            return (
              <button key={b} onClick={() => valid && onBbChange(b)} disabled={!valid}
                title={valid ? '' : `此位置/对手组合无 ${b}BB 数据`}
                className={`shrink-0 px-2 py-1 rounded text-xs font-medium transition-colors ${
                  !valid
                    ? 'bg-gray-900 text-gray-600 cursor-not-allowed opacity-40'
                    : b === selectedBb
                      ? 'bg-emerald-600 text-white'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}>{b}</button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EdgeSummary({ chart }: { chart: Chart | undefined }) {
  if (!chart) return null;
  const edges = chart.edges;
  if (!edges || Object.keys(edges).length === 0) {
    return <div className="bg-gray-900 rounded-lg p-4 text-gray-500 text-sm">No edge data available.</div>;
  }
  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Edge Hands Summary</h3>
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-x-4 gap-y-2 text-sm">
        {Object.entries(edges).map(([series, info]) => (
          <span key={series} className="inline-flex items-center gap-1.5">
            <span className="text-gray-400">{series}</span>
            <span className="text-gray-600">&rarr;</span>
            <span className="font-mono font-semibold text-white">{info.floor}</span>
            <span className="text-xs px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: hexToRgba(ACTION_COLORS[info.action] ?? '#888', 0.25),
                color: ACTION_COLORS[info.action] ?? '#888',
              }}>{actionLabel(info.action)} {info.pct}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function HandPopup({ hand, handName: name, onClose }: { hand: HandData; handName: string; onClose: () => void }) {
  const actions = getHandActions(hand);
  const reach = hand.reach ?? 100;
  const isConditional = reach < 99.5;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-gray-900 rounded-xl p-5 min-w-[260px] shadow-2xl border border-gray-700" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-white font-mono">{name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
        {isConditional && (
          <div className="mb-3 p-2 rounded bg-amber-950/40 border border-amber-800/40 text-xs text-amber-200">
            此手牌到达此节点概率: <span className="font-mono font-bold">{reach.toFixed(1)}%</span>
            {reach < 0.5 && <span className="block text-amber-300/70 mt-1">（前街走了别的分支，本节点不涉及）</span>}
          </div>
        )}
        <div className="space-y-2">
          {actions.map((a) => {
            // Bar width is pct relative to reach so bars visually sum to 100%
            // of the reached portion; absolute pct shown to the right.
            const widthPct = reach > 0.5 ? (a.pct / reach) * 100 : 0;
            return (
              <div key={a.action} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: ACTION_COLORS[a.action] }} />
                <span className="text-gray-300 text-sm flex-1">{actionLabel(a.action)}</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${widthPct}%`, backgroundColor: ACTION_COLORS[a.action] }} />
                  </div>
                  <span className="text-white text-sm font-mono w-12 text-right">{a.pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
        {hand.ev !== undefined && (
          <div className="mt-4 pt-3 border-t border-gray-700 text-sm text-gray-400">
            EV: <span className="text-white font-mono">{hand.ev.toFixed(2)} bb</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Expanded chart modal — shows full-size matrix + edge summary in overlay
function ExpandedChartModal({ chart, label, onClose }: { chart: Chart; label: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/80 backdrop-blur-sm overflow-y-auto py-6 px-4" onClick={onClose}>
      <div className="bg-gray-900 rounded-2xl w-full max-w-lg shadow-2xl border border-gray-700" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h3 className="text-lg font-bold text-white">{label}</h3>
            <span className="text-sm text-gray-400">Range {getRangePercent(chart)}%</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none p-1">&times;</button>
        </div>
        {/* Full matrix */}
        <div className="p-4">
          <RangeMatrix chart={chart} />
        </div>
        {/* Edge summary */}
        <div className="px-4 pb-4">
          <EdgeSummary chart={chart} />
        </div>
      </div>
    </div>
  );
}

// Full-size range matrix for single chart view
function RangeMatrix({ chart }: { chart: Chart | undefined }) {
  const [selectedHand, setSelectedHand] = useState<{ name: string; data: HandData } | null>(null);
  if (!chart) {
    return <div className="bg-gray-900 rounded-lg p-8 text-center text-gray-500">No chart found for the selected filters.</div>;
  }
  return (
    <>
      <div className="overflow-x-auto">
        <table className="border-collapse mx-auto">
          <thead>
            <tr>
              <th className="w-6 h-6" />
              {RANKS.map((r) => (
                <th key={r} className="w-8 h-6 sm:w-9 text-[10px] sm:text-xs text-gray-400 font-medium text-center">{r}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RANKS.map((rowRank, ri) => (
              <tr key={rowRank}>
                <td className="w-6 h-8 sm:h-9 text-[10px] sm:text-xs text-gray-400 font-medium text-center pr-0.5">{rowRank}</td>
                {RANKS.map((_colRank, ci) => {
                  const name = handName(ri, ci);
                  const hand = chart.hands[name];
                  const bg = cellBackground(hand);
                  const primary = hand ? getPrimaryAction(hand) : null;
                  const isFold = !hand || !primary || (primary.action === 'fold' && primary.pct === 100);
                  return (
                    <td key={ci} onClick={() => { if (hand) setSelectedHand({ name, data: hand }); }}
                      className={`w-8 h-8 sm:w-9 sm:h-9 text-center cursor-pointer border border-gray-800/50 transition-transform hover:scale-110 hover:z-10 relative ${isFold ? 'opacity-40' : ''}`}
                      style={{ background: bg }} title={name}>
                      <span className={`text-[8px] sm:text-[10px] font-mono leading-none select-none ${isFold ? 'text-gray-500' : 'text-white'}`}
                        style={{ textShadow: isFold ? 'none' : '0 1px 2px rgba(0,0,0,0.8)' }}>{name}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-3 justify-center mt-3 text-xs text-gray-400">
        {Object.entries(ACTION_COLORS).map(([action, color]) => (
          <span key={action} className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: color }} />
            {actionLabel(action)}
          </span>
        ))}
      </div>
      {selectedHand && <HandPopup hand={selectedHand.data} handName={selectedHand.name} onClose={() => setSelectedHand(null)} />}
    </>
  );
}

// Compact mini range matrix for comparison views
function MiniRangeMatrix({ chart, onCellClick }: { chart: Chart; onCellClick?: (name: string, data: HandData) => void }) {
  // Use CSS grid with aspect-square wrapper to guarantee a square matrix
  return (
    <div className="w-full max-w-[460px] mx-auto aspect-square">
      <div
        className="grid h-full w-full gap-px"
        style={{ gridTemplateColumns: `18px repeat(13, 1fr)`, gridTemplateRows: `14px repeat(13, 1fr)` }}
      >
        {/* Top-left corner */}
        <div />
        {/* Column headers */}
        {RANKS.map((r) => (
          <div key={`ch-${r}`} className="text-[8px] sm:text-[9px] text-white/80 font-semibold flex items-end justify-center pb-0.5">
            {r}
          </div>
        ))}
        {/* Rows (flattened: row label + 13 cells each) */}
        {RANKS.flatMap((rowRank, ri) => [
          <div key={`rh-${ri}`} className="text-[8px] sm:text-[9px] text-white/80 font-semibold flex items-center justify-end pr-1">
            {rowRank}
          </div>,
          ...RANKS.map((_, ci) => {
            const name = handName(ri, ci);
            const hand = chart.hands[name];
            const bg = cellBackground(hand);
            const primary = hand ? getPrimaryAction(hand) : null;
            const isFold = !hand || !primary || (primary.action === 'fold' && primary.pct === 100);
            const isPair = ri === ci;
            return (
              <div
                key={`c-${ri}-${ci}`}
                onClick={() => { if (hand && onCellClick) onCellClick(name, hand); }}
                className={`flex items-center justify-center border border-black/20 leading-none text-[8px] sm:text-[9px] font-semibold ${onCellClick ? 'cursor-pointer hover:opacity-80' : ''} ${isFold ? 'text-white/40' : 'text-black/85'} ${isPair ? 'font-bold' : ''}`}
                style={{ background: bg }}
                title={name}
              >
                {name}
              </div>
            );
          }),
        ])}
      </div>
    </div>
  );
}

function StackDepthComparison({
  scenarioData, position, vs, currentBb,
}: {
  scenarioData: ScenarioData; position: string; vs: string | undefined; currentBb: number;
}) {
  const allBbs = scenarioData.bbs;
  const bbSubset = useMemo(() => {
    if (allBbs.length <= 8) return allBbs;
    const step = (allBbs.length - 1) / 7;
    const indices = Array.from({ length: 8 }, (_, i) => Math.round(i * step));
    const set = [...new Set(indices)].map((i) => allBbs[i]);
    if (!set.includes(currentBb)) { set.push(currentBb); set.sort((a, b) => a - b); }
    return set;
  }, [allBbs, currentBb]);

  const seriesRows = useMemo(() => {
    const allSeriesNames = new Set<string>();
    for (const bb of bbSubset) {
      const chart = findChart(scenarioData, position, bb, vs);
      if (!chart?.edges) continue;
      for (const series of Object.keys(chart.edges)) allSeriesNames.add(series);
    }
    const rows: { series: string; floors: Record<number, string> }[] = [];
    for (const series of allSeriesNames) {
      const floors: Record<number, string> = {};
      for (const bb of bbSubset) {
        const chart = findChart(scenarioData, position, bb, vs);
        floors[bb] = chart?.edges?.[series]?.floor ?? '-';
      }
      if (Object.values(floors).some((v) => v !== '-')) rows.push({ series, floors });
    }
    return rows;
  }, [scenarioData, position, vs, bbSubset]);

  if (seriesRows.length === 0) return null;

  return (
    <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Stack Depth Comparison</h3>
      <table className="text-xs w-full min-w-[400px] border-collapse">
        <thead>
          <tr>
            <th className="text-left text-gray-400 pr-3 py-1 font-medium sticky left-0 bg-gray-900">Series</th>
            {bbSubset.map((bb) => (
              <th key={bb} className={`text-center px-2 py-1 font-medium ${bb === currentBb ? 'text-emerald-400' : 'text-gray-400'}`}>{bb}bb</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {seriesRows.map(({ series, floors }) => {
            let prevFloor: string | null = null;
            return (
              <tr key={series} className="border-t border-gray-800">
                <td className="text-gray-300 pr-3 py-1.5 font-medium whitespace-nowrap sticky left-0 bg-gray-900">{series}</td>
                {bbSubset.map((bb) => {
                  const floor = floors[bb];
                  const changed = prevFloor !== null && floor !== prevFloor;
                  prevFloor = floor;
                  return (
                    <td key={bb} className={`text-center px-2 py-1.5 font-mono ${bb === currentBb ? 'text-white font-bold' : changed ? 'text-amber-400' : 'text-gray-400'}`}>{floor}</td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Learn Mode: Compare by BB (fix BB → show all positions)
// ---------------------------------------------------------------------------

function LearnByBB({
  scenarioData, bbs,
}: {
  scenarioData: ScenarioData; bbs: number[];
}) {
  const blind = isBlindScenario(scenarioData.scenario);
  const multi = isMultiVsScenario(scenarioData.scenario);
  const multiActionLabel = multi ? MULTI_VS_SCENARIOS[scenarioData.scenario] : '';
  const [selectedBb, setSelectedBb] = useState(() => bbs.find(b => b === 20) ?? bbs[Math.floor(bbs.length / 2)]);
  const [selectedVs, setSelectedVs] = useState<string | undefined>(
    scenarioData.vs_positions && scenarioData.vs_positions.length > 0 ? scenarioData.vs_positions[0] : undefined
  );
  const [selectedSide, setSelectedSide] = useState<BlindSide>('SB');
  const positionsSorted = useMemo(() => sortPositions(scenarioData.positions), [scenarioData.positions]);
  const [multiHero, setMultiHero] = useState<string>(positionsSorted[0]);
  const [multiOpener, setMultiOpener] = useState<string>('');
  const [selectedHand, setSelectedHand] = useState<{ name: string; data: HandData } | null>(null);
  const [expandedChart, setExpandedChart] = useState<{ chart: Chart; label: string } | null>(null);

  const positions = positionsSorted;
  const charts = useMemo(() => {
    return positions.map(pos => ({
      position: pos,
      chart: findChart(scenarioData, pos, selectedBb, selectedVs),
    }));
  }, [scenarioData, positions, selectedBb, selectedVs]);

  // For blind scenarios: build list of (action, chart) pairs for the selected side + bb
  const blindActionCharts = useMemo(() => {
    if (!blind) return [];
    const acts = selectedSide === 'SB' ? SB_ACTIONS : BB_ACTIONS;
    return acts.map((a) => {
      const raw = blindToRaw(scenarioData, selectedSide, a);
      if (!raw) return { action: a, chart: undefined };
      return { action: a, chart: findChart(scenarioData, raw.position, selectedBb, raw.vs) };
    });
  }, [blind, scenarioData, selectedSide, selectedBb]);

  // Multi-vs: available openers for the selected hero
  const multiOpeners = useMemo(() => {
    if (!multi) return [] as string[];
    const set = new Set<string>();
    for (const c of scenarioData.charts) {
      if (c.position !== multiHero || !c.vs) continue;
      const p = parseMultiVs(c.vs);
      if (p) set.add(p.opener);
    }
    return sortPositions(Array.from(set));
  }, [multi, scenarioData, multiHero]);

  // Keep multiOpener valid as hero changes
  useEffect(() => {
    if (!multi) return;
    if (!multiOpener || !multiOpeners.includes(multiOpener)) {
      if (multiOpeners[0]) setMultiOpener(multiOpeners[0]);
    }
  }, [multi, multiOpeners, multiOpener]);

  // Heroes that have data at all (for disabling position buttons)
  const multiHeroHasData = useMemo(() => {
    if (!multi) return new Set<string>();
    const set = new Set<string>();
    for (const c of scenarioData.charts) if (c.vs && parseMultiVs(c.vs)) set.add(c.position);
    return set;
  }, [multi, scenarioData]);

  // Grid: one card per actor2 for (multiHero, multiOpener) at selectedBb
  const multiActor2Charts = useMemo(() => {
    if (!multi) return [] as { actor2: string; chart: Chart | undefined }[];
    const set = new Set<string>();
    for (const c of scenarioData.charts) {
      if (c.position !== multiHero || !c.vs) continue;
      const p = parseMultiVs(c.vs);
      if (p && p.opener === multiOpener) set.add(p.actor2);
    }
    return sortPositions(Array.from(set)).map(a => ({
      actor2: a,
      chart: findChart(scenarioData, multiHero, selectedBb, makeMultiVs(multiOpener, a)),
    }));
  }, [multi, scenarioData, multiHero, multiOpener, selectedBb]);

  return (
    <div className="space-y-5">
      {/* BB selector */}
      <div>
        <label className="block text-xs uppercase tracking-[0.15em] text-white/40 font-semibold mb-2">
          Fixed Stack Depth
        </label>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {bbs.map((b) => (
            <button key={b} onClick={() => setSelectedBb(b)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                b === selectedBb
                  ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40'
                  : 'bg-white/4 text-white/50 hover:bg-white/8 hover:text-white/70'
              }`}>
              {b}<span className="text-[10px] ml-0.5 opacity-60">BB</span>
            </button>
          ))}
        </div>
      </div>

      {/* Multi-vs selectors: Position (hero) + Open (opener) */}
      {multi && (
        <>
          <div>
            <label className="block text-xs uppercase tracking-[0.15em] text-white/40 font-semibold mb-2">Position</label>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {positions.map((p) => {
                const valid = multiHeroHasData.has(p);
                return (
                  <button key={p} disabled={!valid} onClick={() => valid && setMultiHero(p)}
                    className={`shrink-0 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                      !valid
                        ? 'bg-gray-900 text-white/20 cursor-not-allowed opacity-40'
                        : p === multiHero
                          ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40'
                          : 'bg-white/4 text-white/50 hover:bg-white/8 hover:text-white/70'
                    }`}>{p}</button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-[0.15em] text-white/40 font-semibold mb-2">Open</label>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {multiOpeners.map((o) => (
                <button key={o} onClick={() => setMultiOpener(o)}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    o === multiOpener
                      ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40'
                      : 'bg-white/4 text-white/50 hover:bg-white/8'
                  }`}>{o}</button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Side selector for blind scenarios */}
      {blind && (
        <div>
          <label className="block text-xs uppercase tracking-[0.15em] text-white/40 font-semibold mb-2">Position</label>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {(['SB', 'BB'] as BlindSide[]).map((s) => (
              <button key={s} onClick={() => setSelectedSide(s)}
                className={`shrink-0 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                  s === selectedSide
                    ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40'
                    : 'bg-white/4 text-white/50 hover:bg-white/8 hover:text-white/70'
                }`}>{blindSideLabel(scenarioData, s)}</button>
            ))}
          </div>
        </div>
      )}

      {/* VS Position selector if applicable (non-blind, non-multi only) */}
      {!blind && !multi && scenarioData.vs_positions && scenarioData.vs_positions.length > 0 && (
        <div>
          <label className="block text-xs uppercase tracking-[0.15em] text-white/40 font-semibold mb-2">VS Position</label>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {sortPositions(scenarioData.vs_positions).map((v) => (
              <button key={v} onClick={() => setSelectedVs(v)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                  v === selectedVs ? 'bg-purple-500/20 text-purple-400 ring-1 ring-purple-500/40' : 'bg-white/4 text-white/50 hover:bg-white/8'
                }`}>{v}</button>
            ))}
          </div>
        </div>
      )}

      {/* Grid: multi → one card per actor2; blind → one card per action; else → one card per position */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {multi
          ? multiActor2Charts.filter(({ chart }) => chart != null).map(({ actor2, chart }) => (
              <div key={actor2} className="rounded-xl overflow-hidden"
                style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
                  <span className="text-base font-bold text-purple-400">{multiActionLabel}: {actor2}</span>
                  <div className="flex items-center gap-2">
                    {chart && (
                      <span className="text-sm font-mono text-white/40">Range {getRangePercent(chart)}%</span>
                    )}
                    {chart && (
                      <button
                        onClick={() => setExpandedChart({ chart, label: `${multiHero} vs ${actor2}_over_${multiOpener} @ ${selectedBb}bb` })}
                        className="text-white/30 hover:text-white/70 transition-colors p-0.5" title="Expand chart">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                      </button>
                    )}
                  </div>
                </div>
                <div className="p-3">
                  {chart ? (
                    <MiniRangeMatrix chart={chart} onCellClick={(name, data) => setSelectedHand({ name, data })} />
                  ) : (
                    <div className="aspect-square flex items-center justify-center text-white/20 text-xs">N/A</div>
                  )}
                </div>
              </div>
            ))
          : blind
          ? blindActionCharts.filter(({ chart }) => chart != null).map(({ action, chart }) => (
              <div key={action} className="rounded-xl overflow-hidden"
                style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
                  <span className="text-base font-bold text-emerald-400" title={BLIND_ACTION_TOOLTIPS[action]}>{BLIND_ACTION_LABELS[action]}</span>
                  <div className="flex items-center gap-2">
                    {chart && (
                      <span className="text-sm font-mono text-white/40">Range {getRangePercent(chart)}%</span>
                    )}
                    {chart && (
                      <button
                        onClick={() => setExpandedChart({ chart, label: `${blindSideLabel(scenarioData, selectedSide)} ${action} @ ${selectedBb}bb` })}
                        className="text-white/30 hover:text-white/70 transition-colors p-0.5" title="Expand chart">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                      </button>
                    )}
                  </div>
                </div>
                <div className="p-3">
                  {chart ? (
                    <MiniRangeMatrix chart={chart} onCellClick={(name, data) => setSelectedHand({ name, data })} />
                  ) : (
                    <div className="aspect-square flex items-center justify-center text-white/20 text-xs">N/A</div>
                  )}
                </div>
              </div>
            ))
          : charts.filter(({ chart }) => chart != null).map(({ position, chart }) => (
              <div key={position} className="rounded-xl overflow-hidden"
                style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
                  <span className="text-base font-bold text-emerald-400">{position}</span>
                  <div className="flex items-center gap-2">
                    {chart && (
                      <span className="text-sm font-mono text-white/40">Range {getRangePercent(chart)}%</span>
                    )}
                    {chart && (
                      <button
                        onClick={() => setExpandedChart({ chart, label: `${position}${selectedVs ? ` vs ${selectedVs}` : ''} @ ${selectedBb}bb` })}
                        className="text-white/30 hover:text-white/70 transition-colors p-0.5" title="Expand chart">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                      </button>
                    )}
                  </div>
                </div>
                <div className="p-3">
                  {chart ? (
                    <MiniRangeMatrix chart={chart} onCellClick={(name, data) => setSelectedHand({ name, data })} />
                  ) : (
                    <div className="aspect-square flex items-center justify-center text-white/20 text-xs">N/A</div>
                  )}
                </div>
              </div>
            ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 justify-center text-xs text-gray-400">
        {Object.entries(ACTION_COLORS).map(([action, color]) => (
          <span key={action} className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: color }} />
            {actionLabel(action)}
          </span>
        ))}
      </div>

      {selectedHand && <HandPopup hand={selectedHand.data} handName={selectedHand.name} onClose={() => setSelectedHand(null)} />}
      {expandedChart && <ExpandedChartModal chart={expandedChart.chart} label={expandedChart.label} onClose={() => setExpandedChart(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Learn Mode: Compare by Position (fix position → show BB progression)
// ---------------------------------------------------------------------------

function LearnByPosition({
  scenarioData,
}: {
  scenarioData: ScenarioData;
}) {
  const blind = isBlindScenario(scenarioData.scenario);
  const multi = isMultiVsScenario(scenarioData.scenario);
  const multiActionLabel = multi ? MULTI_VS_SCENARIOS[scenarioData.scenario] : '';
  const positions = useMemo(() => sortPositions(scenarioData.positions), [scenarioData.positions]);
  const [selectedPosition, setSelectedPosition] = useState(positions[0]);
  const [selectedSide, setSelectedSide] = useState<BlindSide>('SB');
  const [selectedBlindAction, setSelectedBlindAction] = useState<BlindAction>('Open');
  const [multiOpener, setMultiOpener] = useState<string>('');
  const [multiActor2, setMultiActor2] = useState<string>('');
  const [selectedHand, setSelectedHand] = useState<{ name: string; data: HandData } | null>(null);
  const [expandedChart, setExpandedChart] = useState<{ chart: Chart; label: string } | null>(null);

  // For blind scenarios: which actions have ANY data for the selected side (ignoring BB filter)
  const availableBlindActions = useMemo(() => {
    if (!blind) return new Set<BlindAction>();
    const acts = selectedSide === 'SB' ? SB_ACTIONS : BB_ACTIONS;
    const out = new Set<BlindAction>();
    for (const a of acts) {
      const raw = blindToRaw(scenarioData, selectedSide, a);
      if (raw) out.add(a);
    }
    return out;
  }, [blind, scenarioData, selectedSide]);

  // Auto-fix blind action when side changes
  useEffect(() => {
    if (!blind) return;
    if (!availableBlindActions.has(selectedBlindAction)) {
      const first = (selectedSide === 'SB' ? SB_ACTIONS : BB_ACTIONS).find(a => availableBlindActions.has(a));
      if (first) setSelectedBlindAction(first);
    }
  }, [blind, availableBlindActions, selectedBlindAction, selectedSide]);

  // Resolve effective (position, vs) for blind mode
  const blindRaw = useMemo(() => {
    if (!blind) return null;
    return blindToRaw(scenarioData, selectedSide, selectedBlindAction);
  }, [blind, scenarioData, selectedSide, selectedBlindAction]);

  // Multi-vs: openers available for the selected hero
  const multiOpeners = useMemo(() => {
    if (!multi) return [] as string[];
    const set = new Set<string>();
    for (const c of scenarioData.charts) {
      if (c.position !== selectedPosition || !c.vs) continue;
      const p = parseMultiVs(c.vs);
      if (p) set.add(p.opener);
    }
    return sortPositions(Array.from(set));
  }, [multi, scenarioData, selectedPosition]);

  // Keep multiOpener valid as hero changes
  useEffect(() => {
    if (!multi) return;
    if (!multiOpener || !multiOpeners.includes(multiOpener)) {
      if (multiOpeners[0]) setMultiOpener(multiOpeners[0]);
    }
  }, [multi, multiOpeners, multiOpener]);

  // Actor2s available for (hero, opener)
  const multiActor2s = useMemo(() => {
    if (!multi) return [] as string[];
    const set = new Set<string>();
    for (const c of scenarioData.charts) {
      if (c.position !== selectedPosition || !c.vs) continue;
      const p = parseMultiVs(c.vs);
      if (p && p.opener === multiOpener) set.add(p.actor2);
    }
    return sortPositions(Array.from(set));
  }, [multi, scenarioData, selectedPosition, multiOpener]);

  useEffect(() => {
    if (!multi) return;
    if (!multiActor2 || !multiActor2s.includes(multiActor2)) {
      if (multiActor2s[0]) setMultiActor2(multiActor2s[0]);
    }
  }, [multi, multiActor2s, multiActor2]);

  const multiHeroHasData = useMemo(() => {
    if (!multi) return new Set<string>();
    const set = new Set<string>();
    for (const c of scenarioData.charts) if (c.vs && parseMultiVs(c.vs)) set.add(c.position);
    return set;
  }, [multi, scenarioData]);

  const effectivePosition = blind ? (blindRaw?.position ?? selectedPosition) : selectedPosition;

  // Compute available VS positions for the selected position (non-blind)
  const availableVs = useMemo(() => {
    if (blind || multi) return [] as string[];
    if (!scenarioData.vs_positions || scenarioData.vs_positions.length === 0) return [];
    const vsSet = new Set<string>();
    for (const chart of scenarioData.charts) {
      if (chart.position === selectedPosition && chart.vs) vsSet.add(chart.vs);
    }
    return sortPositions(scenarioData.vs_positions.filter(v => vsSet.has(v)));
  }, [blind, multi, scenarioData, selectedPosition]);

  const [selectedVsNonBlind, setSelectedVsNonBlind] = useState<string | undefined>(availableVs[0]);

  // Auto-update selectedVsNonBlind when position changes (non-blind only)
  useEffect(() => {
    if (blind) return;
    if (availableVs.length > 0 && (!selectedVsNonBlind || !availableVs.includes(selectedVsNonBlind))) {
      setSelectedVsNonBlind(availableVs[0]);
    } else if (availableVs.length === 0) {
      setSelectedVsNonBlind(undefined);
    }
  }, [blind, availableVs, selectedVsNonBlind]);

  const selectedVs = blind
    ? blindRaw?.vs
    : multi
      ? (multiOpener && multiActor2 ? makeMultiVs(multiOpener, multiActor2) : undefined)
      : selectedVsNonBlind;

  const allBbs = scenarioData.bbs;

  // Show ALL BBs that have data for this position+vs combo (no subsampling)
  const displayBbs = useMemo(() => {
    return allBbs.filter(bb => findChart(scenarioData, effectivePosition, bb, selectedVs) != null);
  }, [allBbs, scenarioData, effectivePosition, selectedVs]);

  const charts = useMemo(() => {
    return displayBbs.map(bb => ({
      bb,
      chart: findChart(scenarioData, effectivePosition, bb, selectedVs),
    }));
  }, [scenarioData, effectivePosition, displayBbs, selectedVs]);

  return (
    <div className="space-y-5">
      {/* Position selector — blind: SB/BB side picker; multi: hero with disabled state; non-blind: full position list */}
      <div>
        <label className="block text-xs uppercase tracking-[0.15em] text-white/40 font-semibold mb-2">
          {blind ? 'Position' : multi ? 'Position' : 'Fixed Position'}
        </label>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {multi
            ? positions.map((p) => {
                const valid = multiHeroHasData.has(p);
                return (
                  <button key={p} disabled={!valid} onClick={() => valid && setSelectedPosition(p)}
                    className={`shrink-0 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                      !valid
                        ? 'bg-gray-900 text-white/20 cursor-not-allowed opacity-40'
                        : p === selectedPosition
                          ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40'
                          : 'bg-white/4 text-white/50 hover:bg-white/8 hover:text-white/70'
                    }`}>{p}</button>
                );
              })
            : blind
            ? (['SB', 'BB'] as BlindSide[]).map((s) => (
                <button key={s} onClick={() => setSelectedSide(s)}
                  className={`shrink-0 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                    s === selectedSide
                      ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40'
                      : 'bg-white/4 text-white/50 hover:bg-white/8 hover:text-white/70'
                  }`}>{blindSideLabel(scenarioData, s)}</button>
              ))
            : positions.map((p) => (
                <button key={p} onClick={() => setSelectedPosition(p)}
                  className={`shrink-0 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                    p === selectedPosition
                      ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40'
                      : 'bg-white/4 text-white/50 hover:bg-white/8 hover:text-white/70'
                  }`}>{p}</button>
              ))}
        </div>
      </div>

      {/* Multi-vs: Open + Action rows */}
      {multi && (
        <>
          <div>
            <label className="block text-xs uppercase tracking-[0.15em] text-white/40 font-semibold mb-2">Open</label>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {multiOpeners.map((o) => (
                <button key={o} onClick={() => setMultiOpener(o)}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    o === multiOpener
                      ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40'
                      : 'bg-white/4 text-white/50 hover:bg-white/8'
                  }`}>{o}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-[0.15em] text-white/40 font-semibold mb-2">{multiActionLabel}</label>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {multiActor2s.map((a) => (
                <button key={a} onClick={() => setMultiActor2(a)}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    a === multiActor2
                      ? 'bg-purple-500/20 text-purple-400 ring-1 ring-purple-500/40'
                      : 'bg-white/4 text-white/50 hover:bg-white/8'
                  }`}>{a}</button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* VS selector — blind: action picker; non-blind/non-multi: VS Position */}
      {!multi && blind ? (
        <div>
          <label className="block text-xs uppercase tracking-[0.15em] text-white/40 font-semibold mb-2">VS Action</label>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {(selectedSide === 'SB' ? SB_ACTIONS : BB_ACTIONS).map((a) => {
              const enabled = availableBlindActions.has(a);
              const active = a === selectedBlindAction;
              return (
                <button key={a} disabled={!enabled} onClick={() => enabled && setSelectedBlindAction(a)}
                  title={BLIND_ACTION_TOOLTIPS[a]}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    active
                      ? 'bg-purple-500/20 text-purple-400 ring-1 ring-purple-500/40'
                      : enabled
                        ? 'bg-white/4 text-white/50 hover:bg-white/8'
                        : 'bg-gray-900 text-white/20 cursor-not-allowed opacity-40'
                  }`}>{BLIND_ACTION_LABELS[a]}</button>
              );
            })}
          </div>
        </div>
      ) : (
        availableVs.length > 0 && (
          <div>
            <label className="block text-xs uppercase tracking-[0.15em] text-white/40 font-semibold mb-2">VS Position</label>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {availableVs.map((v) => (
                <button key={v} onClick={() => setSelectedVsNonBlind(v)}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    v === selectedVs ? 'bg-purple-500/20 text-purple-400 ring-1 ring-purple-500/40' : 'bg-white/4 text-white/50 hover:bg-white/8'
                  }`}>{v}</button>
              ))}
            </div>
          </div>
        )
      )}

      {/* BB progression grid */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="h-px flex-1 bg-white/5" />
          <span className="text-[10px] uppercase tracking-[0.2em] text-white/25 font-semibold">
            {blind
              ? `${blindSideLabel(scenarioData, selectedSide)} ${BLIND_ACTION_LABELS[selectedBlindAction]}`
              : multi
                ? `${selectedPosition} vs ${multiActionLabel}: ${multiActor2} (Open ${multiOpener})`
                : `${selectedPosition}${selectedVs ? ` vs ${selectedVs}` : ''}`} — Stack Depth Progression
          </span>
          <div className="h-px flex-1 bg-white/5" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {charts.filter(({ chart }) => chart != null).map(({ bb, chart }) => (
            <div key={bb} className="rounded-xl overflow-hidden"
              style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)', border: '1px solid rgba(255,255,255,0.06)' }}>
              {/* Header */}
              <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
                <span className="text-base font-bold text-amber-400">
                  {bb}<span className="text-xs ml-0.5 text-amber-400/50 font-semibold">BB</span>
                </span>
                <div className="flex items-center gap-2">
                  {chart && (
                    <span className="text-sm font-mono text-white/40">
                      Range {getRangePercent(chart)}%
                    </span>
                  )}
                  {chart && (
                    <button
                      onClick={() => setExpandedChart({ chart, label: blind
                        ? `${blindSideLabel(scenarioData, selectedSide)} ${BLIND_ACTION_LABELS[selectedBlindAction]} @ ${bb}bb`
                        : multi
                          ? `${selectedPosition} vs ${multiActionLabel}:${multiActor2} (Open ${multiOpener}) @ ${bb}bb`
                          : `${selectedPosition}${selectedVs ? ` vs ${selectedVs}` : ''} @ ${bb}bb` })}
                      className="text-white/30 hover:text-white/70 transition-colors p-0.5"
                      title="Expand chart"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                    </button>
                  )}
                </div>
              </div>
              {/* Mini matrix */}
              <div className="p-3">
                {chart ? (
                  <MiniRangeMatrix chart={chart} onCellClick={(name, data) => setSelectedHand({ name, data })} />
                ) : (
                  <div className="aspect-square flex items-center justify-center text-white/20 text-xs">N/A</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Edge hand progression table */}
      <StackDepthComparison
        scenarioData={scenarioData}
        position={effectivePosition}
        vs={selectedVs}
        currentBb={displayBbs[Math.floor(displayBbs.length / 2)]}
      />

      {/* Legend */}
      <div className="flex flex-wrap gap-3 justify-center text-xs text-gray-400">
        {Object.entries(ACTION_COLORS).map(([action, color]) => (
          <span key={action} className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: color }} />
            {actionLabel(action)}
          </span>
        ))}
      </div>

      {selectedHand && <HandPopup hand={selectedHand.data} handName={selectedHand.name} onClose={() => setSelectedHand(null)} />}
      {expandedChart && <ExpandedChartModal chart={expandedChart.chart} label={expandedChart.label} onClose={() => setExpandedChart(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

type ViewMode = 'chart' | 'byBB' | 'byPosition';

const VIEW_MODES: { key: ViewMode; label: string; desc: string }[] = [
  { key: 'chart', label: 'Single Chart', desc: 'View one chart at a time' },
  { key: 'byBB', label: 'By BB', desc: 'Fix BB, compare positions' },
  { key: 'byPosition', label: 'By Position', desc: 'Fix position, compare BBs' },
];

export default function StudyScenarioPage({
  params,
}: {
  params: Promise<{ scenario: string }>;
}) {
  const { scenario } = use(params);

  const [scenarioData, setScenarioData] = useState<ScenarioData | null>(null);
  const [indexData, setIndexData] = useState<IndexData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('chart');

  const [position, setPosition] = useState<string>('');
  const [vs, setVs] = useState<string | undefined>(undefined);
  const [bb, setBb] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [sd, idx] = await Promise.all([getScenarioData(scenario), getIndex()]);
        if (cancelled) return;
        setScenarioData(sd);
        setIndexData(idx);
        setPosition(sd.positions[0]);
        if (sd.vs_positions && sd.vs_positions.length > 0) setVs(sd.vs_positions[0]);
        setBb(sd.bbs.find((b) => b === 20) ?? sd.bbs[Math.floor(sd.bbs.length / 2)]);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [scenario]);

  const chart = useMemo(() => {
    if (!scenarioData || !position || !bb) return undefined;
    return findChart(scenarioData, position, bb, vs);
  }, [scenarioData, position, bb, vs]);

  const displayName = SCENARIO_LABELS[scenario] ?? scenario;

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-gray-400 animate-pulse">Loading {displayName}...</div>
      </div>
    );
  }

  if (error || !scenarioData || !indexData) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-4">
        <p className="text-red-400">Failed to load scenario data: {error ?? 'Unknown error'}</p>
        <Link href="/" className="text-blue-400 underline text-sm">Back to Home</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-black/90 backdrop-blur-sm border-b border-gray-800 px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-white transition-colors shrink-0" aria-label="Back">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-base sm:text-lg font-semibold truncate">{displayName}</h1>
          {viewMode === 'chart' && chart && (
            <span className="ml-auto text-xs text-gray-500 whitespace-nowrap">{Object.keys(chart.hands).length} hands</span>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5 space-y-5">
        {/* View mode tabs */}
        <div className="flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06]">
          {VIEW_MODES.map((m) => (
            <button key={m.key} onClick={() => setViewMode(m.key)}
              className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all ${
                viewMode === m.key
                  ? 'bg-white/10 text-white shadow-sm'
                  : 'text-white/40 hover:text-white/60 hover:bg-white/[0.03]'
              }`}>
              <span className="block">{m.label}</span>
              <span className="block text-[10px] font-normal mt-0.5 opacity-60">{m.desc}</span>
            </button>
          ))}
        </div>

        {/* View mode content */}
        {viewMode === 'chart' && (
          <>
            <FilterBar
              scenarioData={scenarioData}
              positions={sortPositions(scenarioData.positions)}
              vsPositions={scenarioData.vs_positions}
              bbs={scenarioData.bbs}
              selectedPosition={position}
              selectedVs={vs}
              selectedBb={bb}
              onPositionChange={(p) => {
                setPosition(p);
                // Auto-switch vs to a valid one for the new position
                if (scenarioData.vs_positions && scenarioData.vs_positions.length > 0) {
                  const validVs = new Set(
                    scenarioData.charts.filter(c => c.position === p && c.vs).map(c => c.vs!)
                  );
                  if (!vs || !validVs.has(vs)) {
                    const firstValid = scenarioData.vs_positions.find(v => validVs.has(v));
                    if (firstValid) setVs(firstValid);
                  }
                }
                // Auto-switch bb to a valid one for the new combo
                const targetVs = vs && scenarioData.charts.some(c => c.position === p && c.vs === vs) ? vs : undefined;
                const validBbs = new Set(
                  scenarioData.charts
                    .filter(c => c.position === p && (targetVs ? c.vs === targetVs : true))
                    .map(c => c.bb)
                );
                if (!validBbs.has(bb)) {
                  const closest = [...validBbs].sort((a, b2) => Math.abs(a - bb) - Math.abs(b2 - bb))[0];
                  if (closest != null) setBb(closest);
                }
              }}
              onVsChange={(v) => {
                setVs(v);
                const validBbs = new Set(
                  scenarioData.charts.filter(c => c.position === position && c.vs === v).map(c => c.bb)
                );
                if (!validBbs.has(bb)) {
                  const closest = [...validBbs].sort((a, b2) => Math.abs(a - bb) - Math.abs(b2 - bb))[0];
                  if (closest != null) setBb(closest);
                }
              }}
              onBbChange={setBb}
            />
            <EdgeSummary chart={chart} />
            <div className="bg-gray-900 rounded-lg p-3 sm:p-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">
                Range Matrix
                {chart && <span className="ml-2 text-xs font-normal text-gray-500">{position}{vs ? ` vs ${vs}` : ''} @ {bb}bb</span>}
              </h3>
              <RangeMatrix chart={chart} />
            </div>
            <StackDepthComparison scenarioData={scenarioData} position={position} vs={vs} currentBb={bb} />
          </>
        )}

        {viewMode === 'byBB' && (
          <LearnByBB scenarioData={scenarioData} bbs={scenarioData.bbs} />
        )}

        {viewMode === 'byPosition' && (
          <LearnByPosition scenarioData={scenarioData} />
        )}
      </main>
    </div>
  );
}
