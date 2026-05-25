/**
 * GET /api/v1/depth-compare
 *
 * Same hand, multiple bb depths. Used by K仔 to discuss "how does the action
 * shift as stack drops from 40bb to 12bb".
 */

import { successResponse, errors } from '@/lib/api/respond';
import { requireAuth } from '@/lib/api/auth';
import { normalizeHand, nearestBb, parseIntList } from '@/lib/api/normalize';
import {
  API_SCENARIO_NAMES,
  isApiScenario,
  routeRequest,
  chartBbsForRoute,
  findChartViaRoute,
} from '@/lib/api/scenarios';
import { toApiHand } from '@/lib/api/transform';

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
    const handRaw = params.get('hand');
    const vsParam = params.get('vs_position');
    const bbListRaw = params.get('bb_list');

    if (!scenario) return errors.missingParam('scenario', startTime);
    if (!position) return errors.missingParam('position', startTime);
    if (!handRaw) return errors.missingParam('hand', startTime);

    if (!isApiScenario(scenario)) {
      return errors.scenarioNotFound(scenario, [...API_SCENARIO_NAMES], startTime);
    }

    let hand: string;
    try {
      hand = normalizeHand(handRaw);
    } catch {
      return errors.unknownHand(handRaw, startTime);
    }

    const routed = await routeRequest(scenario, position, vsParam);
    if (!routed.ok) {
      return errors.invalidVsPosition(scenario, routed.available, startTime);
    }
    const route = routed.route;

    const availableBbs = await chartBbsForRoute(route);
    if (availableBbs.length === 0) {
      return errors.chartNotFound(
        { scenario, position, bb: -1, vs: vsParam },
        startTime
      );
    }

    // Determine which bbs to evaluate: explicit list or all available
    const requestedList = parseIntList(bbListRaw);
    const targetBbs = requestedList && requestedList.length > 0 ? requestedList : availableBbs;

    const depths: Array<{
      bb: number;
      bb_actual: number;
      primary_action: string;
      actions: ReturnType<typeof toApiHand>['actions'];
      ev: number | null;
      reach: number;
    }> = [];

    for (const bb of targetBbs) {
      const bbActual = nearestBb(bb, availableBbs);
      if (bbActual == null) continue;
      const chart = await findChartViaRoute(route, bbActual);
      if (!chart) continue;
      const handData = chart.hands[hand];
      const apiH = toApiHand(handData);
      depths.push({
        bb,
        bb_actual: bbActual,
        primary_action: apiH.primary_action,
        actions: apiH.actions,
        ev: apiH.ev,
        reach: apiH.reach,
      });
    }

    return successResponse(
      {
        scenario,
        position,
        hand,
        vs_position: vsParam ?? null,
        depths,
      },
      { startTime }
    );
  } catch (e) {
    return errors.internal(e, startTime);
  }
}
