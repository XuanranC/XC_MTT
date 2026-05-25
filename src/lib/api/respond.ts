/**
 * Response envelopes for the public xc-mtt API (v1).
 *
 * Every successful response is wrapped as { request_id, data } and carries
 * a Cache-Control header. Errors share the envelope shape with error/message/
 * hint fields. See _API集成需求_最终版.md §4 for the full contract.
 */

import { randomUUID } from 'crypto';

const API_VERSION = '1.0';
const DEFAULT_CACHE = 'private, max-age=300, stale-while-revalidate=86400';

export interface ApiErrorBody {
  error: string;
  message: string;
  hint?: string;
}

function makeHeaders(extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  h.set('X-API-Version', API_VERSION);
  return h;
}

export function successResponse(
  data: unknown,
  init?: { startTime?: number; cacheControl?: string; extraHeaders?: HeadersInit }
): Response {
  const headers = makeHeaders(init?.extraHeaders);
  headers.set('Cache-Control', init?.cacheControl ?? DEFAULT_CACHE);
  if (init?.startTime) {
    headers.set('X-Response-Time', `${Date.now() - init.startTime}ms`);
  }
  headers.set('Content-Type', 'application/json; charset=utf-8');
  const body = JSON.stringify({
    request_id: randomUUID(),
    data,
  });
  return new Response(body, { status: 200, headers });
}

export function errorResponse(
  status: number,
  body: ApiErrorBody,
  startTime?: number
): Response {
  const headers = makeHeaders();
  // Errors are never cached.
  headers.set('Cache-Control', 'no-store');
  if (startTime) {
    headers.set('X-Response-Time', `${Date.now() - startTime}ms`);
  }
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(
    JSON.stringify({
      request_id: randomUUID(),
      ...body,
    }),
    { status, headers }
  );
}

// Convenience constructors for the most common error shapes.

export const errors = {
  missingParam: (param: string, startTime?: number) =>
    errorResponse(
      400,
      {
        error: 'MISSING_PARAM',
        message: `Required query parameter '${param}' is missing.`,
        hint: `Add ?${param}=...`,
      },
      startTime
    ),

  unauthorized: (startTime?: number) =>
    errorResponse(
      401,
      {
        error: 'UNAUTHORIZED',
        message: 'Bearer token missing or invalid.',
        hint: "Include header: Authorization: Bearer <API_TOKEN>",
      },
      startTime
    ),

  scenarioNotFound: (scenario: string, available: string[], startTime?: number) =>
    errorResponse(
      404,
      {
        error: 'SCENARIO_NOT_FOUND',
        message: `Scenario '${scenario}' is not recognized.`,
        hint: `Available scenarios: ${available.join(', ')}`,
      },
      startTime
    ),

  chartNotFound: (
    detail: { scenario: string; position: string; bb: number; vs?: string | null },
    startTime?: number
  ) =>
    errorResponse(
      404,
      {
        error: 'CHART_NOT_FOUND',
        message: `No chart found for scenario=${detail.scenario}, position=${detail.position}, bb=${detail.bb}${detail.vs ? `, vs=${detail.vs}` : ''}.`,
        hint: 'Use /api/v1/scenarios to see valid combinations.',
      },
      startTime
    ),

  unknownHand: (raw: string, startTime?: number) =>
    errorResponse(
      422,
      {
        error: 'UNKNOWN_HAND',
        message: `Hand '${raw}' could not be normalized to a standard 169 notation (e.g. AKs, AKo, AA).`,
        hint: 'Use 2-character pair (AA), or 3-character suited/offsuit (AKs / AKo).',
      },
      startTime
    ),

  invalidVsPosition: (scenario: string, available: string[], startTime?: number) =>
    errorResponse(
      422,
      {
        error: 'INVALID_VS_POSITION',
        message: `Scenario '${scenario}' requires a valid vs_position.`,
        hint: `Allowed values: ${available.join(', ') || '(none configured)'}`,
      },
      startTime
    ),

  internal: (e: unknown, startTime?: number) => {
    const detail = e instanceof Error ? e.message : String(e);
    return errorResponse(
      500,
      {
        error: 'INTERNAL_ERROR',
        message: 'Server error processing this request.',
        hint: `Detail: ${detail}`,
      },
      startTime
    );
  },
};
