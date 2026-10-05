import { z } from "zod";

/**
 * Changes the assistant may make to an open editor.
 *
 * A UI action never reaches an API. It is merged into the editor's own draft state and leaves the
 * screen dirty, so the change is committed by the person pressing the editor's existing Save button
 * — the same button, the same endpoint, the same validation as a change typed by hand.
 *
 * Every payload here is produced by the server's expander and validator, never by the model
 * directly: the model names an intent and the server turns it into cells.
 */

export const uiActionKinds = ["fare-triangle/apply-cells", "route-stages/apply-rows", "route-stages/apply-fare-groups", "flat-fares/prepare", "assistant/undo-last"] as const;
export type UiActionKind = (typeof uiActionKinds)[number];

/** Where a filled value came from, which decides how prominently the UI asks for a review. */
export const uiActionSources = ["instruction", "image"] as const;
export type UiActionSource = (typeof uiActionSources)[number];

/** A price as the fare grid stores it: up to eight digits and two decimals, no symbol, no sign. */
export const FARE_VALUE_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;

export const MAX_UI_ACTION_CELLS = 14400;

/**
 * One fare cell, addressed by fare stage (`core.Fares.FromFareStageId`/`ToFareStageId`).
 *
 * The canonical names are `fromFareStageId`/`toFareStageId`. Servers before 0.5 sent
 * `fromStageId`/`toStageId`; either spelling is accepted, and both are present on the parsed value
 * so an editor written against the old names keeps working.
 */
export const fareTriangleCellSchema = z
  .preprocess(
    (raw) => {
      if (!raw || typeof raw !== "object") return raw;
      const cell = raw as Record<string, unknown>;
      return {
        ...cell,
        fromFareStageId: cell.fromFareStageId ?? cell.fromStageId,
        toFareStageId: cell.toFareStageId ?? cell.toStageId
      };
    },
    z.object({
      fromFareStageId: z.number().int().positive(),
      toFareStageId: z.number().int().positive(),
      /** A price, or "" to clear the cell back to not sold. */
      fareValue: z.union([z.string().regex(FARE_VALUE_PATTERN), z.literal("")]),
      /** Present for image extraction. Below ~0.8 the UI flags the cell for a closer look. */
      confidence: z.number().min(0).max(1).nullish().transform((value) => value ?? undefined)
    })
  )
  .transform((cell) => ({
    ...cell,
    /** @deprecated Use `fromFareStageId`. Kept so older editors still read the cell. */
    fromStageId: cell.fromFareStageId,
    /** @deprecated Use `toFareStageId`. */
    toStageId: cell.toFareStageId
  }));

export type FareTriangleCell = z.infer<typeof fareTriangleCellSchema>;

export const fareTriangleApplyCellsSchema = z.object({
  kind: z.literal("fare-triangle/apply-cells"),
  version: z.literal(1),
  target: z.object({
    routeId: z.number().int().positive(),
    fareMasterId: z.number().int().positive()
  }),
  /** Merge only. The action cannot clear a cell it did not name. */
  editorRevision: z.string().max(128).nullish(),
  mode: z.literal("merge"),
  cells: z.array(fareTriangleCellSchema).min(1).max(MAX_UI_ACTION_CELLS),
  source: z.enum(uiActionSources).catch("instruction"),
  warnings: z.array(z.string()).nullish().transform((value) => value ?? []),
  /**
   * Set when the fill rewrites a lot of what is already priced: the card waits for the user to
   * press Apply instead of changing the grid straight away.
   */
  requiresConfirmation: z.boolean().nullish().transform((value) => value ?? false)
});

export type FareTriangleApplyCells = z.infer<typeof fareTriangleApplyCellsSchema>;

/**
 * The stage columns an editor may set.
 *
 * `routeRef`, `routeSectionRef` and `bodsSequenceNo` are absent on purpose. They are written by the
 * BODS import and have to round-trip untouched; a form that once blanked them broke journey imports.
 * Leaving them out of the type is what stops the assistant from ever sending them.
 */
export const stageEditableFieldsSchema = z.object({
  stageNo: z.number().int().positive().optional(),
  sequenceNo: z.number().int().positive().optional(),
  name: z.string().max(200).optional(),
  naptanCode: z.string().max(50).optional(),
  atcoCode: z.string().max(50).optional(),
  latitude: z.string().max(32).optional(),
  longitude: z.string().max(32).optional(),
  inboundNaptanCode: z.string().max(50).optional(),
  inboundAtcoCode: z.string().max(50).optional(),
  inboundLatitude: z.string().max(32).optional(),
  inboundLongitude: z.string().max(32).optional(),
  type: z.number().int().nonnegative().optional(),
  qualifier: z.number().int().nonnegative().optional(),
  zone: z.string().max(50).optional(),
  stageActivityId: z.number().int().positive().nullish(),
  stageTimingStatusId: z.number().int().positive().nullish(),
  isHailAndRide: z.boolean().optional()
});

export type StageEditableFields = z.infer<typeof stageEditableFieldsSchema>;

/**
 * Stage edits, expressed only as patches and additions.
 *
 * Saving stages replaces the whole collection, so a row left out of the payload is deleted. There is
 * deliberately no way to express a replacement list or a removal here: the assistant can change a
 * row or add one, and nothing it sends can drop a row the user still has.
 */
export const routeStagesApplyRowsSchema = z.object({
  kind: z.literal("route-stages/apply-rows"),
  editorRevision: z.string().max(128).nullish(),
  version: z.literal(1),
  target: z.object({ routeId: z.number().int().positive() }),
  mode: z.literal("merge"),
  updates: z
    .array(
      z.object({
        id: z.number().int().positive(),
        fields: stageEditableFieldsSchema
      })
    )
    .max(MAX_UI_ACTION_CELLS)
    .nullish()
    .transform((value) => value ?? []),
  appends: z
    .array(stageEditableFieldsSchema)
    .max(200)
    .nullish()
    .transform((value) => value ?? []),
  source: z.enum(uiActionSources).catch("instruction"),
  warnings: z.array(z.string()).nullish().transform((value) => value ?? [])
});

export type RouteStagesApplyRows = z.infer<typeof routeStagesApplyRowsSchema>;

/**
 * Stops put into fare groups, and any groups that have to be made for them.
 *
 * Stops and existing groups are named by the editor's own draft keys, which it sent with the
 * question, so unsaved ones can be addressed. A new group carries a key of the server's own
 * (`ai-new-1`…) that the editor swaps for a draft of its own. Nothing here removes a group or a stop.
 */
export const routeStagesApplyFareGroupsSchema = z.object({
  kind: z.literal("route-stages/apply-fare-groups"),
  editorRevision: z.string().max(128).nullish(),
  version: z.literal(1),
  target: z.object({ routeId: z.number().int().positive() }),
  mode: z.literal("merge"),
  groups: z
    .array(
      z.object({
        key: z.string().min(1).max(64),
        name: z.string().min(1).max(100),
        number: z.number().int().min(0).max(999).nullish(),
        isNew: z.boolean()
      })
    )
    .max(200),
  assignments: z
    .array(z.object({ stopKey: z.string().min(1).max(64), groupKey: z.string().min(1).max(64) }))
    .min(1)
    .max(2000),
  source: z.enum(uiActionSources).catch("instruction"),
  warnings: z.array(z.string()).nullish().transform((value) => value ?? [])
});

export type RouteStagesApplyFareGroups = z.infer<typeof routeStagesApplyFareGroupsSchema>;

/**
 * A flat fare — one price for any journey — filled into the fare editor's Flat fares form. The
 * form is only filled in: the person checks it and saves it, and the API re-checks on save.
 */
export const flatFarePrepareSchema = z.object({
  kind: z.literal("flat-fares/prepare"),
  editorRevision: z.string().max(128).nullish(),
  version: z.literal(1),
  target: z.object({ routeId: z.number().int().positive() }),
  mode: z.literal("merge"),
  flatFare: z.object({
    ticketClassId: z.number().int().positive(),
    ticketClass: z.string().max(200).nullish(),
    amount: z.string().regex(FARE_VALUE_PATTERN),
    validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    routeIds: z.array(z.number().int().positive()).min(1).max(200)
  }),
  source: z.enum(uiActionSources).catch("instruction"),
  warnings: z.array(z.string()).nullish().transform((value) => value ?? [])
});

export type FlatFarePrepare = z.infer<typeof flatFarePrepareSchema>;

/**
 * "Undo that": the widget takes back the assistant's latest change through that change's own undo,
 * so each cell or row returns to what it held before. It carries no values to fill.
 */
export const assistantUndoLastSchema = z.object({
  kind: z.literal("assistant/undo-last"),
  editorRevision: z.string().max(128).nullish(),
  version: z.literal(1),
  target: z.object({ routeId: z.number().int().nonnegative() }).partial().nullish(),
  mode: z.literal("merge").catch("merge"),
  source: z.enum(uiActionSources).catch("instruction"),
  warnings: z.array(z.string()).nullish().transform((value) => value ?? []),
  /** How many of the assistant's changes to take back, newest first. */
  undoCount: z.number().int().min(1).max(10).nullish().transform((value) => value ?? 1)
});

export type AssistantUndoLast = z.infer<typeof assistantUndoLastSchema>;

export const uiActionBodySchema = z.discriminatedUnion("kind", [
  fareTriangleApplyCellsSchema,
  routeStagesApplyRowsSchema,
  routeStagesApplyFareGroupsSchema,
  flatFarePrepareSchema,
  assistantUndoLastSchema
]);

export type UiActionBody = z.infer<typeof uiActionBodySchema>;

/** A validated action plus the id the server filed it under, which the audit trail follows. */
export const uiActionSchema = z.intersection(
  z.object({ id: z.string().min(1).max(64) }),
  uiActionBodySchema
);

export type UiAction = z.infer<typeof uiActionSchema>;

/** What an editor reports back after merging an action into its draft state. */
export type ApplyResult = {
  ok: boolean;
  appliedCount: number;
  /** Anything the editor declined, with a reason a person can act on. */
  skipped: { ref: string; reason: string }[];
  /** Restores the pre-apply state. Valid until the editor saves or unmounts. */
  undo?: () => void;
  message?: string;
};

export type ApplyDecision = { ok: true } | { ok: false; reason: string };
