// Embedding related types
export interface ServiceResponse {
  id?: string;
  success: boolean;
}
export interface EmbedRequest {
  text: string;
  id?: string;
  model?: keyof AiModels;
}

export interface EmbedResponse extends ServiceResponse {
  embedding: number[];
  model: keyof AiModels;
}

// Error response for embedding service
export interface EmbedErrorResponse {
  success: false;
  error: {
    message: string;
    code?: string;
    details?: unknown;
  };
  id?: string;
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

// Error response for screenshot service
export interface ScreenshotErrorResponse {
  success: false;
  error: {
    message: string;
    code?: string;
    details?: unknown;
  };
  id?: string;
}

export interface SearchRequest {
  q: string;
  id?: string;
}

export interface SearchResponse extends ServiceResponse {
  success: true;
  result: object;
}

// Error response for search service
export interface SearchErrorResponse {
  success: false;
  error: {
    message: string;
    code?: string;
    details?: unknown;
  };
  id?: string;
}

export interface URLScanRequest {
  url: string;
  id?: string;
}

export interface URLScanResponse extends ServiceResponse {
  success: true;
  result: object;
}

// Error response for URL scan service
export interface URLScanErrorResponse {
  success: false;
  error: {
    message: string;
    code?: string;
    details?: unknown;
  };
  id?: string;
}

// Base interface with common properties
interface BaseAgentRequest {
  id?: string;
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
  report: string;
  communityNote: CommunityNote;
  isControversial: boolean;
  isVideo: boolean;
  isAccessBlocked: boolean;
}

export interface CommunityNote {
  en: string;
  cn: string;
  links: string[];
}

// Error response for agent
export interface AgentErrorResponse extends ServiceResponse {
  error: {
    message: string;
    code?: string;
    details?: unknown;
  };
}

// Union type for all possible agent responses
export type AgentResult = AgentResponse | AgentErrorResponse;

// Union types for service results to include error responses
export type EmbedResult = EmbedResponse | EmbedErrorResponse;
export type ScreenshotResult = ScreenshotResponse | ScreenshotErrorResponse;
export type SearchResult = SearchResponse | SearchErrorResponse;
export type URLScanResult = URLScanResponse | URLScanErrorResponse;
