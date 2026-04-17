'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  IndexData,
  ScenarioData,
  HandData,
  Chart,
  DrillQuestion,
  DrillAnswer,
  DrillFilters,
  SCENARIO_LABELS,
  RANKS,
  compareScenarios,
  ACTION_COLORS,
} from '@/lib/types';
import {
  getIndex,
  getScenarioData,
  getHandActions,
  getAvailableActions,
} from '@/lib/data';
import { recordDrillSession } from '@/lib/progress';
import { useAuth } from '@/lib/auth-context';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<string, string> = {
  raise: 'Raise',
  call: 'Call',
  fold: 'Fold',
  allin: 'All-In',
};

function formatHand(hand: string): { display: string; suited: boolean; pair: boolean } {
  // Hands come as e.g. "AKs", "AKo", "AA"
  if (hand.length === 2) {
    // Pocket pair
    return { display: `${hand[0]}${hand[1]}`, suited: false, pair: true };
  }
  const suited = hand.endsWith('s');
  return { display: `${hand[0]}${hand[1]}`, suited, pair: false };
}

function handDisplayString(hand: string): string {
  const { display, suited, pair } = formatHand(hand);
  if (pair) return `${display[0]}\u2660${display[1]}\u2665`; // spade + heart for pairs
  if (suited) return `${display[0]}\u2660${display[1]}\u2660`; // both spades
  return `${display[0]}\u2660${display[1]}\u2665`; // spade + heart
}

function handTypeLabel(hand: string): string {
  if (hand.length === 2) return 'Pair';
  return hand.endsWith('s') ? 'Suited' : 'Offsuit';
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// ---------------------------------------------------------------------------
// Two-thumb range slider component
// ---------------------------------------------------------------------------

function RangeSlider({
  min,
  max,
  value,
  onChange,
}: {
  min: number;
  max: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'lo' | 'hi' | null>(null);

  const pctLo = ((value[0] - min) / (max - min)) * 100;
  const pctHi = ((value[1] - min) / (max - min)) * 100;

  const valueFromX = useCallback(
    (clientX: number) => {
      const rect = trackRef.current!.getBoundingClientRect();
      const pct = clamp((clientX - rect.left) / rect.width, 0, 1);
      return Math.round(min + pct * (max - min));
    },
    [min, max],
  );

  const onPointerDown = useCallback(
    (thumb: 'lo' | 'hi') => (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = thumb;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const v = valueFromX(e.clientX);
      if (dragging.current === 'lo') {
        onChange([Math.min(v, value[1]), value[1]]);
      } else {
        onChange([value[0], Math.max(v, value[0])]);
      }
    },
    [value, onChange, valueFromX],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = null;
  }, []);

  return (
    <div
      ref={trackRef}
      className="relative h-8 select-none touch-none"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Track background */}
      <div className="absolute top-1/2 left-0 right-0 h-2 -translate-y-1/2 rounded-full bg-zinc-700" />
      {/* Active range */}
      <div
        className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-blue-500"
        style={{ left: `${pctLo}%`, width: `${pctHi - pctLo}%` }}
      />
      {/* Low thumb */}
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-white border-2 border-blue-500 cursor-grab active:cursor-grabbing shadow-md"
        style={{ left: `${pctLo}%` }}
        onPointerDown={onPointerDown('lo')}
      />
      {/* High thumb */}
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-white border-2 border-blue-500 cursor-grab active:cursor-grabbing shadow-md"
        style={{ left: `${pctHi}%` }}
        onPointerDown={onPointerDown('hi')}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Poker Table visualization (GTO Wizard-style)
// ---------------------------------------------------------------------------

// Canonical clockwise seat order at the oval. BTN=top, SB=right of BTN, etc.
const SEAT_ORDER = ['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'LJ', 'HJ', 'CO'] as const;
type Seat = typeof SEAT_ORDER[number];

// Aliases for scenarios that use non-standard position names.
const SEAT_ALIAS: Record<string, Seat | null> = {
  SBBTN: 'SB',       // HU "SB/BTN" combined seat
  SB_LR: 'SB', SB_LA: 'SB', SB_R3: 'SB', SB_RA: 'SB', SB_A: 'SB',
  SBBTN_LR: 'SB', SBBTN_LA: 'SB',
  BB_L: 'BB', BB_R: 'BB', BB_A: 'BB',
};
function toSeat(pos: string | undefined): Seat | null {
  if (!pos) return null;
  if ((SEAT_ORDER as readonly string[]).includes(pos)) return pos as Seat;
  if (pos in SEAT_ALIAS) return SEAT_ALIAS[pos];
  return null;
}

// Seat coords relative to hero. Hero is ALWAYS at bottom-center (180°).
// Other seats rotate around so clockwise order (action order) is preserved.
// Tall oval (narrow L-R, tall U-D) for mobile portrait.
function seatCoord(seat: Seat, heroSeat: Seat | null): { leftPct: number; topPct: number } {
  const heroIdx = heroSeat ? SEAT_ORDER.indexOf(heroSeat) : 0;
  const idx = SEAT_ORDER.indexOf(seat);
  // Delta seats clockwise from hero (hero at delta=0).
  const delta = (idx - heroIdx + 8) % 8;
  // Screen coords: y+ is DOWN. So bottom-center = 90°. Hero is always at bottom.
  // Sweep clockwise in screen space: delta=1 → 135° (bottom-left),
  // delta=4 → 270° (top), delta=7 → 45° (bottom-right).
  const angle = (90 + delta * 45) * (Math.PI / 180);
  const rx = 40; // horizontal radius (narrow)
  const ry = 30; // vertical radius — leaves ~20% below hero for cards
  const x = 50 + rx * Math.cos(angle);
  const y = 50 + ry * Math.sin(angle);
  return { leftPct: x, topPct: y };
}

// Action context derived from scenario + hero + villain
interface TableAction {
  villainSeat: Seat | null;     // Main aggressor facing hero (chip indicator shown here)
  villainLabel: string;         // e.g., "RAISE 2.5", "3-BET 8", "ALLIN"
  villainColor: string;         // Bet chip color
  thirdSeat?: Seat | null;      // For multi-vs scenarios (the opener)
  thirdLabel?: string;          // e.g., "RAISE 2.5"
  foldedSeats: Set<Seat>;       // Seats that folded earlier in the street
  bbInPot: number;              // Pot size in bb (approximate)
}

function deriveAction(scenario: string, heroSeat: Seat | null, vs: string | undefined, bb: number): TableAction {
  const heroIdx = heroSeat ? SEAT_ORDER.indexOf(heroSeat) : -1;
  const villainSeat = toSeat(vs);
  const folded = new Set<Seat>();

  // Helper: mark all seats between "action start" and "stop" as folded (clockwise)
  function markFoldedFromUtgTo(stopIdx: number) {
    // Preflop action starts at UTG (idx 3). Walk clockwise through idx 3,4,5,6,7,0,1 (skipping BB=2 and SB=1).
    // Actually preflop skips nothing — UTG→UTG1→LJ→HJ→CO→BTN→SB→BB. SB/BB have blind money.
    const utgIdx = 3;
    let i = utgIdx;
    while (i !== stopIdx) {
      const s = SEAT_ORDER[i];
      folded.add(s);
      i = (i + 1) % 8;
    }
  }

  // Pot defaults: 0.5 SB + 1 BB = 1.5bb
  let pot = 1.5;

  // Parse multi-vs: actor2_over_opener
  let multi: { actor2: string; opener: string } | null = null;
  if (vs && vs.includes('_over_')) {
    const [a, o] = vs.split('_over_');
    multi = { actor2: a, opener: o };
  }

  if (scenario === 'RFI' && heroIdx >= 0) {
    // Everyone before hero folded
    markFoldedFromUtgTo(heroIdx);
    return { villainSeat: null, villainLabel: '', villainColor: '', foldedSeats: folded, bbInPot: pot };
  }

  if (scenario === 'VS_OPEN_BB' || scenario === 'VS_OPEN_nonBB') {
    // Villain opened, everyone between villain and hero folded
    const vIdx = villainSeat ? SEAT_ORDER.indexOf(villainSeat) : -1;
    if (vIdx >= 0) {
      markFoldedFromUtgTo(vIdx);
      // Between villain+1 and hero, fold
      let i = (vIdx + 1) % 8;
      while (i !== heroIdx && i !== -1) {
        const s = SEAT_ORDER[i];
        if (s !== 'SB' && s !== 'BB') folded.add(s);
        i = (i + 1) % 8;
      }
    }
    pot = 1.5 + 2.5; // villain open 2.5bb
    return { villainSeat, villainLabel: `RAISE 2.5`, villainColor: '#eab308', foldedSeats: folded, bbInPot: pot };
  }

  if (scenario === 'VS_3BET') {
    // Hero raised 2.5bb; villain 3-bet
    const vIdx = villainSeat ? SEAT_ORDER.indexOf(villainSeat) : -1;
    if (vIdx >= 0 && heroIdx >= 0) {
      markFoldedFromUtgTo(heroIdx);
      // Between hero+1 and villain fold
      let i = (heroIdx + 1) % 8;
      while (i !== vIdx) {
        const s = SEAT_ORDER[i];
        if (s !== 'SB' && s !== 'BB') folded.add(s);
        i = (i + 1) % 8;
      }
    }
    pot = 1.5 + 2.5 + 8;
    return { villainSeat, villainLabel: `3-BET 8`, villainColor: '#ef4444', foldedSeats: folded, bbInPot: pot };
  }

  if (scenario === 'CALL_ALLIN') {
    return { villainSeat, villainLabel: `ALLIN ${bb}`, villainColor: '#dc2626', foldedSeats: folded, bbInPot: bb + 1.5 };
  }

  if (scenario === 'CALL_REJAM') {
    return { villainSeat, villainLabel: `RE-JAM ${bb}`, villainColor: '#dc2626', foldedSeats: folded, bbInPot: bb + 1.5 };
  }

  if (scenario === 'BVB' || scenario === 'HU_OFFLINE_ANTE' || scenario === 'HU_ONLINE') {
    // Heads-up: only SB and BB seats active; action from vs encoding
    const vsAction = vs || 'Open';
    let label = 'OPEN';
    let color = '#eab308';
    if (vsAction === 'LR' || vsAction === 'R') { label = 'RAISE'; color = '#eab308'; }
    else if (vsAction === 'LA' || vsAction === 'A') { label = 'ALLIN'; color = '#dc2626'; }
    else if (vsAction === 'R3') { label = '3-BET'; color = '#f97316'; }
    else if (vsAction === 'RA') { label = 'ALLIN'; color = '#dc2626'; }
    else if (vsAction === 'L') { label = 'LIMP'; color = '#22c55e'; }
    // Villain is the other blind
    const villainOther: Seat | null = heroSeat === 'SB' ? 'BB' : 'SB';
    // Everyone else folded
    for (const s of SEAT_ORDER) if (s !== 'SB' && s !== 'BB') folded.add(s);
    return { villainSeat: heroSeat === 'BB' ? villainOther : (vsAction === 'Open' ? null : villainOther),
      villainLabel: vsAction === 'Open' ? '' : label, villainColor: color, foldedSeats: folded, bbInPot: 1.5 };
  }

  if (multi) {
    // VS_OPEN_{CALL,3BET,ALLIN}: opener raised, actor2 called/3bet/allin, hero to act
    const openerSeat = toSeat(multi.opener);
    const actor2Seat = toSeat(multi.actor2);
    const openerIdx = openerSeat ? SEAT_ORDER.indexOf(openerSeat) : -1;
    const actor2Idx = actor2Seat ? SEAT_ORDER.indexOf(actor2Seat) : -1;
    let actionLabel = 'CALL';
    let actionColor = '#22c55e';
    let actionAmount = '2.5';
    if (scenario === 'VS_OPEN_3BET') { actionLabel = '3-BET'; actionColor = '#ef4444'; actionAmount = '8'; }
    if (scenario === 'VS_OPEN_ALLIN') { actionLabel = 'ALLIN'; actionColor = '#dc2626'; actionAmount = `${bb}`; }
    // Fold everyone before opener
    if (openerIdx >= 0) markFoldedFromUtgTo(openerIdx);
    // Between opener+1 and actor2 fold
    if (openerIdx >= 0 && actor2Idx >= 0) {
      let i = (openerIdx + 1) % 8;
      while (i !== actor2Idx) {
        const s = SEAT_ORDER[i];
        if (s !== 'SB' && s !== 'BB' && s !== heroSeat) folded.add(s);
        i = (i + 1) % 8;
      }
      // Between actor2+1 and hero fold
      if (heroIdx >= 0) {
        i = (actor2Idx + 1) % 8;
        while (i !== heroIdx) {
          const s = SEAT_ORDER[i];
          if (s !== 'SB' && s !== 'BB') folded.add(s);
          i = (i + 1) % 8;
        }
      }
    }
    pot = 1.5 + 2.5 + (scenario === 'VS_OPEN_CALL' ? 2.5 : scenario === 'VS_OPEN_3BET' ? 8 : bb);
    return {
      villainSeat: actor2Seat,
      villainLabel: `${actionLabel} ${actionAmount}`,
      villainColor: actionColor,
      thirdSeat: openerSeat,
      thirdLabel: `RAISE 2.5`,
      foldedSeats: folded,
      bbInPot: pot,
    };
  }

  return { villainSeat, villainLabel: vs || '', villainColor: '#eab308', foldedSeats: folded, bbInPot: pot };
}

// ---------------------------------------------------------------------------
// Range matrix modal (shown after wrong answer so user can study full chart)
// ---------------------------------------------------------------------------

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

function cellBg(hand: HandData | undefined): string {
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

function RangeMatrixModal({
  chart, title, highlightHand, onClose,
}: {
  chart: Chart; title: string; highlightHand: string; onClose: () => void;
}) {
  const focusHand = chart.hands[highlightHand];
  const focusActions = focusHand ? getHandActions(focusHand) : [];
  const reach = focusHand?.reach ?? 100;
  const isConditional = reach < 99.5;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-sm p-3" onClick={onClose}>
      <div className="bg-slate-900 rounded-xl w-full max-w-lg shadow-2xl border border-white/10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="text-sm font-bold text-white">{title}</div>
          <button onClick={onClose} className="text-white/70 hover:text-white text-2xl leading-none px-2">&times;</button>
        </div>

        {/* Focus hand detail — shows exact frequencies for the hand the user just answered */}
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

function HandCards({ hand }: { hand: string }) {
  const r1 = hand[0];
  const r2 = hand[1];
  const isPair = hand.length === 2;
  const isSuited = hand.endsWith('s');
  // First card: spade (dark). Second: spade if suited, heart if offsuit/pair.
  const s1 = '\u2660';
  const s2 = isPair || !isSuited ? '\u2665' : '\u2660';
  const c1 = '#1e293b';
  const c2 = isPair || !isSuited ? '#dc2626' : '#1e293b';
  return (
    <div className="flex gap-1">
      <div className="w-11 h-14 sm:w-14 sm:h-[76px] rounded-md flex flex-col items-center justify-center font-black shadow-lg"
        style={{ background: 'linear-gradient(145deg, #f8fafc, #e2e8f0)' }}>
        <span className="text-2xl sm:text-3xl leading-none" style={{ color: c1 }}>{r1}</span>
        <span className="text-sm sm:text-base leading-none mt-0.5" style={{ color: c1 }}>{s1}</span>
      </div>
      <div className="w-11 h-14 sm:w-14 sm:h-[76px] rounded-md flex flex-col items-center justify-center font-black shadow-lg"
        style={{ background: 'linear-gradient(145deg, #f8fafc, #e2e8f0)' }}>
        <span className="text-2xl sm:text-3xl leading-none" style={{ color: c2 }}>{r2}</span>
        <span className="text-sm sm:text-base leading-none mt-0.5" style={{ color: c2 }}>{s2}</span>
      </div>
    </div>
  );
}

function PokerTable({
  scenario, heroPos, vs, bb, hand,
}: {
  scenario: string; heroPos: string; vs: string | undefined; bb: number; hand: string;
}) {
  const heroSeat = toSeat(heroPos);
  const action = deriveAction(scenario, heroSeat, vs, bb);
  // Determine which seats to render: the 8 standard seats, dim those clearly not in play for this scenario.
  // For HU scenarios only show SB and BB.
  const isHU = scenario === 'HU_OFFLINE_ANTE' || scenario === 'HU_ONLINE' || scenario === 'BVB';
  const visibleSeats: Seat[] = isHU ? ['SB', 'BB'] : [...SEAT_ORDER];
  const btnSeat: Seat = isHU ? 'SB' : 'BTN';

  return (
    <div className="relative w-full mx-auto" style={{ maxWidth: 440, aspectRatio: '0.65 / 1' }}>
      {/* Table felt (tall oval, mobile-first) */}
      <div className="absolute inset-x-[4%] inset-y-[2%] rounded-[50%]"
        style={{ background: 'radial-gradient(ellipse at 50% 40%, #1a3a2f 0%, #0f2420 70%, #081815 100%)',
          border: '2px solid rgba(255,255,255,0.08)',
          boxShadow: 'inset 0 4px 20px rgba(0,0,0,0.5), 0 8px 30px rgba(0,0,0,0.4)' }} />

      {/* Pot + stack-depth center */}
      <div className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
        <div className="text-xs text-white/50 font-semibold">{bb}bb stacks</div>
        <div className="text-2xl font-extrabold text-white/95 leading-tight mt-0.5">{action.bbInPot.toFixed(1)} bb</div>
        <div className="text-[11px] text-white/40 font-medium tracking-wide uppercase mt-0.5">Pot</div>
      </div>

      {/* Seats */}
      {visibleSeats.map((seat) => {
        const { leftPct, topPct } = seatCoord(seat, heroSeat);
        const isHero = seat === heroSeat;
        const isVillain = seat === action.villainSeat;
        const isThird = seat === action.thirdSeat;
        const isFolded = action.foldedSeats.has(seat) && !isHero;
        const isButton = seat === btnSeat;
        return (
          <div key={seat} className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${leftPct}%`, top: `${topPct}%` }}>
            {/* Seat circle */}
            <div className={`relative w-[72px] h-[72px] sm:w-20 sm:h-20 rounded-full flex flex-col items-center justify-center text-center transition-all ${
              isHero ? 'ring-[3px] ring-emerald-400 shadow-[0_0_28px_rgba(16,185,129,0.55)]'
              : isVillain ? 'ring-[3px] ring-amber-400'
              : isThird ? 'ring-[3px] ring-sky-400'
              : ''
            }`}
              style={{
                background: isFolded ? 'rgba(255,255,255,0.04)' : 'rgba(20,30,40,0.92)',
                border: '1px solid rgba(255,255,255,0.12)',
                opacity: isFolded ? 0.35 : 1,
              }}>
              <span className={`text-base sm:text-lg font-extrabold leading-none ${
                isHero ? 'text-emerald-300' : isVillain ? 'text-amber-300' : isThird ? 'text-sky-300' : 'text-white/90'
              }`}>{seat}</span>
              <span className="text-xs sm:text-sm text-white/70 font-bold leading-none mt-1">{bb} bb</span>
              {isFolded && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-[70%] h-[2px] bg-white/30 rotate-[30deg]" />
                </div>
              )}
            </div>

            {/* Dealer button */}
            {isButton && (
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-white text-black text-[10px] font-black flex items-center justify-center shadow">
                D
              </div>
            )}

            {/* Bet chips (villain/third) */}
            {isVillain && action.villainLabel && (
              <div className="absolute left-1/2 -translate-x-1/2 top-[100%] mt-1.5 whitespace-nowrap">
                <div className="px-2 py-1 rounded-md text-[11px] font-extrabold tracking-wide"
                  style={{ background: action.villainColor, color: '#fff', boxShadow: `0 2px 10px ${action.villainColor}70` }}>
                  {action.villainLabel}
                </div>
              </div>
            )}
            {isThird && action.thirdLabel && (
              <div className="absolute left-1/2 -translate-x-1/2 top-[100%] mt-1.5 whitespace-nowrap">
                <div className="px-2 py-1 rounded-md text-[11px] font-extrabold tracking-wide"
                  style={{ background: '#eab308', color: '#fff', boxShadow: '0 2px 10px rgba(234,179,8,0.5)' }}>
                  {action.thirdLabel}
                </div>
              </div>
            )}

            {/* Blinds for SB/BB */}
            {!isFolded && !isHero && !isVillain && !isThird && seat === 'SB' && !isHU && (
              <div className="absolute left-1/2 -translate-x-1/2 top-[100%] mt-1 text-[11px] font-semibold text-white/60">0.5 bb</div>
            )}
            {!isFolded && !isHero && !isVillain && !isThird && seat === 'BB' && !isHU && (
              <div className="absolute left-1/2 -translate-x-1/2 top-[100%] mt-1 text-[11px] font-semibold text-white/60">1 bb</div>
            )}

            {/* Hero's cards — placed below the seat label (hero always sits at bottom) */}
            {isHero && (
              <div className="absolute left-1/2 top-[100%] -translate-x-1/2 mt-3">
                <HandCards hand={hand} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Frequency slider (single thumb, 0-100)
// ---------------------------------------------------------------------------

function FrequencySlider({
  value,
  onChange,
  color,
}: {
  value: number;
  onChange: (v: number) => void;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3 w-full">
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-3 appearance-none rounded-full bg-zinc-700 cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-7 [&::-webkit-slider-thumb]:h-7 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md"
        style={
          {
            '--tw-slider-color': color,
            // Webkit track fill (Chrome/Safari)
            background: `linear-gradient(to right, ${color} ${value}%, #3f3f46 ${value}%)`,
          } as React.CSSProperties
        }
      />
      <span className="text-xl font-bold tabular-nums w-16 text-right">{value}%</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Frequency comparison bar for review
// ---------------------------------------------------------------------------

function FrequencyBar({
  userPct,
  correctPct,
  action,
}: {
  userPct: number;
  correctPct: number;
  action: string;
}) {
  const color = ACTION_COLORS[action] || '#888';
  return (
    <div className="w-full space-y-1">
      <div className="flex justify-between text-xs text-zinc-400">
        <span>You: {userPct}%</span>
        <span>GTO: {correctPct}%</span>
      </div>
      <div className="relative h-4 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full opacity-40"
          style={{ width: `${correctPct}%`, backgroundColor: color }}
        />
        <div
          className="absolute top-0 h-full w-1 bg-white shadow"
          style={{ left: `${clamp(userPct, 0, 99)}%` }}
          title={`Your answer: ${userPct}%`}
        />
        <div
          className="absolute top-0 h-full w-0.5 border-l-2 border-dashed border-yellow-300"
          style={{ left: `${clamp(correctPct, 0, 99)}%` }}
          title={`GTO: ${correctPct}%`}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Question generator
// ---------------------------------------------------------------------------

interface CandidateHand {
  scenario: string;
  position: string;
  vs?: string;
  bb: number;
  hand: string;
  handData: HandData;
  chartId: number;
}

async function generateQuestions(
  filters: DrillFilters,
  seriesDefinitions: Record<string, string[]>,
): Promise<DrillQuestion[]> {
  const pool: CandidateHand[] = [];

  for (const scenarioName of filters.scenarios) {
    const data = await getScenarioData(scenarioName);

    for (const chart of data.charts) {
      // Filter by position
      if (filters.positions.length > 0 && !filters.positions.includes(chart.position)) continue;
      // Filter by vs position
      if (filters.vsPositions && filters.vsPositions.length > 0 && chart.vs && !filters.vsPositions.includes(chart.vs)) continue;
      // Filter by BB range
      if (chart.bb < filters.bbRange[0] || chart.bb > filters.bbRange[1]) continue;

      // Edge mode: floor of each series + the hand one above + one below in series order.
      // E.g. if Q4s is the floor of the Qxs series, test Q3s (one stronger), Q4s (floor), Q5s (one weaker).
      let edgeHands: Set<string> | null = null;
      if (filters.mode === 'edge') {
        edgeHands = new Set<string>();
        for (const [seriesName, info] of Object.entries(chart.edges)) {
          const series = seriesDefinitions[seriesName];
          if (!series) continue;
          const idx = series.indexOf(info.floor);
          if (idx < 0) continue;
          // series is ordered best → worst
          if (idx - 1 >= 0) edgeHands.add(series[idx - 1]);
          edgeHands.add(series[idx]);
          if (idx + 1 < series.length) edgeHands.add(series[idx + 1]);
        }
      }

      for (const [handName, handData] of Object.entries(chart.hands)) {
        if (edgeHands && !edgeHands.has(handName)) continue;
        // Skip combos that almost never reach this node — they're dead
        // questions (e.g. 72o at VS_3BET LJ). Reach absent ⇒ 100 (always in).
        const reach = handData.reach ?? 100;
        if (reach < 5) continue;

        pool.push({
          scenario: scenarioName,
          position: chart.position,
          vs: chart.vs,
          bb: chart.bb,
          hand: handName,
          handData,
          chartId: chart.id,
        });
      }
    }
  }

  // Shuffle and pick unique hand+chart combos
  const shuffled = shuffle(pool);
  const seen = new Set<string>();
  const questions: DrillQuestion[] = [];

  for (const c of shuffled) {
    if (questions.length >= filters.questionCount) break;
    const key = `${c.hand}|${c.chartId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    questions.push({
      scenario: c.scenario,
      position: c.position,
      vs: c.vs,
      bb: c.bb,
      hand: c.hand,
      correct: c.handData,
      chartId: c.chartId,
    });
  }

  return questions;
}

// ---------------------------------------------------------------------------
// Evaluate a single answer
// ---------------------------------------------------------------------------

function evaluateAnswer(
  question: DrillQuestion,
  selectedAction: string,
): Omit<DrillAnswer, 'timestamp'> {
  const actions = getHandActions(question.correct);
  const primary = actions[0];
  const reach = question.correct.reach ?? 100;
  if (!primary || reach < 0.5) {
    return {
      question,
      selectedAction,
      selectedPct: 0,
      isCorrect: false,
      actionCorrect: false,
      pctError: 0,
    };
  }

  // Normalize every action's share by reach (so conditional nodes compare fairly).
  // Mixed = primary action doesn't fully occupy the reached probability.
  const isMixed = actions.length > 1 && primary.pct < reach - 0.5;
  // Accept any action whose normalized share within reach is ≥ 5%.
  const acceptable = isMixed
    ? new Set(actions.filter((a) => a.pct / reach >= 0.05).map((a) => a.action))
    : new Set([primary.action]);
  const actionCorrect = acceptable.has(selectedAction);
  return { question, selectedAction, selectedPct: 0, isCorrect: actionCorrect, actionCorrect, pctError: 0 };
}

// ---------------------------------------------------------------------------
// Main drill page component
// ---------------------------------------------------------------------------

type Phase = 'config' | 'loading' | 'quiz' | 'review';

export default function DrillPage() {
  const [phase, setPhase] = useState<Phase>('config');
  const [index, setIndex] = useState<IndexData | null>(null);
  const { syncProgress } = useAuth();

  // Config state
  const [selectedScenarios, setSelectedScenarios] = useState<string[]>([]);
  const [selectedPositions, setSelectedPositions] = useState<string[]>([]);
  const [bbRange, setBbRange] = useState<[number, number]>([2, 100]);
  const [questionCount, setQuestionCount] = useState(20);
  const [mode, setMode] = useState<'random' | 'edge'>('random');

  // Quiz state
  const [questions, setQuestions] = useState<DrillQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<DrillAnswer[]>([]);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [selectedPct, setSelectedPct] = useState(50);
  const [availableActions, setAvailableActions] = useState<string[]>([]);
  const [flashResult, setFlashResult] = useState<'correct' | 'incorrect' | null>(null);
  const [showChart, setShowChart] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Preloaded scenario data cache for determining available actions per chart
  const scenarioDataCache = useRef<Record<string, ScenarioData>>({});

  // Load index on mount
  useEffect(() => {
    getIndex().then(setIndex);
  }, []);

  // Compute available positions from selected scenarios
  const availablePositions = (() => {
    if (!index || selectedScenarios.length === 0) return [];
    const posSet = new Set<string>();
    for (const s of selectedScenarios) {
      const meta = index.scenarios.find((sc) => sc.name === s);
      if (meta) meta.positions.forEach((p) => posSet.add(p));
    }
    return Array.from(posSet).sort();
  })();

  // When scenarios change, clear positions that are no longer valid
  useEffect(() => {
    setSelectedPositions((prev) => prev.filter((p) => availablePositions.includes(p)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedScenarios.join(',')]);

  // Start drill
  const startDrill = useCallback(async () => {
    if (selectedScenarios.length === 0) return;
    setPhase('loading');

    const filters: DrillFilters = {
      scenarios: selectedScenarios,
      positions: selectedPositions,
      bbRange,
      questionCount,
      mode,
    };

    try {
      // Preload scenario data
      for (const s of selectedScenarios) {
        const data = await getScenarioData(s);
        scenarioDataCache.current[s] = data;
      }

      const qs = await generateQuestions(filters, index?.series_definitions ?? {});
      if (qs.length === 0) {
        alert('No hands match your filters. Try broadening your selection.');
        setPhase('config');
        return;
      }
      setQuestions(qs);
      setAnswers([]);
      setCurrentIdx(0);
      setSelectedAction(null);
      setSelectedPct(50);
      setSubmitted(false);
      setFlashResult(null);

      // Determine available actions for the first question
      loadActionsForQuestion(qs[0]);

      setPhase('quiz');
    } catch (err) {
      console.error('Failed to generate questions:', err);
      alert('Failed to load data. Check that data files are available.');
      setPhase('config');
    }
  }, [selectedScenarios, selectedPositions, bbRange, questionCount, mode]);

  const loadActionsForQuestion = useCallback((q: DrillQuestion) => {
    const data = scenarioDataCache.current[q.scenario];
    if (!data) return;
    const chart = data.charts.find((c) => c.id === q.chartId);
    if (!chart) return;
    const actions = getAvailableActions(chart);
    setAvailableActions(actions);
  }, []);

  // Advance to next question (or end drill). Extracted so both auto-advance
  // (on correct) and manual-advance (on wrong, via Next button) call the same path.
  const advanceToNext = useCallback((allAnswersWithCurrent: DrillAnswer[]) => {
    setFlashResult(null);
    setSubmitted(false);
    setShowChart(false);

    const nextIdx = currentIdx + 1;
    if (nextIdx >= questions.length) {
      try {
        recordDrillSession(allAnswersWithCurrent, selectedScenarios.join(','));
        localStorage.setItem('lastDrillAnswers', JSON.stringify(allAnswersWithCurrent));
        syncProgress().catch(() => {});
      } catch (e) {
        console.error('Failed to record progress:', e);
      }
      setPhase('review');
    } else {
      setCurrentIdx(nextIdx);
      setSelectedAction(null);
      setSelectedPct(50);
      loadActionsForQuestion(questions[nextIdx]);
    }
  }, [currentIdx, questions, answers, selectedScenarios, syncProgress, loadActionsForQuestion]);

  // Submit answer — called directly on action click.
  // - Correct: flash ✓ and auto-advance after 1s (fast flow).
  // - Wrong:   flash ✗ and PAUSE — user clicks "Next" or "View Chart" to continue.
  const submitAnswer = useCallback((action: string) => {
    if (submitted) return;
    setSelectedAction(action);
    const question = questions[currentIdx];
    const result = evaluateAnswer(question, action);
    const answer: DrillAnswer = { ...result, timestamp: Date.now() };
    const allAnswersWithCurrent = [...answers, answer];

    setAnswers(allAnswersWithCurrent);
    setSubmitted(true);
    setFlashResult(answer.isCorrect ? 'correct' : 'incorrect');

    if (answer.isCorrect) {
      setTimeout(() => advanceToNext(allAnswersWithCurrent), 1000);
    }
    // Wrong → no setTimeout; user drives the pace via the Next / View Chart buttons.
  }, [submitted, questions, currentIdx, answers, advanceToNext]);

  // Context bar text
  const contextText = (q: DrillQuestion) => {
    const scenarioLabel = SCENARIO_LABELS[q.scenario] || q.scenario;
    if (q.vs) {
      return `${scenarioLabel}  |  ${q.position} vs ${q.vs}  |  ${q.bb}bb`;
    }
    return `${scenarioLabel}  |  ${q.position}  |  ${q.bb}bb`;
  };

  // ---------------------------------------------------------------------------
  // Render: Loading
  // ---------------------------------------------------------------------------
  if (!index) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-screen bg-zinc-950 text-white">
        <div className="text-xl animate-pulse">Loading data...</div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Phase - Config
  // ---------------------------------------------------------------------------
  if (phase === 'config') {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
          <h1 className="text-3xl font-bold">GTO Preflop Drill</h1>

          {/* Scenario selection */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-zinc-300">Scenarios</h2>
            <div className="flex flex-wrap gap-2">
              {[...index.scenarios].sort((a, b) => compareScenarios(a.name, b.name)).map((s) => {
                const active = selectedScenarios.includes(s.name);
                return (
                  <button
                    key={s.name}
                    onClick={() =>
                      setSelectedScenarios((prev) =>
                        active ? prev.filter((x) => x !== s.name) : [...prev, s.name],
                      )
                    }
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      active
                        ? 'bg-blue-600 text-white'
                        : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                    }`}
                  >
                    {SCENARIO_LABELS[s.name] || s.name}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Position selection */}
          {availablePositions.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold text-zinc-300">
                Positions{' '}
                <span className="text-sm font-normal text-zinc-500">(leave empty for all)</span>
              </h2>
              <div className="flex flex-wrap gap-2">
                {availablePositions.map((p) => {
                  const active = selectedPositions.includes(p);
                  return (
                    <button
                      key={p}
                      onClick={() =>
                        setSelectedPositions((prev) =>
                          active ? prev.filter((x) => x !== p) : [...prev, p],
                        )
                      }
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        active
                          ? 'bg-emerald-600 text-white'
                          : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* BB Range */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-zinc-300">
              BB Range: {bbRange[0]} - {bbRange[1]}
            </h2>
            <RangeSlider min={2} max={100} value={bbRange} onChange={setBbRange} />
            <div className="flex gap-3">
              <label className="flex items-center gap-2 text-sm text-zinc-400">
                Min:
                <input
                  type="number"
                  min={2}
                  max={bbRange[1]}
                  value={bbRange[0]}
                  onChange={(e) =>
                    setBbRange([clamp(Number(e.target.value), 2, bbRange[1]), bbRange[1]])
                  }
                  className="w-20 px-2 py-1 rounded bg-zinc-800 text-white text-center"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-400">
                Max:
                <input
                  type="number"
                  min={bbRange[0]}
                  max={100}
                  value={bbRange[1]}
                  onChange={(e) =>
                    setBbRange([bbRange[0], clamp(Number(e.target.value), bbRange[0], 100)])
                  }
                  className="w-20 px-2 py-1 rounded bg-zinc-800 text-white text-center"
                />
              </label>
            </div>
          </section>

          {/* Questions per round */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-zinc-300">Questions per Round</h2>
            <div className="flex gap-2">
              {[10, 20, 50].map((n) => (
                <button
                  key={n}
                  onClick={() => setQuestionCount(n)}
                  className={`px-6 py-2 rounded-lg text-sm font-medium transition-colors ${
                    questionCount === n
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </section>

          {/* Mode */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-zinc-300">Mode</h2>
            <div className="flex gap-2">
              {[
                { value: 'random' as const, label: 'Random' },
                { value: 'edge' as const, label: 'Edge Only' },
              ].map((m) => (
                <button
                  key={m.value}
                  onClick={() => setMode(m.value)}
                  className={`px-6 py-2 rounded-lg text-sm font-medium transition-colors ${
                    mode === m.value
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-zinc-500">
              Edge Only: tests each series&apos; floor hand plus the hand one above and one below it (e.g. if Q4s is the Qxs floor, drills Q3s / Q4s / Q5s).
            </p>
          </section>

          {/* Start button */}
          <button
            onClick={startDrill}
            disabled={selectedScenarios.length === 0}
            className="w-full py-4 rounded-xl text-lg font-bold bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 transition-colors"
          >
            Start Drill
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Phase - Loading
  // ---------------------------------------------------------------------------
  if (phase === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center min-h-screen bg-zinc-950 text-white">
        <div className="text-xl animate-pulse">Generating questions...</div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Phase - Quiz
  // ---------------------------------------------------------------------------
  if (phase === 'quiz') {
    const question = questions[currentIdx];
    const progressPct = ((currentIdx + 1) / questions.length) * 100;

    return (
      <div className="fixed inset-x-0 top-14 bottom-[56px] md:bottom-0 text-white flex flex-col z-40" style={{ background: 'radial-gradient(ellipse at 50% 0%, #1a2332 0%, #0c1118 50%, #080d12 100%)' }}>
        {/* Flash overlay */}
        {flashResult && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none transition-opacity duration-300"
            style={{
              background: flashResult === 'correct'
                ? 'radial-gradient(circle, rgba(34,197,94,0.3) 0%, transparent 70%)'
                : 'radial-gradient(circle, rgba(239,68,68,0.3) 0%, transparent 70%)',
            }}
          >
            <span className="text-9xl font-thin" style={{ color: flashResult === 'correct' ? '#22c55e' : '#ef4444' }}>
              {flashResult === 'correct' ? '\u2713' : '\u2717'}
            </span>
          </div>
        )}

        {/* Elegant progress bar */}
        <div className="h-0.5 bg-white/5 shrink-0">
          <div
            className="h-full transition-all duration-500 ease-out"
            style={{
              width: `${progressPct}%`,
              background: 'linear-gradient(90deg, #3b82f6, #22c55e)',
            }}
          />
        </div>

        <div className="flex-1 flex flex-col max-w-xl mx-auto w-full px-5 pb-[env(safe-area-inset-bottom,0px)] overflow-hidden">

          {/* ── Scenario heading ── */}
          <div className="pt-4 pb-2 shrink-0 text-center">
            <h1 className="text-lg font-extrabold tracking-tight text-sky-400">
              {SCENARIO_LABELS[question.scenario] || question.scenario}
            </h1>
            <div className="text-[10px] text-white/40 font-medium tracking-[0.2em] uppercase mt-1">
              {currentIdx + 1} / {questions.length}
            </div>
          </div>

          {/* ── Poker Table (GTO Wizard-style) ── */}
          <div className="flex-1 flex flex-col items-center justify-center min-h-0 py-2">
            <PokerTable
              scenario={question.scenario}
              heroPos={question.position}
              vs={question.vs}
              bb={question.bb}
              hand={question.hand}
            />
          </div>

          {/* ── Action Buttons (one-tap answer, auto-submit) ── */}
          <div className="pb-4 md:pb-6 shrink-0 space-y-3">
            <div className="flex flex-wrap gap-2">
              {availableActions.map((action) => {
                const isSelected = selectedAction === action;
                const color = ACTION_COLORS[action] || '#888';
                return (
                  <button
                    key={action}
                    onClick={() => submitAnswer(action)}
                    disabled={submitted}
                    className={`flex-1 min-w-[calc(33%-8px)] py-5 px-3 rounded-xl text-xl font-extrabold tracking-wide transition-all duration-200 ${
                      submitted ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer active:scale-95'
                    }`}
                    style={{
                      background: isSelected
                        ? `linear-gradient(135deg, ${color}, ${color}cc)`
                        : 'rgba(255,255,255,0.04)',
                      border: `1.5px solid ${isSelected ? color : 'rgba(255,255,255,0.08)'}`,
                      color: isSelected ? '#fff' : color,
                      boxShadow: isSelected
                        ? `0 4px 20px ${color}40, 0 0 40px ${color}15`
                        : 'none',
                      transform: isSelected ? 'scale(1.03)' : 'scale(1)',
                    }}
                  >
                    {ACTION_LABELS[action] || action}
                  </button>
                );
              })}
            </div>

            {/* Post-wrong-answer controls: stop auto-advance, let user study. */}
            {submitted && flashResult === 'incorrect' && (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowChart(true)}
                  className="flex-1 py-3 rounded-xl text-base font-bold border-2 border-sky-400/50 text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 active:scale-95 transition-all"
                >
                  查看正确范围
                </button>
                <button
                  onClick={() => advanceToNext(answers)}
                  className="flex-1 py-3 rounded-xl text-base font-bold bg-white/10 text-white border-2 border-white/20 hover:bg-white/15 active:scale-95 transition-all"
                >
                  下一题 →
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Range chart modal */}
        {showChart && (() => {
          const q = questions[currentIdx];
          const data = scenarioDataCache.current[q.scenario];
          const chart = data?.charts.find((c) => c.id === q.chartId);
          if (!chart) return null;
          const title = `${SCENARIO_LABELS[q.scenario] || q.scenario} · ${q.position}${q.vs ? ` vs ${q.vs}` : ''} · ${q.bb}bb`;
          return (
            <RangeMatrixModal
              chart={chart}
              title={title}
              highlightHand={q.hand}
              onClose={() => setShowChart(false)}
            />
          );
        })()}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Phase - Review
  // ---------------------------------------------------------------------------
  if (phase === 'review') {
    const correctCount = answers.filter((a) => a.isCorrect).length;
    const total = answers.length;
    const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0;

    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
          {/* Score summary */}
          <div className="text-center space-y-3">
            <h1 className="text-3xl font-bold">Drill Complete</h1>
            <div className="text-6xl font-bold">
              <span className={pct >= 70 ? 'text-green-400' : pct >= 40 ? 'text-yellow-400' : 'text-red-400'}>
                {pct}%
              </span>
            </div>
            <p className="text-zinc-400 text-lg">
              {correctCount} / {total} correct
            </p>
          </div>

          {/* Answer list */}
          <div className="space-y-4">
            {answers.map((answer, i) => {
              const q = answer.question;
              const actions = getHandActions(q.correct);

              return (
                <div
                  key={i}
                  className={`p-4 rounded-xl border ${
                    answer.isCorrect
                      ? 'border-green-800 bg-green-950/30'
                      : 'border-red-800 bg-red-950/30'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <span className="text-2xl mt-0.5">
                      {answer.isCorrect ? '\u2705' : '\u274C'}
                    </span>

                    <div className="flex-1 space-y-2 min-w-0">
                      {/* Context + hand */}
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-xl font-bold">{handDisplayString(q.hand)}</span>
                        <span className="text-xs font-mono text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded">
                          {contextText(q)}
                        </span>
                      </div>

                      {/* Your answer */}
                      <div className="text-sm">
                        <span className="text-zinc-500 text-xs mr-2">You picked:</span>
                        <span
                          className="font-bold"
                          style={{ color: ACTION_COLORS[answer.selectedAction] || '#888' }}
                        >
                          {ACTION_LABELS[answer.selectedAction] || answer.selectedAction}
                        </span>
                      </div>

                      {/* GTO frequency breakdown (normalized to reach for readability) */}
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <div className="text-zinc-500 text-xs">GTO solution</div>
                          {(q.correct.reach ?? 100) < 99.5 && (
                            <span className="text-[10px] font-mono text-amber-400/80">
                              reach {(q.correct.reach ?? 100).toFixed(0)}%
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {actions.map((a) => {
                            const reach = q.correct.reach ?? 100;
                            const normalized = reach > 0 ? (a.pct / reach) * 100 : 0;
                            return (
                              <span
                                key={a.action}
                                className="text-sm font-bold px-2 py-1 rounded"
                                style={{
                                  background: `${ACTION_COLORS[a.action] || '#888'}22`,
                                  color: ACTION_COLORS[a.action] || '#888',
                                  border: `1px solid ${ACTION_COLORS[a.action] || '#888'}55`,
                                }}
                              >
                                {ACTION_LABELS[a.action] || a.action} {normalized.toFixed(0)}%
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4">
            <a
              href="/review"
              className="flex-1 py-3 rounded-xl font-semibold bg-amber-600 hover:bg-amber-500 transition-colors text-center"
            >
              Detailed Review
            </a>
            <button
              onClick={() => {
                setPhase('config');
                setAnswers([]);
                setQuestions([]);
                setCurrentIdx(0);
              }}
              className="flex-1 py-3 rounded-xl font-semibold bg-zinc-800 hover:bg-zinc-700 transition-colors"
            >
              New Drill
            </button>
            <button
              onClick={startDrill}
              className="flex-1 py-3 rounded-xl font-semibold bg-blue-600 hover:bg-blue-500 transition-colors"
            >
              Retry Same Settings
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
