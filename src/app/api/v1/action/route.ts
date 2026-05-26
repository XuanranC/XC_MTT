/**
 * GET /api/v1/action
 *
 * Single-hand GTO solution lookup. The most-used endpoint — K仔's primary
 * "what should I do here?" query path.
 */

import { successResponse, errors } from '@/lib/api/respond';
import { requireAuth } from '@/lib/api/auth';
import { normalizeHand, nearestBb, parseIntParam } from '@/lib/api/normalize';
import {
  API_SCENARIO_NAMES,
  isApiScenario,
  routeRequest,
  chartBbsForRoute,
  findChartViaRoute,
} from '@/lib/api/scenarios';
import { loadIndex, DEFAULT_GAME_TYPE, GAME_TYPES, isGameType } from '@/lib/api/server-data';
import type { GameType } from '@/lib/api/server-data';
import { toApiHand, computeEdgeAnnotation } from '@/lib/api/transform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const startTime = Date.now();
  const authFail = requireAuth(request, startTime);
  if (authFail) return authFail;

  try {
    const url = new URL(request.url);
    const params = url.searchParams;

    // 1. Required params
    const scenario = params.get('scenario');
    const position = params.get('position');
    const bbRaw = params.get('bb');
    const handRaw = params.get('hand');
    const vsParam = params.get('vs_position');

    // Optional: game_type (default 'mtt' for backward compat)
    const gameTypeRaw = params.get('game_type') ?? DEFAULT_GAME_TYPE;
    if (!isGameType(gameTypeRaw)) {
      return errors.missingParam(`game_type (must be one of: ${GAME_TYPES.join(', ')})`, startTime);
    }
    const gameType: GameType = gameTypeRaw;

    if (!scenario) return errors.missingParam('scenario', startTime);
    if (!position) return errors.missingParam('position', startTime);
    if (bbRaw == null) return errors.missingParam('bb', startTime);
    if (!handRaw) return errors.missingParam('hand', startTime);

    if (!isApiScenario(scenario)) {
      return errors.scenarioNotFound(scenario, [...API_SCENARIO_NAMES], startTime);
    }

    const bbRequested = parseIntParam(bbRaw, 1, 1000);
    if (bbRequested == null) {
      return errors.missingParam('bb (must be a positive integer)', startTime);
    }

    // 2. Hand normalization
    let hand: string;
    try {
      hand = normalizeHand(handRaw);
    } catch {
      return errors.unknownHand(handRaw, startTime);
    }

    // 3. Resolve routing (handles VS_OPEN BB-vs-nonBB split + vs validation)
    const routed = await routeRequest(scenario, position, vsParam, gameType);
    if (!routed.ok) {
      return errors.invalidVsPosition(scenario, routed.available, startTime);
    }
    const route = routed.route;

    // 4. Snap bb to nearest available
    const bbList = await chartBbsForRoute(route);
    if (bbList.length === 0) {
      return errors.chartNotFound(
        { scenario, position, bb: bbRequested, vs: vsParam },
        startTime
      );
    }
    const bbActual = nearestBb(bbRequested, bbList);
    if (bbActual == null) {
      return errors.chartNotFound(
        { scenario, position, bb: bbRequested, vs: vsParam },
        startTime
      );
    }

    // 5. Find chart
    const chart = await findChartViaRoute(route, bbActual);
    if (!chart) {
      return errors.chartNotFound(
        { scenario, position, bb: bbRequested, vs: vsParam },
        startTime
      );
    }

    // 6. Build response
    const handData = chart.hands[hand];
    const apiHand = toApiHand(handData);

    const idx = await loadIndex(gameType);
    const edgeAnno = computeEdgeAnnotation(hand, chart, idx.series_definitions);

    return successResponse(
      {
        game_type: gameType,
        scenario,
        position,
        bb: bbRequested,
        bb_actual: bbActual,
        vs_position: vsParam ?? null,
        hand,
        actions: apiHand.actions,
        primary_action: apiHand.primary_action,
        ev: apiHand.ev,
        reach: apiHand.reach,
        is_edge: edgeAnno.is_edge,
        edge_series: edgeAnno.edge_series,
        edge_floor: edgeAnno.edge_floor,
      },
      { startTime }
    );
  } catch (e) {
    return errors.internal(e, startTime);
  }
}
