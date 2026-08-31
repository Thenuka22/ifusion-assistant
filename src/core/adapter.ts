import type { ReactNode } from "react";
import type {
  AssistantAskRequest,
  AssistantAttachment,
  AssistantCapabilities,
  AssistantQueryResponse,
  CommandOutcome
} from "../contracts/assistant-contracts";
import type { AssistantApp, AssistantContext } from "../contracts/section-context";

/**
 * Everything the widget needs from the application hosting it.
 *
 * This is the only seam through which the package talks to the outside world. Each app implements
 * it over its own BFF and its own client, so the widget itself knows nothing about tokens, routes
 * or endpoint names.
 */
export interface AssistantAdapter {
  app: AssistantApp;
  user: { name: string };
  /** Path to the avatar image served by the host app. */
  avatarSrc: string;
  title?: string;
  subtitle?: string;
  placeholder?: string;
  greetingAction?: string;

  getCapabilities(signal?: AbortSignal): Promise<AssistantCapabilities>;
  ask(request: AssistantAskRequest, signal?: AbortSignal): Promise<AssistantQueryResponse>;
  getRun(runId: string, signal?: AbortSignal): Promise<AssistantQueryResponse>;
  cancelRun?(runId: string): Promise<void>;

  /** Present only where the app supports image extraction. */
  uploadAttachment?(
    file: File,
    context: AssistantContext,
    onProgress?: (percent: number) => void
  ): Promise<AssistantAttachment>;

  /**
   * Chat-initiated writes, keyed by the command id the server proposes.
   *
   * Each one calls the app's own ordinary endpoint, so the write is authorised exactly as it would
   * be from the screen's own buttons. The assistant service never performs it.
   */
  commands?: Record<string, (args: unknown) => Promise<CommandOutcome>>;
  /** Fetches a stored proposal payload before a command runs. */
  getProposalPayload?(proposalId: string): Promise<unknown>;
  /** Closes the audit loop once a command has run, or been abandoned. */
  acknowledgeProposal?(proposalId: string, outcome: "executed" | "failed" | "dismissed"): Promise<void>;

  /**
   * Hides affordances the signed-in role could not use.
   *
   * Cosmetic only — the API remains the authority on every write.
   */
  permissions?: {
    canUpdate(zoneId?: number): boolean;
    canDelete(zoneId?: number): boolean;
  };

  onOpenLink?(href: string): void;

  /**
   * Lets the host render a result the package has no opinion about — a report proposal card, the
   * evidence behind a figure. Return nullish to fall through to the built-in rendering.
   */
  renderResult?(
    result: AssistantQueryResponse,
    helpers: { ask(question: string): void }
  ): ReactNode | null | undefined;

  /** Turns a thrown request error into something worth showing a person. */
  describeError?(error: unknown): string | null | undefined;
}
