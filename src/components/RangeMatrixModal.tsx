'use client';

/**
 * Range matrix popup with action breakdown + cross-chart shortcuts.
 *
 * Rendered in two places:
 *  - drill quiz feedback + review (src/app/drill/page.tsx)
 *  - progress scenario detail hand modal (src/app/progress/[scenario]/page.tsx)
 *
 * Uses reach_pct semantics (see obs 665, 667): action bar widths and cell
 * alphas are normalized to reach, and a dark band masks (100-reach)% of cells
 * for conditional nodes.
 */

import type { Chart, HandData } from '@/lib/types';
import { ACTION_COLORS, ACTION_LABELS, RANKS } from '@/lib/types';
import { getHandActions } from '@/lib/data';

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function matrixHandName(ri: number, ci: number): string {
  const r1 = RANKS[ri]; const r2 = RANKS[ci];
  if (ri < ci) return `${r1}${r2}s`;
  if (ri === ci) return `${r1}${r2}`;
  return `${r2}${r1}o`;
}

export function cellBg(hand: HandData | undefined): string {
  if (!hand) return 'rgba(0,0,0,0.15)';
  const reach = hand.reach ?? 100;
  if (reach < 0.5) return 'rgba(0,0,0,0.55)';
  const actions = getHandActions(hand);
  if (actions.length === 0) return 'rgba(0,0,0,0.15)';
  const threshold = Math.max(0.5, reach * 0.01);
  const nonFold = actions.filter((a) => a.action !== 'fold' && a.pct >= threshold);
  if (nonFold.length === 0) return 'rgba(0,0,0,0.15)';
  const totalNonFold = nonFold.reduce((s, a) => s + a.pct, 0);
  const alpha = Math.max(Math.min(totalNonFold / reach, 1), 0.2);
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
  if (reach >= 99.5) return actionGrad;
  const voidColor = 'rgba(0,0,0,0.72)';
  return `linear-gradient(to top, transparent 0%, transparent ${reach.toFixed(1)}%, ${voidColor} ${reach.toFixed(1)}%, ${voidColor} 100%), ${actionGrad}`;
}

export interface RangeMatrixModalProps {
  chart: Chart;
  title: string;
  highlightHand: string;
  scenario: string;
  position: string;
  vs: string | undefined;
  bb: number;
  onClose: () => void;
}

export function RangeMatrixModal({
  chart, title, highlightHand, scenario, position, vs, bb, onClose,
}: RangeMatrixModalProps) {
  const focusHand = chart.hands[highlightHand];
  const focusActions = focusHand ? getHandActions(focusHand) : [];
  const reach = focusHand?.reach ?? 100;
  const isConditional = reach < 99.5;

  // Deep links to study page (open in new tab so the host page stays intact)
  const studyBase = `/study/${encodeURIComponent(scenario)}`;
  const vsParam = vs ? `&vs=${encodeURIComponent(vs)}` : '';
  const byBBHref = `${studyBase}?view=byBB&bb=${bb}&position=${encodeURIComponent(position)}${vsParam}`;
  const byPosHref = `${studyBase}?view=byPosition&position=${encodeURIComponent(position)}&bb=${bb}${vsParam}`;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-sm p-3" onClick={onClose}>
      <div className="bg-slate-900 rounded-xl w-full max-w-lg shadow-2xl border border-white/10 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 sticky top-0 bg-slate-900 z-10">
          <div className="text-sm font-bold text-white">{title}</div>
          <button onClick={onClose} className="text-white/70 hover:text-white text-2xl leading-none px-2">&times;</button>
        </div>

        {/* Cross-chart shortcuts */}
        <div className="px-4 pt-3 flex gap-2">
          <a
            href={byBBHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center py-2 rounded-lg text-xs font-bold border border-sky-400/40 text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 transition-colors"
          >
            By BB · 同 BB 对比 ↗
          </a>
          <a
            href={byPosHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center py-2 rounded-lg text-xs font-bold border border-emerald-400/40 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors"
          >
            By Position · 同位对比 ↗
          </a>
        </div>

        {/* Focus hand detail */}
        <div className="px-4 pt-3 pb-2 border-b border-white/5">
          <div className="flex items-baseline gap-3 mb-2">
            <span className="text-2xl font-extrabold text-white font-mono">{highlightHand}</span>
            {isConditional && (
              <span className="text-[10px] font-mono text-amber-400/80">
                reach {reach.toFixed(0)}%
              </span>
            )}
          </div>
          {focusActions.length === 0 ? (
            <div className="text-sm text-white/50">此手牌在此节点不涉及</div>
          ) : (
            <div className="space-y-1.5">
              {focusActions.map((a) => {
                const normalized = reach > 0.5 ? (a.pct / reach) * 100 : 0;
                const color = ACTION_COLORS[a.action] ?? '#888';
                return (
                  <div key={a.action} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-xs text-white/70 w-12 shrink-0">{ACTION_LABELS[a.action] || a.action}</span>
                    <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${normalized}%`, background: color }} />
                    </div>
                    <span className="text-sm font-bold font-mono w-14 text-right" style={{ color }}>
                      {normalized.toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {focusHand?.ev !== undefined && (
            <div className="mt-2 text-[11px] text-white/40">
              EV: <span className="text-white/70 font-mono">{focusHand.ev.toFixed(2)} bb</span>
            </div>
          )}
        </div>

        {/* Full range matrix */}
        <div className="p-3">
          <div className="aspect-square w-full">
            <div className="grid h-full w-full gap-px"
              style={{ gridTemplateColumns: `16px repeat(13, 1fr)`, gridTemplateRows: `14px repeat(13, 1fr)` }}>
              <div />
              {RANKS.map((r) => (
                <div key={`ch-${r}`} className="text-[9px] text-white/70 font-semibold flex items-end justify-center pb-0.5">{r}</div>
              ))}
              {RANKS.flatMap((rowRank, ri) => [
                <div key={`rh-${ri}`} className="text-[9px] text-white/70 font-semibold flex items-center justify-end pr-1">{rowRank}</div>,
                ...RANKS.map((_, ci) => {
                  const name = matrixHandName(ri, ci);
                  const hand = chart.hands[name];
                  const bg = cellBg(hand);
                  const isHighlight = name === highlightHand;
                  return (
                    <div
                      key={`c-${ri}-${ci}`}
                      className={`flex items-center justify-center text-[8px] sm:text-[9px] font-semibold leading-none ${
                        isHighlight ? 'ring-2 ring-white z-10' : 'border border-black/20'
                      }`}
                      style={{ background: bg, color: 'rgba(0,0,0,0.85)' }}
                      title={name}
                    >
                      {name}
                    </div>
                  );
                }),
              ])}
            </div>
          </div>
          {/* Legend */}
          <div className="mt-3 flex items-center justify-center gap-3 text-[10px] text-white/60">
            {(['call', 'raise', 'allin', 'fold'] as const).map((a) => (
              <div key={a} className="flex items-center gap-1">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ background: ACTION_COLORS[a] }} />
                <span>{ACTION_LABELS[a]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
