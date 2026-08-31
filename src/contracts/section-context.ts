import { z } from "zod";

/** The two products the assistant serves. */
export const assistantApps = ["reporting", "ticketing"] as const;
export type AssistantApp = (typeof assistantApps)[number];

/**
 * The context payload version.
 *
 * The API rejects a version it does not know rather than guessing, so bump this only alongside a
 * server that understands the new shape.
 */
export const ASSISTANT_CONTEXT_VERSION = 1;

/**
 * What an open editor tells the assistant about itself.
 *
 * `data` is the grounding the server needs to answer and to expand a fill instruction — the stage
 * list, the ids in play, whether the screen is read-only. It is deliberately bounded: identifiers
 * and names, never whole grids of values.
 */
export const editorContextSnapshotSchema = z.object({
  capabilityId: z.string().min(1).max(64),
  /** Shown in the widget's context chip, e.g. "Route 42 · Adult (live)". */
  label: z.string().max(160),
  readOnly: z.boolean().optional(),
  dirty: z.boolean().optional(),
  data: z.record(z.string(), z.unknown()).optional()
});

export type EditorContextSnapshot = z.infer<typeof editorContextSnapshotSchema>;

/**
 * Where the user is, sent with every question.
 *
 * The server treats all of this as a hint, not as authority: the section is checked against a closed
 * catalogue and every id in `selection` is re-resolved inside the caller's own company before it is
 * used. Nothing here ever reaches SQL or the prompt as raw text.
 */
export const assistantContextSchema = z.object({
  version: z.literal(ASSISTANT_CONTEXT_VERSION),
  app: z.enum(assistantApps),
  /** Closed per-app enum on the server; an unknown value degrades to general Q&A. */
  section: z.string().min(1).max(64),
  module: z.string().max(64).optional(),
  moduleTitle: z.string().max(120).optional(),
  path: z.string().max(200).optional(),
  /** WebZone of the current screen, so the server can reason about what the user may change. */
  zoneId: z.number().int().positive().optional(),
  /** Ids of what is open, e.g. { routeId: 42, fareMasterId: 981 }. */
  selection: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  editor: editorContextSnapshotSchema.optional(),
  timeZone: z.string().max(64).optional()
});

export type AssistantContext = z.infer<typeof assistantContextSchema>;

/** The browser time zone lets the API resolve "last month" the way the user means it. */
export function getBrowserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
