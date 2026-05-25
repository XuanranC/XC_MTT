/**
 * GET /api/v1/range
 *
 * Full 169-hand range dump for a (scenario, position, bb [, vs]) chart.
 * K仔 grabs this when discussing a whole range, not just one hand.
 */

import { successResponse, errors } from '@/lib/api/respond';
import { requireAuth } from '@/lib/api/auth';
import { nearestBb, parseIntParam } from '@/lib/api/normalize';
import {
  API_SCENARIO_NAMES,
  isApiScenario,
  routeRequest,
  chartBbsForRoute,
  findChartViaRoute,
} from '@/lib/api/scenarios';
import { loadIndex } from '@/lib/api/server-data';
import { toApiHand, toApiEdge, computeStats } from '@/lib/api/transform';
import type { ApiActionFreqs } from '@/lib/api/transform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const startTime = Date.now();
  const authFail = requireAuth(request, startTime);
  if (authFail) return authFail;

  try {
    const url = new URL(request.url);
    const params = url.searchParams;

    const scenario = params.get('scenario');
    const position = params.get('position');
    const bbRaw = params.get('bb');
    const vsParam = params.get('vs_position');

    if (!scenario) return errors.missingParam('scenario', startTime);
    if (!position) return errors.missingParam('position', startTime);
    if (bbRaw == null) return errors.missingParam('bb', startTime);

    if (!isApiScenario(scenario)) {
      return errors.scenarioNotFound(scenario, [...API_SCENARIO_NAMES], startTime);
    }

    const bbRequested = parseIntParam(bbRaw, 1, 1000);
    if (bbRequested == null) {
      return errors.missingParam('bb (must be a positive integer)', startTime);
    }

    const routed = await routeRequest(scenario, position, vsParam);
    if (!routed.ok) {
      return errors.invalidVsPosition(scenario, routed.available, startTime);
    }
    const route = routed.route;

    const bbList = await chartBbsForRoute(route);
    if (bbList.length === 0) {
      return errors.chartNotFound({ scenario, position, bb: bbRequested, vs: vsParam }, startTime);
    }
    const bbActual = nearestBb(bbRequested, bbList);
    if (bbActual == null) {
      return errors.chartNotFound({ scenario, position, bb: bbRequested, vs: vsParam }, startTime);
    }

    const chart = await findChartViaRoute(route, bbActual);
    if (!chart) {
      return errors.chartNotFound({ scenario, position, bb: bbRequested, vs: vsParam }, startTime);
    }

    const idx = await loadIndex();
    const allHands: string[] = idx.hand_matrix.flat();

    // Build hands payload — every 169 entry, fallback to full-fold for missing.
    // `reach` is per-hand (not per-chart) because conditional nodes can have
    // different reach per combo (e.g. some prior-street branches don't reach
    // every combo equally).
    const handsOut: Record<string, ApiActionFreqs & { ev: number | null; reach: number }> = {};
    for (const h of allHands) {
      const apiH = toApiHand(chart.hands[h]);
      handsOut[h] = { ...apiH.actions, ev: apiH.ev, reach: apiH.reach };
    }

    const edgesOut: Record<string, ReturnType<typeof toApiEdge>> = {};
    for (const [k, e] of Object.entries(chart.edges ?? {})) {
      edgesOut[k] = toApiEdge(e);
    }

    const stats = computeStats(chart);

    return successResponse(
      {
        scenario,
        position,
        bb: bbRequested,
        bb_actual: bbActual,
        vs_position: vsParam ?? null,
        hands: handsOut,
        edges: edgesOut,
        stats,
      },
      { startTime }
    );
  } catch (e) {
    return errors.internal(e, startTime);
  }
}
