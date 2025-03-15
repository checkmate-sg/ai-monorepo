// Embedding related types
export interface ServiceResponse {
  id?: string;
  success: boolean;
}

// Common error response type for all services
export interface ErrorResponse extends ServiceResponse {
  success: false;
  error: {
    message: string;
    code?: string;
    details?: unknown;
  };
}

export interface EmbedRequest {
  text: string;
  id?: string;
  model?: keyof AiModels;
}

export interface TrivialFilterRequest {
  text: string;
  id?: string;
}

export interface TrivialFilterResponse extends ServiceResponse {
  result: {
    needsChecking: boolean;
  };
}

export interface EmbedResponse extends ServiceResponse {
  embedding: number[];
  model: keyof AiModels;
}

export interface ScreenshotRequest {
  url: string;
  id?: string;
}

export interface ScreenshotResponse extends ServiceResponse {
  success: true;
  result: {
    url: string;
    imageUrl: string;
  };
}

export interface SearchRequest {
  q: string;
  id?: string;
}

export interface SearchResponse extends ServiceResponse {
  success: true;
  result: object;
}

export interface URLScanRequest {
  url: string;
  id?: string;
}

export interface URLScanResponse extends ServiceResponse {
  success: true;
  result: object;
}

export type LLMProvider = "openai" | "vertex-ai" | "groq";

// Base interface with common properties
interface BaseAgentRequest {
  id?: string;
  provider?: LLMProvider;
  consumerName?: string;
}

// Text-only request
interface TextAgentRequest extends BaseAgentRequest {
  text: string;
  imageUrl?: never;
  caption?: never;
}

// Image request with optional caption
interface ImageAgentRequest extends BaseAgentRequest {
  text?: never;
  imageUrl: string;
  caption?: string;
}

// Union type to enforce either text OR image+optional caption
export type AgentRequest = TextAgentRequest | ImageAgentRequest;

export interface AgentResponse extends ServiceResponse {
  success: true;
  result: {
    report: string;
    communityNote: CommunityNote;
    isControversial: boolean;
    isVideo: boolean;
    isAccessBlocked: boolean;
  };
}

export interface CommunityNote {
  en: string;
  cn: string;
  links: string[];
}

// Union type for all possible agent responses
export type AgentResult = AgentResponse | ErrorResponse;

// Union types for service results to include error responses
export type EmbedResult = EmbedResponse | ErrorResponse;
export type ScreenshotResult = ScreenshotResponse | ErrorResponse;
export type SearchResult = SearchResponse | ErrorResponse;
export type URLScanResult = URLScanResponse | ErrorResponse;
export type TrivialFilterResult = TrivialFilterResponse | ErrorResponse;
