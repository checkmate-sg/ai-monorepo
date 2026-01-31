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
    base64?: string;
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
  model?: string;
  consumerName?: string;
  findSimilar?: boolean;
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
  imageBase64?: string;
}

// Union type to enforce either text OR image+optional caption
export type AgentRequest = TextAgentRequest | ImageAgentRequest;

export interface AgentResponse extends ServiceResponse {
  success: true;
  result: {
    report: Report;
    generationStatus: string;
    communityNote: CommunityNote;
    humanNote: HumanNote | null;
    isControversial: boolean;
    text: string | null;
    imageUrl: string | null;
    caption: string | null;
    isVideo: boolean;
    isAccessBlocked: boolean;
    title: string | null;
    slug: string | null;
    timestamp: Date;
    isHumanAssessed: boolean;
    isVoteTriggered: boolean;
    crowdsourcedCategory: string | null;
  };
}

export interface CheckUpdate {
  id: string;
  isHumanAssessed: boolean;
  crowdsourcedCategory: string | null;
  isCommunityNoteDownvoted: boolean | null;
}

interface LanguageResponses {
  en: string | null;
  cn: string | null;
  id?: string | null;
  ta?: string | null;
  ms?: string | null;
  links: string[] | null;
}

// Import types from models
export type ErrorType =
  | "error"
  | "error-preprocessing"
  | "error-agentLoop"
  | "error-summarization"
  | "error-translation"
  | "error-other";
export interface Check {
  _id: string;
  text: string | null;
  title: string;
  slug: string;
  timestamp: Date;
  isExpired: boolean;
  imageUrl: string | null;
  caption: string | null;
  embeddings: {
    text: number[] | null;
    caption: number[] | null;
    pdq: number[] | null;
  };
  textHash: string;
  captionHash: string;
  imageHash: string;
  type: "text" | "image";
  generationStatus: "pending" | ErrorType | "completed" | "unusable";
  isControversial: boolean;
  isAccessBlocked: boolean;
  isVideo: boolean;
  longformResponse: Report;
  shortformResponse: CommunityNote;
  humanResponse: HumanNote | null;
  machineCategory: string | null;
  crowdsourcedCategory: string | null;
  pollId: string | null;
  isHumanAssessed: boolean;
  isVoteTriggered: boolean;
  isApprovedForPublishing: boolean;
  approvedBy: number | null;
  notificationId: number | null;
  communityNoteNotificationId: number | null;
}

export interface Submission {
  _id: string;
  requestId: string | null;
  timestamp: Date;
  sourceType: "internal" | "api";
  consumerName: string;
  type: "text" | "image";
  text: string | null;
  imageUrl: string | null;
  caption: string | null;
  checkId: string | null;
  checkStatus: "pending" | "completed" | "error";
}

interface DatabaseServiceEnvironment {
  MONGODB_URI: string;
}

export interface CommunityNote extends LanguageResponses {
  downvoted?: boolean | null;
  timestamp: Date;
}

export interface Report extends LanguageResponses {
  timestamp: Date;
}

export interface HumanNote extends LanguageResponses {
  timestamp: Date;
  updatedBy: string;
}

// Union type for all possible agent responses
export type AgentResult = AgentResponse | ErrorResponse;

// Union types for service results to include error responses
export type EmbedResult = EmbedResponse | ErrorResponse;
export type ScreenshotResult = ScreenshotResponse | ErrorResponse;
export type SearchResult = SearchResponse | ErrorResponse;
export type URLScanResult = URLScanResponse | ErrorResponse;
export type TrivialFilterResult = TrivialFilterResponse | ErrorResponse;
