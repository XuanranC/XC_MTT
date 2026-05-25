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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const startTime = Date.now();
  const authFail = requireAuth(request, startTime);
  if (authFail) return authFail;

  try {
    const scenarios = await listApiScenarios();
    return successResponse({ scenarios }, { startTime });
  } catch (e) {
    return errors.internal(e, startTime);
  }
}
