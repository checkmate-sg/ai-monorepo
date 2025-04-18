// Generated by Wrangler by running `wrangler types`

// Import types from the database service

// Generic database service types that allows any number of parameters
type DatabaseServiceMethod<TResult = any> = (
  ...args: any[]
) => Promise<TResult>;

type DatabaseServiceMethods = Record<string, DatabaseServiceMethod>;

interface Env {
  CHECKER_AGENT: DurableObjectNamespace<import("./src/index").CheckerAgent>;
  // Service bindings with custom methods
  SEARCH_SERVICE: {
    search(params: SearchRequest): Promise<SearchResult>;
  } & ServiceWorkerGlobalScope;

  SCREENSHOT_SERVICE: {
    screenshot(params: ScreenshotRequest): Promise<ScreenshotResult>;
  } & ServiceWorkerGlobalScope;

  URLSCAN_SERVICE: {
    urlScan(params: URLScanRequest): Promise<URLScanResult>;
  } & ServiceWorkerGlobalScope;

  EMBEDDER_SERVICE: {
    embed(params: EmbedRequest): Promise<EmbedResult>;
  } & ServiceWorkerGlobalScope;

  DATABASE_SERVICE: DatabaseServiceMethods & ServiceWorkerGlobalScope;

  LANGFUSE_PUBLIC_KEY: string;
  LANGFUSE_SECRET_KEY: string;
  LANGFUSE_HOST: string;
  ENVIRONMENT: string;
}
