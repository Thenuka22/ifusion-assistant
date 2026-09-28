import { z } from "zod";

/**
 * A fare setup the assistant has prepared for review.
 *
 * The assistant never writes. It returns this proposal, the host opens its own review screen, and
 * the reviewed setup is saved one route at a time through the ticketing API under the user's own
 * permissions. The full contract lives in the Reporting API's `docs/assistant-fare-setup.md`.
 */

const safeText = z.string().nullish().transform((value) => value ?? "");
const textList = z.array(z.string()).nullish().transform((value) => value ?? []);
const nullableText = z.string().nullish().transform((value) => value ?? null);
const nullableId = z.number().int().positive().nullish().transform((value) => value ?? null);

export const FARE_SETUP_VERSION = 1;

/** A stored price: pounds and optional pence, up to eight digits — the ticketing API's own rule. */
export const FARE_SETUP_PRICE_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;

export const fareSetupIssueSchema = z.object({
  code: safeText,
  message: safeText,
  routeKey: nullableText,
  tableKey: nullableText
});

export type FareSetupIssue = z.infer<typeof fareSetupIssueSchema>;

/** `fs-{id}` for a fare stage that exists, `new-{n}` for one the setup proposes. */
export const fareSetupStageSchema = z.object({
  key: z.string().min(1).max(40),
  id: nullableId,
  number: z.number().int().min(0).max(999),
  name: safeText,
  isNew: z.boolean().nullish().transform((value) => value ?? false)
});

export type FareSetupStage = z.infer<typeof fareSetupStageSchema>;

/** A change to which fare stage one stop belongs to. Only changes are listed. */
export const fareSetupStopAssignmentSchema = z.object({
  stageId: z.number().int().positive(),
  stopName: safeText,
  sequenceNo: z.number().int().nullish().transform((value) => value ?? 0),
  fromFareStageKey: nullableText,
  toFareStageKey: z.string().min(1).max(40)
});

export type FareSetupStopAssignment = z.infer<typeof fareSetupStopAssignmentSchema>;

export const fareSetupPriceSources = ["instruction", "matrix", "formula", "image"] as const;
export type FareSetupPriceSource = (typeof fareSetupPriceSources)[number];

/**
 * One price between two fare stages.
 *
 * A null value is a reading that could not be made out: it always needs review, and the review
 * screen must get a value or a removal before it can be saved.
 */
export const fareSetupPriceSchema = z.object({
  fromKey: z.string().min(1).max(40),
  toKey: z.string().min(1).max(40),
  value: z
    .string()
    .regex(FARE_SETUP_PRICE_PATTERN)
    .nullish()
    .transform((value) => value ?? null),
  previousValue: nullableText,
  source: z.enum(fareSetupPriceSources).catch("instruction"),
  confidence: z.number().min(0).max(1).nullish().transform((value) => value ?? null),
  needsReview: z.boolean().nullish().transform((value) => value ?? false)
});

export type FareSetupPrice = z.infer<typeof fareSetupPriceSchema>;

export const fareSetupTableSchema = z.object({
  key: z.string().min(1).max(60),
  /** Null creates a table. */
  fareMasterId: nullableId,
  fareMasterVersion: nullableText,
  ticketClassId: z.number().int().positive(),
  ticketClassLabel: safeText,
  state: z.enum(["live", "future"]).catch("live"),
  /** yyyy-MM-dd. */
  applyDate: safeText,
  replaceExisting: z.boolean().nullish().transform((value) => value ?? false),
  prices: z.array(fareSetupPriceSchema).nullish().transform((value) => value ?? [])
});

export type FareSetupTable = z.infer<typeof fareSetupTableSchema>;

export const fareSetupRouteSchema = z.object({
  key: z.string().min(1).max(40),
  routeId: z.number().int().positive(),
  routeLabel: safeText,
  /** Base64 route row version when the proposal was prepared. */
  routeVersion: safeText,
  tableShape: z.enum(["Triangle", "Square"]).catch("Triangle"),
  fareStages: z.array(fareSetupStageSchema).nullish().transform((value) => value ?? []),
  stopAssignments: z.array(fareSetupStopAssignmentSchema).nullish().transform((value) => value ?? []),
  tables: z.array(fareSetupTableSchema).nullish().transform((value) => value ?? []),
  warnings: textList,
  unresolved: z.array(fareSetupIssueSchema).nullish().transform((value) => value ?? [])
});

export type FareSetupRoute = z.infer<typeof fareSetupRouteSchema>;

export const fareSetupProposalSchema = z.object({
  version: z.literal(FARE_SETUP_VERSION),
  /** Stable across the draft's revisions. */
  proposalId: z.string().min(1).max(64),
  /** Increments every time the draft changes; the newest revision is the current one. */
  revision: z.number().int().nonnegative(),
  companyId: z.number().int().positive(),
  preparedAt: safeText,
  summary: safeText,
  warnings: textList,
  unresolved: z.array(fareSetupIssueSchema).nullish().transform((value) => value ?? []),
  routes: z.array(fareSetupRouteSchema).nullish().transform((value) => value ?? [])
});

export type FareSetupProposal = z.infer<typeof fareSetupProposalSchema>;

/** Counts for a one-line description of what a route's setup would do. */
export function describeFareSetupRoute(route: FareSetupRoute) {
  const prices = route.tables.reduce((total, table) => total + table.prices.length, 0);
  const needsReview = route.tables.reduce(
    (total, table) => total + table.prices.filter((price) => price.needsReview || price.value === null).length,
    0
  );
  return {
    fareStages: route.fareStages.length,
    newFareStages: route.fareStages.filter((stage) => stage.isNew).length,
    tables: route.tables.length,
    prices,
    needsReview
  };
}
