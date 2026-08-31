"use client";

import { useState } from "react";
import {
  ArrowRight,
  Check,
  CircleHelp,
  Loader2,
  ShieldCheck,
  TriangleAlert,
  Undo2,
  Wand2
} from "lucide-react";
import type { AssistantQueryResponse } from "../contracts/assistant-contracts";
import type { ApplyState, CommandState } from "../core/assistant-provider";
import { getRefusalMessage } from "../core/guardrails";
import { Markdown } from "./markdown";

type Ask = (question: string) => void;

export function SuggestionChips({
  suggestions,
  onPick,
  label
}: {
  suggestions: string[];
  onPick: Ask;
  label?: string;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="assistant-chips" aria-label={label}>
      {suggestions.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          onClick={() => onPick(suggestion)}
          className="assistant-chip"
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}

export function InsightCard({
  answer,
  highlights,
  followUps,
  onFollowUp,
  onOpenLink
}: {
  answer: string;
  highlights: string[];
  followUps: string[];
  onFollowUp: Ask;
  onOpenLink?: (href: string) => void;
}) {
  return (
    <div className="assistant-stack">
      <Markdown onOpenLink={onOpenLink}>{answer}</Markdown>
      {highlights.length > 0 && (
        <ul className="assistant-highlights">
          {highlights.map((highlight) => (
            <li key={highlight}>{highlight}</li>
          ))}
        </ul>
      )}
      <SuggestionChips suggestions={followUps} onPick={onFollowUp} label="Follow-up questions" />
    </div>
  );
}

export function ClarificationCard({
  question,
  suggestions,
  onPick
}: {
  question: string;
  suggestions: string[];
  onPick: Ask;
}) {
  return (
    <div className="assistant-stack">
      <p className="assistant-line">
        <CircleHelp aria-hidden="true" size={16} className="assistant-line__icon" />
        <span>{question}</span>
      </p>
      <SuggestionChips suggestions={suggestions} onPick={onPick} />
    </div>
  );
}

export function RefusalCard({
  reason,
  question,
  canEdit,
  suggestions,
  onPick
}: {
  reason: string;
  question: string;
  canEdit: boolean;
  suggestions: string[];
  onPick: Ask;
}) {
  return (
    <div className="assistant-stack">
      <p className="assistant-line">
        <ShieldCheck aria-hidden="true" size={16} className="assistant-line__icon" />
        <span>{getRefusalMessage(reason, question, { canEdit })}</span>
      </p>
      {reason === "out_of_scope" && (
        <SuggestionChips suggestions={suggestions} onPick={onPick} label="Things I can help with" />
      )}
    </div>
  );
}

export function ThinkingLine({ text = "Looking that up…" }: { text?: string }) {
  return (
    <p aria-live="polite" className="assistant-thinking">
      <span aria-hidden="true" className="assistant-thinking__dot" />
      {text}
    </p>
  );
}

/**
 * The outcome of a change the assistant made to the open editor.
 *
 * The change is already in the grid — this card says what happened and offers to take it back. It
 * deliberately does not offer to save: that is the editor's own button, and the user's decision.
 */
export function UiActionCard({
  answer,
  state,
  warnings,
  onUndo,
  onApply,
  onOpenLink
}: {
  answer: string;
  state: ApplyState | undefined;
  warnings: string[];
  onUndo: () => void;
  onApply: () => void;
  onOpenLink?: (href: string) => void;
}) {
  return (
    <div className="assistant-stack">
      {answer && <Markdown onOpenLink={onOpenLink}>{answer}</Markdown>}

      {warnings.length > 0 && (
        <ul className="assistant-warnings">
          {warnings.map((warning) => (
            <li key={warning}>
              <TriangleAlert aria-hidden="true" size={13} />
              {warning}
            </li>
          ))}
        </ul>
      )}

      {state?.status === "applied" && (
        <div className="assistant-applied">
          <p className="assistant-applied__line">
            <Check aria-hidden="true" size={14} />
            <span>
              Filled {state.appliedCount} {state.appliedCount === 1 ? "value" : "values"} in the
              editor. Review the highlighted cells, then press Save.
            </span>
          </p>
          {state.skipped.length > 0 && (
            <details className="assistant-skipped">
              <summary>
                {state.skipped.length} skipped — see why
              </summary>
              <ul>
                {state.skipped.map((entry) => (
                  <li key={`${entry.ref}-${entry.reason}`}>
                    <span className="assistant-skipped__ref">{entry.ref}</span> {entry.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {state.canUndo ? (
            <button type="button" onClick={onUndo} className="assistant-text-action">
              <Undo2 aria-hidden="true" size={14} />
              Undo this fill
            </button>
          ) : (
            <p className="assistant-muted">Undo is no longer available.</p>
          )}
        </div>
      )}

      {state?.status === "undone" && (
        <p className="assistant-muted">
          <Undo2 aria-hidden="true" size={13} /> Undone — the editor is back to how it was.
        </p>
      )}

      {state?.status === "unavailable" && (
        <div className="assistant-applied assistant-applied--pending">
          <p className="assistant-applied__line">
            <TriangleAlert aria-hidden="true" size={14} />
            <span>{state.reason}</span>
          </p>
          <button type="button" onClick={onApply} className="assistant-text-action">
            <Wand2 aria-hidden="true" size={14} />
            Try again here
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * A change the assistant is asking permission to make for real.
 *
 * Confirming runs the app's ordinary endpoint under the signed-in user's own permissions, so this
 * card is a request, never the change itself.
 */
export function CommandProposalCard({
  summary,
  detail,
  targetLabel,
  warnings,
  destructive,
  confirmPhrase,
  state,
  allowed,
  onConfirm,
  onDismiss,
  onOpenLink
}: {
  summary: string;
  detail: string;
  targetLabel: string;
  warnings: string[];
  destructive: boolean;
  confirmPhrase?: string;
  state: CommandState | undefined;
  allowed: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
  onOpenLink?: (href: string) => void;
}) {
  const [typed, setTyped] = useState("");
  const settled = state?.status === "done" || state?.status === "failed" || state?.status === "dismissed";

  // Something irreversible asks to be spelled out, so it cannot happen on a mis-click.
  const phraseRequired = destructive && Boolean(confirmPhrase);
  const phraseMatches =
    !phraseRequired || typed.trim().toLocaleLowerCase() === (confirmPhrase ?? "").trim().toLocaleLowerCase();

  return (
    <div className="assistant-proposal">
      <Markdown onOpenLink={onOpenLink} className="assistant-proposal__summary">
        {summary}
      </Markdown>
      {targetLabel && <p className="assistant-proposal__target">{targetLabel}</p>}
      {detail && <p className="assistant-muted">{detail}</p>}

      {warnings.length > 0 && (
        <ul className="assistant-warnings">
          {warnings.map((warning) => (
            <li key={warning}>
              <TriangleAlert aria-hidden="true" size={13} />
              {warning}
            </li>
          ))}
        </ul>
      )}

      {state?.status === "done" && (
        <p className="assistant-applied__line">
          <Check aria-hidden="true" size={14} /> {state.message}
        </p>
      )}
      {state?.status === "failed" && (
        <p className="assistant-line assistant-line--danger">
          <TriangleAlert aria-hidden="true" size={14} className="assistant-line__icon" />
          <span>{state.message}</span>
        </p>
      )}
      {state?.status === "dismissed" && <p className="assistant-muted">Cancelled — nothing was changed.</p>}

      {!settled && phraseRequired && allowed && (
        <label className="assistant-confirm-phrase">
          <span>
            Type <strong>{confirmPhrase}</strong> to confirm
          </span>
          <input
            type="text"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            className="assistant-input"
          />
        </label>
      )}

      {!settled && (
        <div className="assistant-proposal__actions">
          {allowed ? (
            <button
              type="button"
              onClick={onConfirm}
              disabled={state?.status === "confirming" || !phraseMatches}
              className={
                destructive
                  ? "assistant-button assistant-button--danger"
                  : "assistant-button assistant-button--primary"
              }
            >
              {state?.status === "confirming" ? (
                <>
                  <Loader2 aria-hidden="true" size={14} className="assistant-spin" />
                  Working…
                </>
              ) : (
                <>
                  <Check aria-hidden="true" size={14} />
                  Confirm
                </>
              )}
            </button>
          ) : (
            <p className="assistant-muted">Your role can’t make this change.</p>
          )}
          <button
            type="button"
            onClick={onDismiss}
            disabled={state?.status === "confirming"}
            className="assistant-button"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export function QueuedCard({ onCancel }: { onCancel?: () => void }) {
  return (
    <div className="assistant-stack">
      <ThinkingLine text="Still working on that — it’s taking a little longer than usual." />
      {onCancel && (
        <button type="button" onClick={onCancel} className="assistant-text-action">
          Stop waiting
        </button>
      )}
    </div>
  );
}

export function FriendlyFailure({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="assistant-stack">
      <p className="assistant-body">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="assistant-text-action">
          Try again
          <ArrowRight aria-hidden="true" size={14} />
        </button>
      )}
    </div>
  );
}

/** Picks the right card for a finished answer, honouring any renderer the host app supplies. */
export function isHandledResultType(result: AssistantQueryResponse) {
  return result.resultType !== "queued";
}
