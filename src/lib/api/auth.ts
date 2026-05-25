/**
 * Bearer-token authentication for the public API.
 *
 * Token is set via Vercel env var API_TOKEN. The check is a plain ===; we are
 * not protecting financial assets, just gating GTO data access for a single
 * known consumer (K仔). Rotation = update env var + redeploy.
 */

import { errors } from './respond';

const TOKEN_ENV = 'API_TOKEN';

/**
 * If the request authenticates successfully, returns null and the caller
 * proceeds. If not, returns a 401 Response that the caller must return.
 */
export function requireAuth(request: Request, startTime?: number): Response | null {
  const expected = process.env[TOKEN_ENV];
  if (!expected) {
    // Fail-closed: if the deployment forgot to set the token, treat every
    // request as unauthenticated rather than silently accepting all.
    return errors.unauthorized(startTime);
  }

  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return errors.unauthorized(startTime);

  // Constant-time-ish compare (Node's timingSafeEqual requires equal length;
  // we approximate by comparing once after a length check).
  const provided = match[1].trim();
  if (provided.length !== expected.length) return errors.unauthorized(startTime);
  if (provided !== expected) return errors.unauthorized(startTime);

  return null;
}
