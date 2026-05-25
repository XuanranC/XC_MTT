/**
 * GET /api/v1/health
 *
 * Public — no auth required. Returns version + cached-scenario count + uptime.
 * K仔 polls this before issuing real requests.
 */

import { successResponse, errors } from '@/lib/api/respond';
import { loadedScenarioCount } from '@/lib/api/server-data';
import { totalScenarioFiles } from '@/lib/api/scenarios';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROCESS_START = Date.now();

export async function GET() {
  const startTime = Date.now();
  try {
    return successResponse(
      {
        status: 'ok',
        version: '1.0',
        scenarios_loaded: loadedScenarioCount(),
        scenarios_total: totalScenarioFiles(),
        uptime_seconds: Math.floor((Date.now() - PROCESS_START) / 1000),
      },
      { startTime, cacheControl: 'no-store' }
    );
  } catch (e) {
    return errors.internal(e, startTime);
  }
}
