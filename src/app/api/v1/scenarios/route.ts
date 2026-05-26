/**
 * GET /api/v1/scenarios
 *
 * Discovery endpoint — lists every API-exposed scenario with its accepted
 * positions, vs_positions, and bb buckets. Lets K仔 enumerate the valid
 * parameter space without trial-and-error.
 */

import { successResponse, errors } from '@/lib/api/respond';
import { requireAuth } from '@/lib/api/auth';
import { listApiScenarios } from '@/lib/api/scenarios';
import { DEFAULT_GAME_TYPE, GAME_TYPES, isGameType } from '@/lib/api/server-data';
import type { GameType } from '@/lib/api/server-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const startTime = Date.now();
  const authFail = requireAuth(request, startTime);
  if (authFail) return authFail;

  try {
    const url = new URL(request.url);
    const gameTypeRaw = url.searchParams.get('game_type') ?? DEFAULT_GAME_TYPE;
    if (!isGameType(gameTypeRaw)) {
      return errors.missingParam(`game_type (must be one of: ${GAME_TYPES.join(', ')})`, startTime);
    }
    const gameType: GameType = gameTypeRaw;

    const scenarios = await listApiScenarios(gameType);
    return successResponse({ game_type: gameType, scenarios }, { startTime });
  } catch (e) {
    return errors.internal(e, startTime);
  }
}
