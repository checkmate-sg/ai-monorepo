import type { ObjectId } from "mongodb";
import type { CommunityNote, Report } from "@workspace/shared-types";
// Error types for the agent
export type ErrorType =
  | "error"
  | "error-preprocessing"
  | "error-agentLoop"
  | "error-summarization"
  | "error-translation"
  | "error-other";

// Check document interface
export interface Check {
  _id: ObjectId;
  text: string | null;
  timestamp: Date;
  isExpired: boolean;
  imageUrl: string | null;
  caption: string | null;
  embeddings: {
    text: number[] | null;
  };
  textHash: string;
  type: "text" | "image";
  generationStatus: "pending" | ErrorType | "completed" | "unusable";
  isControversial: boolean;
  isAccessBlocked: boolean;
  isVideo: boolean;
  longformResponse: Report;
  shortformResponse: CommunityNote;
  machineCategory: string | null;
  crowdsourcedCategory: string | null;
  pollId: string | null;
}

// Submission document interface
export interface Submission {
  _id: ObjectId;
  requestId: string | null;
  timestamp: Date;
  sourceType: "internal" | "api";
  consumerName: string;
  type: "text" | "image";
  text: string | null;
  imageUrl: string | null;
  caption: string | null;
  checkId: ObjectId | null;
  checkStatus: "pending" | "completed" | "error";
}

//URLs document interface
export interface URLs {
  _id: ObjectId;
  url: string;
  checkId: ObjectId;
}

//PhoneNumbers document interface
export interface PhoneNumbers {
  _id: ObjectId;
  phoneNumber: string;
  checkId: ObjectId;
}
