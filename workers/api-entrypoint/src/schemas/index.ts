import { z } from "zod";
import { Bool, DateTime, Str } from "chanfana";

// Schema for individual API usage statistics
export const ApiCountSchema = z.object({
  totalCalls: z.number({
    description: "Total API calls made for this API",
  }),
  totalCallsThisMonth: z.number({
    description: "Total API calls made this month for this API",
  }),
});

export const ConsumerCountsSchema = z.object({
  name: z.string({
    description: "Consumer name",
  }),
  apiCounts: ApiCountSchema,
});

// Common error response schema
export const ErrorResponseSchema = z.object({
  success: z
    .literal(false)
    .describe("Indicates if the operation was successful"),
  error: Str({ description: "Error message describing what went wrong" }),
});

// Success response wrapper schema
export const SuccessResponseSchema = <T extends z.ZodTypeAny>(
  resultSchema: T
) =>
  z.object({
    success: Bool({ description: "Indicates the operation was successful" }),
    result: resultSchema,
  });

export const CheckResultSchema = z.object({
  report: z.object({
    en: Str(),
    cn: Str().nullable(),
    ms: Str().nullable().optional(),
    id: Str().nullable().optional(),
    ta: Str().nullable().optional(),
    links: z.array(Str()),
    timestamp: DateTime(),
  }),
  communityNote: z.object({
    en: Str(),
    cn: Str(),
    ms: Str().nullable().optional(),
    id: Str().nullable().optional(),
    ta: Str().nullable().optional(),
    links: z.array(Str()),
    downvoted: z.boolean().nullable(),
    timestamp: DateTime(),
  }),
  isControversial: Bool(),
  isVideo: Bool(),
  isAccessBlocked: Bool(),
  title: Str(),
  slug: Str(),
  timestamp: DateTime(),
  isHumanAssessed: Bool(),
  isVoteTriggered: Bool(),
});
