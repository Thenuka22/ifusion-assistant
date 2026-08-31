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

export const uiActionKinds = ["fare-triangle/apply-cells", "route-stages/apply-rows"] as const;
export type UiActionKind = (typeof uiActionKinds)[number];

/** Where a filled value came from, which decides how prominently the UI asks for a review. */
export const uiActionSources = ["instruction", "image"] as const;
export type UiActionSource = (typeof uiActionSources)[number];

/** A price as the fare grid stores it: digits with up to two decimals, no symbol, no sign. */
export const FARE_VALUE_PATTERN = /^\d+(\.\d{1,2})?$/;

export const MAX_UI_ACTION_CELLS = 500;

export const fareTriangleCellSchema = z.object({
  fromStageId: z.number().int().positive(),
  toStageId: z.number().int().positive(),
  fareValue: z.string().regex(FARE_VALUE_PATTERN),
  /** Present for image extraction. Below ~0.8 the UI flags the cell for a closer look. */
  confidence: z.number().min(0).max(1).optional()
});

export type FareTriangleCell = z.infer<typeof fareTriangleCellSchema>;

export const fareTriangleApplyCellsSchema = z.object({
  kind: z.literal("fare-triangle/apply-cells"),
  version: z.literal(1),
  target: z.object({
    routeId: z.number().int().positive(),
    fareMasterId: z.number().int().positive()
  }),
  /** Merge only. The action cannot clear a cell it did not name. */
  mode: z.literal("merge"),
  cells: z.array(fareTriangleCellSchema).min(1).max(MAX_UI_ACTION_CELLS),
  source: z.enum(uiActionSources).catch("instruction"),
  warnings: z.array(z.string()).nullish().transform((value) => value ?? [])
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

export const uiActionBodySchema = z.discriminatedUnion("kind", [
  fareTriangleApplyCellsSchema,
  routeStagesApplyRowsSchema
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
