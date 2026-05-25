/**
 * Input normalization helpers used by every route.
 *
 * - normalizeHand: accept many casual hand notations, produce canonical 169
 *   format (AA / AKs / AKo). Throws on garbage.
 * - nearestBb: snap a free-form bb integer to the closest discrete bb that
 *   exists for the given scenario. Returns null when the scenario has no bbs.
 */

const RANK_ORDER = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const RANK_SET = new Set(RANK_ORDER);
const SUIT_CHARS = new Set(['s', 'h', 'd', 'c', '♠', '♥', '♦', '♣']);

function rankIndex(r: string): number {
  return RANK_ORDER.indexOf(r);
}

/**
 * Normalize hand input to canonical 169 notation.
 *
 * Accepted inputs:
 *   - "AA", "KK", "22"  → pair
 *   - "AKs", "AKo"      → ordered + suited/offsuit suffix
 *   - "KAs", "kao"      → unordered ranks + case-insensitive
 *   - "Ah Kh", "AhKh"   → explicit cards with rank+suit; suits compared
 *   - "A♠K♠", "A♠ K♥"   → unicode suits accepted
 *
 * Returns canonical string or throws Error('UNKNOWN_HAND').
 */
export function normalizeHand(raw: string): string {
  if (!raw) throw new Error('UNKNOWN_HAND');
  const trimmed = raw.replace(/\s+/g, '').trim();
  if (!trimmed) throw new Error('UNKNOWN_HAND');

  // Map unicode suits to lowercase ASCII letters.
  const ascii = trimmed
    .replace(/♠/g, 's')
    .replace(/♥/g, 'h')
    .replace(/♦/g, 'd')
    .replace(/♣/g, 'c');

  // Uppercase only the rank letters (10 = T which is already a letter).
  // We do a two-pass parse: pull rank/suit tokens.
  const tokens: { rank: string; suit?: string }[] = [];
  let i = 0;
  while (i < ascii.length) {
    let ch = ascii[i];
    // Handle '10' as 'T'.
    if (ch === '1' && ascii[i + 1] === '0') {
      tokens.push({ rank: 'T' });
      i += 2;
      continue;
    }
    const upper = ch.toUpperCase();
    if (RANK_SET.has(upper)) {
      // Optional suit char immediately following
      const next = ascii[i + 1];
      if (next && SUIT_CHARS.has(next.toLowerCase()) && next !== 's' && next !== 'o') {
        // h/d/c only — 's' could be the suited suffix in `AKs`, handled later.
        tokens.push({ rank: upper, suit: next.toLowerCase() });
        i += 2;
        continue;
      }
      tokens.push({ rank: upper });
      i += 1;
      continue;
    }

    // Standalone suffix s/o at end of string — handled below
    if (ch.toLowerCase() === 's' || ch.toLowerCase() === 'o') {
      tokens.push({ rank: '', suit: ch.toLowerCase() });
      i += 1;
      continue;
    }

    throw new Error('UNKNOWN_HAND');
  }

  // Branch by token shape.
  // Shape A: two rank tokens (no suit chars) + 0 or 1 suffix
  //   ["A","K","s"] → AKs
  //   ["A","K"]     → ambiguous, accept as offsuit fallback? No, reject — pair OR explicit suffix only
  //   ["A","A"]     → AA (pair)
  // Shape B: two rank-with-suit tokens (Ah Kh)
  //   suits equal   → suited
  //   suits differ  → offsuit

  // Filter rank-only tokens vs suffix tokens
  const ranks = tokens.filter((t) => t.rank);
  if (ranks.length !== 2) throw new Error('UNKNOWN_HAND');

  const r1 = ranks[0].rank;
  const r2 = ranks[1].rank;
  if (!RANK_SET.has(r1) || !RANK_SET.has(r2)) throw new Error('UNKNOWN_HAND');

  // Order ranks: higher rank first.
  const [high, low] = rankIndex(r1) <= rankIndex(r2) ? [r1, r2] : [r2, r1];

  // Pair
  if (high === low) {
    // Pairs can't carry s/o or differing suits.
    const suffix = tokens.find((t) => !t.rank && t.suit && (t.suit === 's' || t.suit === 'o'));
    if (suffix) throw new Error('UNKNOWN_HAND');
    if (ranks[0].suit && ranks[1].suit && ranks[0].suit === ranks[1].suit) {
      // Same explicit suit on a pair → impossible (one deck).
      throw new Error('UNKNOWN_HAND');
    }
    return `${high}${low}`;
  }

  // Non-pair: determine suited vs offsuit
  let suited: boolean | null = null;

  // Case: explicit suit on each rank token
  if (ranks[0].suit && ranks[1].suit) {
    suited = ranks[0].suit === ranks[1].suit;
  }

  // Case: suffix token present
  const suffix = tokens.find((t) => !t.rank && t.suit && (t.suit === 's' || t.suit === 'o'));
  if (suffix) {
    const explicit = suffix.suit === 's';
    if (suited !== null && suited !== explicit) throw new Error('UNKNOWN_HAND');
    suited = explicit;
  }

  if (suited === null) throw new Error('UNKNOWN_HAND');

  return `${high}${low}${suited ? 's' : 'o'}`;
}

/**
 * Pick the bb value closest to `requested` from the sorted `available` list.
 * Tie → lower (predictable).
 *
 * Returns null when the list is empty.
 */
export function nearestBb(requested: number, available: number[]): number | null {
  if (available.length === 0) return null;
  let best = available[0];
  let bestDiff = Math.abs(best - requested);
  for (let i = 1; i < available.length; i++) {
    const bb = available[i];
    const diff = Math.abs(bb - requested);
    if (diff < bestDiff || (diff === bestDiff && bb < best)) {
      best = bb;
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * Parse an integer from query string with bounds. Returns null if missing or
 * malformed.
 */
export function parseIntParam(value: string | null, min = -Infinity, max = Infinity): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

/**
 * Parse a comma-separated list of integers ("2,6,10,20"). Empty/invalid entries
 * are skipped. Returns null for missing input; an array otherwise.
 */
export function parseIntList(value: string | null): number[] | null {
  if (value == null) return null;
  const parts = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && Number.isInteger(n));
  return parts;
}
