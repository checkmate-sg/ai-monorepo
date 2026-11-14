/**
 * Shared Langfuse setup for all workers (Langfuse JS/TS SDK v6, OpenTelemetry-based).
 *
 * Replaces the v3 `langfuse` / `langfuse-vercel` SDKs, which send traces through the
 * legacy batch ingestion API that Langfuse Cloud removes at the v4 cutover.
 *
 * Usage in a worker:
 *   const result = await withTrace(env, { name, traceSeed, input, tags }, async (root) => ...);
 *   ctx.waitUntil(flushLangfuse());
 *
 * Anything that creates spans (startActiveObservation, observeOpenAI, the Vercel AI SDK's
 * experimental_telemetry) inside `withTrace` nests under the root observation automatically
 * through AsyncLocalStorage, so the `nodejs_compat` compatibility flag is required.
 */
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseClient } from "@langfuse/client";
import {
  getActiveTraceId,
  propagateAttributes,
  setLangfuseTracerProvider,
  startActiveObservation,
  type LangfuseSpan,
} from "@langfuse/tracing";

import { traceIdFromSeed } from "./trace-id";

export { traceIdForCheck, traceUrlForCheck } from "./trace-id";
export { observeOpenAI } from "@langfuse/openai";
export type {
  ChatPromptClient,
  LangfuseClient,
  TextPromptClient,
} from "@langfuse/client";
export type { LangfuseSpan } from "@langfuse/tracing";

export interface LangfuseEnv {
  ENVIRONMENT: string;
  LANGFUSE_PUBLIC_KEY: string;
  LANGFUSE_SECRET_KEY: string;
  LANGFUSE_HOST: string;
}

let spanProcessor: LangfuseSpanProcessor | null = null;
let client: LangfuseClient | null = null;

function credentials(env: LangfuseEnv) {
  return {
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    baseUrl: env.LANGFUSE_HOST,
  };
}

/**
 * Registers the OpenTelemetry tracer provider and context manager once per isolate.
 * Called by withTrace, so workers rarely need to call it directly.
 */
export function initLangfuseTracing(env: LangfuseEnv): void {
  if (spanProcessor) return;

  spanProcessor = new LangfuseSpanProcessor({
    ...credentials(env),
    // process.env is not populated on Workers, so set this explicitly
    environment: env.ENVIRONMENT,
    // Recommended for Workers: forceFlush then waits for every in-flight export,
    // so nothing is cut off when the request's waitUntil ends
    exportMode: "immediate",
  });
  const provider = new BasicTracerProvider({ spanProcessors: [spanProcessor] });

  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  // Global so the Vercel AI SDK's telemetry spans reach Langfuse too
  trace.setGlobalTracerProvider(provider);
  setLangfuseTracerProvider(provider);
}

/** Langfuse client for prompt management and scores. One per isolate, so its prompt cache is shared. */
export function getLangfuseClient(env: LangfuseEnv): LangfuseClient {
  client ??= new LangfuseClient(credentials(env));
  return client;
}

/** Prompt label for the environment. Production prompts carry the `cf-production` label. */
export function promptLabel(env: LangfuseEnv): string {
  //TODO: revert after google version deprecated
  return env.ENVIRONMENT === "production" ? "cf-production" : env.ENVIRONMENT;
}

/** Fetches a chat prompt by name, with the environment's label unless one is given. */
export function getChatPrompt(
  env: LangfuseEnv,
  name: string,
  label: string = promptLabel(env),
) {
  return getLangfuseClient(env).prompt.get(name, { label, type: "chat" });
}

/** Sends any buffered spans. Call via waitUntil after the traced work has finished. */
export async function flushLangfuse(): Promise<void> {
  await spanProcessor?.forceFlush();
}

export interface TraceOptions {
  /** Trace name, also used for the root observation */
  name: string;
  /** Seed for a deterministic trace ID (e.g. the check ID). Random if omitted. */
  traceSeed?: string;
  input?: unknown;
  /** Propagated to every observation, so values should be short strings */
  metadata?: Record<string, string>;
  tags?: string[];
}

/**
 * Runs `fn` inside a new trace. The root observation carries the trace's input and
 * `fn`'s return value as output; name, tags and metadata propagate to every child.
 */
export async function withTrace<T>(
  env: LangfuseEnv,
  options: TraceOptions,
  fn: (root: LangfuseSpan) => Promise<T>,
): Promise<T> {
  initLangfuseTracing(env);
  const traceId = options.traceSeed
    ? await traceIdFromSeed(options.traceSeed)
    : undefined;

  return startActiveObservation(
    options.name,
    (root) =>
      // Inside the root so only it and its children get these attributes
      propagateAttributes(
        {
          traceName: options.name,
          tags: options.tags,
          metadata: options.metadata,
        },
        () => runObserved(root, options.input, fn),
      ),
    traceId
      ? {
          // The documented way to set a trace ID: a remote parent on that trace
          parentSpanContext: {
            traceId,
            spanId: randomSpanId(),
            traceFlags: 1,
          },
        }
      : undefined,
  );
}

/**
 * Runs `fn` inside a child span of the active observation (or a standalone trace if none),
 * recording `input`, the return value as output, and errors.
 */
export function withSpan<T>(
  name: string,
  input: unknown,
  fn: (span: LangfuseSpan) => Promise<T>,
): Promise<T> {
  return startActiveObservation(name, (span) => runObserved(span, input, fn));
}

/**
 * For code reachable both inside and outside a trace: a child span when a trace is
 * active, otherwise a new trace.
 */
export function withSpanOrTrace<T>(
  env: LangfuseEnv,
  options: TraceOptions,
  fn: (span: LangfuseSpan) => Promise<T>,
): Promise<T> {
  return getActiveTraceId()
    ? withSpan(options.name, options.input, fn)
    : withTrace(env, options, fn);
}

/**
 * Adds tags (e.g. "error") to the active observation and any children started after.
 * Call it directly inside withTrace, not inside a withSpan, so the tags land on the root.
 */
export function addTraceTags(tags: string[]): void {
  propagateAttributes({ tags }, () => undefined);
}

async function runObserved<T>(
  span: LangfuseSpan,
  input: unknown,
  fn: (span: LangfuseSpan) => Promise<T>,
): Promise<T> {
  if (input !== undefined) span.update({ input });
  try {
    const output = await fn(span);
    span.update({ output });
    return output;
  } catch (error) {
    span.update({
      level: "ERROR",
      statusMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function randomSpanId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
