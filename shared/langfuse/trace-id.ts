/**
 * Langfuse trace IDs for checks. Dependency-free so services that only build trace links
 * (e.g. notification-service) don't bundle the Langfuse SDK.
 */

/**
 * Deterministic 32-hex OpenTelemetry trace ID from a seed: the first 32 hex chars of its
 * SHA-256, identical to Langfuse's `createTraceId(seed)` (JS) and `create_trace_id(seed=...)` (Python).
 */
export async function traceIdFromSeed(seed: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(seed),
  );
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/**
 * Langfuse trace ID for a check, derived from its MongoDB ID (OpenTelemetry trace IDs are
 * 32 hex chars). Traces from before the Langfuse v4 migration use the raw check ID.
 */
export const traceIdForCheck = traceIdFromSeed;

/** Langfuse UI link to a check's trace. */
export async function traceUrlForCheck(
  langfuseHost: string,
  projectId: string,
  checkId: string,
): Promise<string> {
  return `${langfuseHost}/project/${projectId}/traces/${await traceIdForCheck(checkId)}`;
}
