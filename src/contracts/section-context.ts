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
 * list, the ids in play, whether the screen is read-only, and the draft cells a fill merges into.
 */
export const editorContextSnapshotSchema = z.object({
  capabilityId: z.string().min(1).max(64),
  /** Shown in the widget's context chip, e.g. "Route 42 · Adult (live)". */
  label: z.string().max(160),
  readOnly: z.boolean().optional(),
  dirty: z.boolean().optional(),
  revision: z.string().max(128).optional(),
  field: z.string().max(64).optional(),
  data: z.record(z.string(), z.unknown()).optional()
});

export type EditorContextSnapshot = z.infer<typeof editorContextSnapshotSchema>;

export const assistantSubjectSchema = z.object({
  /** What sort of thing it is, e.g. "bods-import-item". */
  kind: z.string().min(1).max(40),
  title: z.string().max(200),
  /** Its state as the screen labels it, e.g. "Waiting for a timetable". */
  state: z.string().max(80).optional(),
  lines: z.array(z.string().max(400)).max(20)
});

export type AssistantSubject = z.infer<typeof assistantSubjectSchema>;

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
  timeZone: z.string().max(64).optional(),
  /** Which part of the screen is showing, e.g. "list" or "matrix". */
  view: z.string().max(64).optional(),
  /** A few display facts about that view, e.g. { "Prices set": "3 of 741" }. Never ids or grids. */
  viewFacts: z.record(z.string().max(40), z.string().max(120)).optional(),
  /**
   * The one thing the user is looking at in that view, such as an import item open for review,
   * with the lines the screen shows about it. Display text to be explained, never instructions.
   */
  subject: assistantSubjectSchema.optional()
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
