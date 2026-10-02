import { z } from "zod";
import { assistantContextSchema } from "./section-context";
import { fareSetupProposalSchema } from "./fare-setup";
import { uiActionSchema } from "./ui-actions";

/** Nullish text and lists arrive from a strict-JSON model as empty rather than missing. */
const safeText = z.string().nullish().transform((value) => value ?? "");
const textList = z.array(z.string()).nullish().transform((value) => value ?? []);

/**
 * The longest message the widget sends. Large enough for a pasted fare table; the server applies the
 * same limit and says so explicitly rather than truncating.
 */
export const ASSISTANT_MAX_QUESTION_LENGTH = 4000;

/** Result types a client can opt into. The server sends one only to a client that lists it. */
export const assistantOptionalResultTypes = ["fareSetup", "guidance"] as const;
export type AssistantOptionalResultType = (typeof assistantOptionalResultTypes)[number];

export const assistantQuestionSchema = z
  .string()
  .trim()
  .min(2, "Ask a question about your data.")
  .max(ASSISTANT_MAX_QUESTION_LENGTH, "Please shorten the question.");

export const assistantAskRequestSchema = z.object({
  question: assistantQuestionSchema,
  /** Ties a question to the running conversation. The server owns the history. */
  sessionId: z.string().max(64).optional(),
  /** Set when the question follows an uploaded image. */
  attachmentId: z.string().max(64).optional(),
  context: assistantContextSchema,
  timeZone: z.string().max(64).optional(),
  /**
   * Optional result types this client can render. Absent, the server keeps to the original set, so
   * an older widget never receives something it cannot parse.
   */
  accepts: z.array(z.string().max(32)).max(8).optional(),
  /** What a widget button asked for, e.g. "explainScreen"; absent for a typed question. */
  intent: z.string().max(32).optional()
});

export type AssistantAskRequest = z.infer<typeof assistantAskRequestSchema>;

/* ---------------------------------------------------------------- capabilities */

export const assistantMetricSchema = z.object({
  key: safeText,
  label: safeText,
  unit: z.enum(["currency", "count"]).catch("count")
});

export const assistantReportCapabilitySchema = z.object({
  slug: safeText,
  title: safeText,
  description: safeText,
  filters: textList,
  metrics: z.array(assistantMetricSchema).nullish().transform((value) => value ?? []),
  groupings: textList
});

/**
 * What one screen may do.
 *
 * The server is the authority on this: the upload button and the fill commands appear only where
 * this map says they are available, so a screen cannot offer something the API would refuse.
 */
export const assistantSectionCapabilitySchema = z.object({
  section: safeText,
  title: safeText,
  suggestions: textList,
  /** Whether the assistant may propose changes to this screen's editor. */
  uiActions: z.boolean().nullish().transform((value) => value ?? false),
  /** Whether this screen accepts image uploads for extraction. */
  attachments: z.boolean().nullish().transform((value) => value ?? false)
});

/** Whether the service can prepare fare setups, and how large one may be. */
export const assistantFareSetupCapabilitySchema = z.object({
  enabled: z.boolean().nullish().transform((value) => value ?? false),
  version: z.number().int().nonnegative().nullish().transform((value) => value ?? 0),
  maxRoutes: z.number().int().nonnegative().nullish().transform((value) => value ?? 0),
  maxFareStages: z.number().int().nonnegative().nullish().transform((value) => value ?? 0)
});

export type AssistantFareSetupCapability = z.infer<typeof assistantFareSetupCapabilitySchema>;

export const assistantCapabilitiesSchema = z.object({
  enabled: z.boolean(),
  provider: safeText,
  model: safeText,
  supportsImages: z.boolean().optional().default(true),
  guidanceAvailable: z.boolean().optional().default(false),
  maxQuestionLength: z.number().int().positive().nullish().transform((value) => value ?? ASSISTANT_MAX_QUESTION_LENGTH),
  maxRangeDays: z.number().int().positive().nullish().transform((value) => value ?? 31),
  maxGroupRows: z.number().int().positive().nullish().transform((value) => value ?? 10),
  maxAnalysisSteps: z.number().int().positive().nullish().transform((value) => value ?? 2),
  maxUploadBytes: z.number().int().positive().nullish().transform((value) => value ?? 8 * 1024 * 1024),
  reports: z.array(assistantReportCapabilitySchema).nullish().transform((value) => value ?? []),
  sections: z.array(assistantSectionCapabilitySchema).nullish().transform((value) => value ?? []),
  examples: textList,
  fareSetup: assistantFareSetupCapabilitySchema
    .nullish()
    .transform((value) => value ?? { enabled: false, version: 0, maxRoutes: 0, maxFareStages: 0 })
});

export type AssistantCapabilities = z.infer<typeof assistantCapabilitiesSchema>;
export type AssistantSectionCapability = z.infer<typeof assistantSectionCapabilitySchema>;

/* ------------------------------------------------------------------- results */

export const assistantAppliedFilterSchema = z.object({
  key: safeText,
  labels: textList
});

export const assistantAggregateGroupSchema = z.object({
  key: safeText,
  total: z.number(),
  average: z.number(),
  minimum: z.number(),
  maximum: z.number(),
  recordCount: z.number().int().nonnegative()
});

/** A figure the assistant quoted, with the query that produced it. */
export const assistantEvidenceSchema = z.object({
  reportType: safeText,
  reportTitle: safeText,
  metric: safeText,
  metricLabel: safeText,
  unit: z.enum(["currency", "count"]).catch("count"),
  groupBy: safeText,
  startDate: safeText,
  endDate: safeText,
  total: z.number(),
  average: z.number(),
  minimum: z.number(),
  maximum: z.number(),
  recordCount: z.number().int().nonnegative(),
  groups: z.array(assistantAggregateGroupSchema).nullish().transform((value) => value ?? []),
  appliedFilters: z.array(assistantAppliedFilterSchema).nullish().transform((value) => value ?? [])
});

export const assistantInsightSchema = z.object({
  /** GitHub-flavoured markdown, rendered through a tag allowlist. */
  answer: safeText,
  highlights: textList,
  followUps: textList,
  evidence: z.array(assistantEvidenceSchema).nullish().transform((value) => value ?? []),
  guidance: z.object({
    topic: safeText, title: safeText, version: safeText, explanation: safeText, why: safeText, nextAction: safeText,
    steps: textList, commonMistakes: textList, screens: textList,
    references: z.array(z.object({ title: safeText, url: z.string().url(), section: safeText })).optional().default([])
  }).nullish()
});

export const assistantReportProposalSchema = z.object({
  proposalId: z.string().min(1),
  reportType: safeText,
  reportTitle: safeText,
  startDate: safeText,
  endDate: safeText,
  filters: z.array(assistantAppliedFilterSchema).nullish().transform((value) => value ?? []),
  summary: safeText,
  expiresAt: safeText,
  requiresConfirmation: z.boolean().nullish().transform((value) => value ?? true)
});

/**
 * A write the assistant is asking permission to make.
 *
 * The payload stays on the server; on confirmation the app fetches it and calls its own normal
 * endpoint, so the user's own permissions decide whether the write is allowed.
 */
export const assistantCommandProposalSchema = z.object({
  proposalId: z.string().min(1),
  commandId: z.string().min(1).max(64),
  summary: safeText,
  detail: safeText,
  targetLabel: safeText,
  warnings: textList,
  zoneId: z.number().int().positive().nullish().transform((value) => value ?? undefined),
  /** True for deletes and anything else that should make the user type the target's name. */
  destructive: z.boolean().nullish().transform((value) => value ?? false),
  /** What a destructive change asks the user to type before Confirm becomes available. */
  confirmPhrase: safeText,
  expiresAt: safeText,
  requiresConfirmation: z.boolean().nullish().transform((value) => value ?? true)
});

export const assistantClarificationSchema = z.object({
  question: safeText,
  suggestions: textList
});

export const assistantQueuedSchema = z.object({
  statusUrl: safeText,
  retryAfterSeconds: z.number().int().nonnegative().nullish().transform((value) => value ?? 2)
});

export const assistantRefusalSchema = z.object({
  reason: safeText,
  detail: safeText,
  /** Set when the provider asked us to wait, e.g. a quota; the widget holds the send button until then. */
  retryAfterSeconds: z.number().int().nonnegative().nullish().transform((value) => value ?? undefined)
});

export const assistantResultTypes = [
  "insight",
  "reportProposal",
  "clarification",
  "queued",
  "refusal",
  "uiAction",
  "commandProposal",
  "fareSetup"
] as const;

export type AssistantResultType = (typeof assistantResultTypes)[number];

export const assistantQueryResponseSchema = z.object({
  runId: z.string().min(1),
  resultType: z.enum(assistantResultTypes),
  status: safeText,
  /** Echoed so the next question continues the same conversation. */
  sessionId: z.string().nullish().transform((value) => value ?? ""),
  /** Conversational text that accompanies a uiAction or a proposal. */
  answer: safeText,
  insight: assistantInsightSchema.nullish(),
  reportProposal: assistantReportProposalSchema.nullish(),
  commandProposal: assistantCommandProposalSchema.nullish(),
  uiAction: uiActionSchema.nullish(),
  clarification: assistantClarificationSchema.nullish(),
  queued: assistantQueuedSchema.nullish(),
  refusal: assistantRefusalSchema.nullish(),
  /** A prepared fare setup for the host's review screen. Sent only to a client that accepts it. */
  fareSetup: fareSetupProposalSchema.nullish(),
  followUps: textList
});

export type AssistantQueryResponse = z.infer<typeof assistantQueryResponseSchema>;
export type AssistantInsight = z.infer<typeof assistantInsightSchema>;
export type AssistantEvidence = z.infer<typeof assistantEvidenceSchema>;
export type AssistantAggregateGroup = z.infer<typeof assistantAggregateGroupSchema>;
export type AssistantAppliedFilter = z.infer<typeof assistantAppliedFilterSchema>;
export type AssistantReportProposal = z.infer<typeof assistantReportProposalSchema>;
export type AssistantCommandProposal = z.infer<typeof assistantCommandProposalSchema>;
export type AssistantClarification = z.infer<typeof assistantClarificationSchema>;
export type AssistantRefusal = z.infer<typeof assistantRefusalSchema>;

/* --------------------------------------------------------------- attachments */

export const assistantAttachmentSchema = z.object({
  attachmentId: z.string().min(1),
  expiresAt: safeText
});

export type AssistantAttachment = z.infer<typeof assistantAttachmentSchema>;

/** How a confirmed command turned out, as the chat card should report it. */
export type CommandOutcome = {
  ok: boolean;
  message: string;
};

export function isGuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
