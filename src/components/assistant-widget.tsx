"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Loader2, Paperclip, Send, ShieldCheck, X } from "lucide-react";
import { ASSISTANT_MAX_QUESTION_LENGTH } from "../contracts/assistant-contracts";
import { useAssistant, type ThreadMessage } from "../core/assistant-provider";
import { getFriendlyName, maskSensitiveNumbers } from "../core/guardrails";
import {
  ClarificationCard,
  CommandProposalCard,
  FriendlyFailure,
  InsightCard,
  QueuedCard,
  RefusalCard,
  SuggestionChips,
  ThinkingLine,
  UiActionCard
} from "./result-cards";

const GREETING_KEY = "ifusion-assistant-greeting-seen";

function hasSeenGreeting(userName: string) {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(`${GREETING_KEY}:${userName.trim().toLocaleLowerCase()}`) === "true";
  } catch {
    return false;
  }
}

function rememberGreeting(userName: string) {
  try {
    window.sessionStorage.setItem(`${GREETING_KEY}:${userName.trim().toLocaleLowerCase()}`, "true");
  } catch {
    // A blocked storage API should not stop the welcome from appearing.
  }
}

export function AssistantWidget() {
  const assistant = useAssistant();
  const {
    adapter,
    capabilities,
    sectionCapability,
    activeCapability,
    messages,
    status,
    isOpen,
    setOpen,
    ask,
    reset
  } = assistant;

  const [question, setQuestion] = useState("");
  const [greetingWasSeen] = useState(() => hasSeenGreeting(adapter.user.name));
  const [isGreetingDismissed, setGreetingDismissed] = useState(false);
  const [upload, setUpload] = useState<{ state: "uploading" | "failed"; message: string } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const friendlyName = getFriendlyName(adapter.user.name);
  const enabled = capabilities?.enabled ?? false;

  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, setOpen]);

  useEffect(() => {
    if (!enabled || greetingWasSeen) return;
    rememberGreeting(adapter.user.name);
  }, [adapter.user.name, enabled, greetingWasSeen]);

  useEffect(() => {
    if (!isOpen) return;
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [isOpen, messages.length, status]);

  if (!enabled) return null;

  const maxLength = capabilities?.maxQuestionLength ?? ASSISTANT_MAX_QUESTION_LENGTH;
  const busy = status !== "idle";

  // The upload button exists only where both the server and the open editor allow it, so a screen
  // can never offer something the API would turn away.
  const canUpload =
    Boolean(adapter.uploadAttachment) &&
    Boolean(sectionCapability?.attachments) &&
    Boolean(activeCapability?.attachments) &&
    !activeCapability?.getSnapshot().readOnly;

  const starters = (
    activeCapability?.suggestions?.length
      ? activeCapability.suggestions
      : sectionCapability?.suggestions?.length
        ? sectionCapability.suggestions
        : capabilities?.examples ?? []
  ).slice(0, 4);

  const contextLabel = activeCapability?.getSnapshot().label || assistant.buildContext().moduleTitle || "";

  function submit(next: string) {
    const trimmed = next.trim();
    if (trimmed.length < 2 || busy) return;
    setQuestion("");
    ask(trimmed);
  }

  async function onFileChosen(file: File | undefined) {
    if (!file || !adapter.uploadAttachment) return;
    const limit = activeCapability?.attachments?.maxBytes ?? capabilities?.maxUploadBytes ?? 8 * 1024 * 1024;
    if (file.size > limit) {
      setUpload({ state: "failed", message: `That image is larger than ${Math.round(limit / 1024 / 1024)} MB.` });
      return;
    }

    setUpload({ state: "uploading", message: "Uploading the image…" });
    try {
      const attachment = await adapter.uploadAttachment(file, assistant.buildContext());
      setUpload(null);
      ask("Read this fare table and fill in the grid.", { attachmentId: attachment.attachmentId });
    } catch (error) {
      setUpload({
        state: "failed",
        message: adapter.describeError?.(error) || "I couldn’t read that image. Please try another photo."
      });
    }
  }

  return (
    <>
      {!greetingWasSeen && !isGreetingDismissed && !isOpen && (
        <section role="status" aria-label="Welcome from iFusion Assistant" className="no-print assistant-greeting">
          <button
            type="button"
            aria-label="Dismiss assistant welcome"
            onClick={() => setGreetingDismissed(true)}
            className="assistant-greeting__close"
          >
            <X aria-hidden="true" size={14} />
          </button>
          <p className="assistant-greeting__title">
            Hi <span aria-hidden="true">{"\u{1F44B}"}</span> {friendlyName}!
          </p>
          <p className="assistant-greeting__body">I&apos;m your {adapter.title ?? "iFusion Assistant"}.</p>
          <button
            type="button"
            onClick={() => {
              setGreetingDismissed(true);
              setOpen(true);
            }}
            className="assistant-greeting__action"
          >
            {adapter.greetingAction ?? "Ask me anything"}
            <ArrowRight aria-hidden="true" size={14} />
          </button>
        </section>
      )}

      <button
        type="button"
        aria-label={isOpen ? "Close assistant" : "AI assistant"}
        aria-expanded={isOpen}
        aria-controls="assistant-panel"
        onClick={() => {
          setGreetingDismissed(true);
          setOpen(!isOpen);
        }}
        className="no-print assistant-launcher"
      >
        <img src={adapter.avatarSrc} alt="" width={72} height={72} className="assistant-avatar__image" />
        <span aria-hidden="true" className="assistant-avatar__presence" />
      </button>

      {isOpen && (
        <>
          <div aria-hidden="true" onClick={() => setOpen(false)} className="no-print assistant-scrim" />
          <aside
            id="assistant-panel"
            role="dialog"
            aria-modal="true"
            aria-label={adapter.title ?? "iFusion Assistant"}
            className="no-print assistant-panel"
          >
            <header className="assistant-panel__chrome assistant-panel__header">
              <div className="assistant-panel__identity">
                <div className="assistant-panel__avatar" aria-hidden="true">
                  <img src={adapter.avatarSrc} alt="" width={44} height={44} className="assistant-avatar__image" />
                  <span className="assistant-avatar__presence" />
                </div>
                <div className="assistant-panel__titles">
                  <div className="assistant-panel__title-row">
                    <h2>{adapter.title ?? "iFusion Assistant"}</h2>
                    <span className="assistant-status">
                      <span aria-hidden="true" className="assistant-status__dot" />
                      Online
                    </span>
                  </div>
                  {contextLabel ? (
                    <p className="assistant-context-chip" title="I can see this screen">
                      {contextLabel}
                    </p>
                  ) : (
                    <p className="assistant-panel__subtitle">{adapter.subtitle ?? "Here to help"}</p>
                  )}
                </div>
              </div>
              <button type="button" aria-label="Close assistant" onClick={() => setOpen(false)} className="assistant-icon-button">
                <X aria-hidden="true" size={16} />
              </button>
            </header>

            <div className="assistant-thread">
              {messages.length === 0 && !busy && (
                <AssistantBubble avatarSrc={adapter.avatarSrc}>
                  <div className="assistant-stack">
                    <div>
                      <p className="assistant-intro__title">How can I help{contextLabel ? " here" : ""}?</p>
                      <p className="assistant-intro__body">
                        {adapter.subtitle ?? "Ask me about your data, and I can help fill in the editors."}
                      </p>
                    </div>
                    <SuggestionChips suggestions={starters} onPick={submit} label="Get started" />
                  </div>
                </AssistantBubble>
              )}

              {messages.map((message, index) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  previousQuestion={findQuestionBefore(messages, index)}
                  onAsk={submit}
                />
              ))}

              {busy && (
                <AssistantBubble avatarSrc={adapter.avatarSrc}>
                  <ThinkingLine text={status === "polling" ? "Still working on that…" : "Looking that up…"} />
                </AssistantBubble>
              )}

              {upload && (
                <AssistantBubble avatarSrc={adapter.avatarSrc}>
                  {upload.state === "uploading" ? (
                    <p className="assistant-thinking">
                      <Loader2 aria-hidden="true" size={14} className="assistant-spin" />
                      {upload.message}
                    </p>
                  ) : (
                    <FriendlyFailure message={upload.message} />
                  )}
                </AssistantBubble>
              )}

              <div ref={threadEndRef} />
            </div>

            <form
              className="assistant-panel__chrome assistant-composer"
              onSubmit={(event) => {
                event.preventDefault();
                submit(question);
              }}
            >
              <label className="assistant-sr-only" htmlFor="assistant-question">
                Ask the assistant
              </label>
              <textarea
                id="assistant-question"
                ref={inputRef}
                value={question}
                rows={2}
                maxLength={maxLength}
                placeholder={adapter.placeholder ?? "Ask me about this screen…"}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit(question);
                  }
                }}
                className="assistant-input"
              />
              <div className="assistant-composer__row">
                <div className="assistant-composer__left">
                  {canUpload && (
                    <>
                      <input
                        ref={fileRef}
                        type="file"
                        accept={activeCapability?.attachments?.accept ?? "image/*"}
                        hidden
                        onChange={(event) => {
                          void onFileChosen(event.target.files?.[0]);
                          event.target.value = "";
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        title={activeCapability?.attachments?.hint}
                        aria-label={activeCapability?.attachments?.hint ?? "Attach an image"}
                        className="assistant-icon-button"
                      >
                        <Paperclip aria-hidden="true" size={16} />
                      </button>
                    </>
                  )}
                  <span className="assistant-counter">
                    {question.length >= maxLength * 0.8 ? `${question.length}/${maxLength}` : ""}
                  </span>
                </div>
                <div className="assistant-composer__right">
                  {messages.length > 0 && (
                    <button type="button" onClick={reset} className="assistant-button">
                      New conversation
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={question.trim().length < 2 || busy}
                    className="assistant-button assistant-button--primary"
                  >
                    {busy ? (
                      <Loader2 aria-hidden="true" size={15} className="assistant-spin" />
                    ) : (
                      <Send aria-hidden="true" size={15} />
                    )}
                    <span>Ask</span>
                  </button>
                </div>
              </div>
              <p className="assistant-footnote">
                <ShieldCheck aria-hidden="true" size={12} />
                Read-only <span aria-hidden="true">·</span> I never save or delete without asking
              </p>
            </form>
          </aside>
        </>
      )}
    </>
  );
}

function findQuestionBefore(messages: ThreadMessage[], index: number) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const message = messages[cursor];
    if (message?.role === "user") return message.text;
  }
  return "";
}

function AssistantBubble({ children, avatarSrc }: { children: ReactNode; avatarSrc: string }) {
  return (
    <div className="assistant-message-row">
      <div className="assistant-message__avatar" aria-hidden="true">
        <img src={avatarSrc} alt="" width={32} height={32} className="assistant-avatar__image" />
      </div>
      <div className="assistant-message__bubble">
        <span className="assistant-sr-only">Assistant: </span>
        {children}
      </div>
    </div>
  );
}

function MessageRow({
  message,
  previousQuestion,
  onAsk
}: {
  message: ThreadMessage;
  previousQuestion: string;
  onAsk: (question: string) => void;
}) {
  const assistant = useAssistant();
  const { adapter, activeCapability, capabilities } = assistant;

  if (message.role === "user") {
    return (
      <p className="assistant-user-message">
        <span className="assistant-sr-only">You: </span>
        {maskSensitiveNumbers(message.text)}
      </p>
    );
  }

  if (message.role === "error") {
    return (
      <AssistantBubble avatarSrc={adapter.avatarSrc}>
        <FriendlyFailure
          message={message.text}
          onRetry={message.retry ? () => onAsk(message.retry as string) : undefined}
        />
      </AssistantBubble>
    );
  }

  if (message.role === "notice") {
    return <p className="assistant-notice">{message.text}</p>;
  }

  const result = message.response;
  const hosted = adapter.renderResult?.(result, { ask: onAsk });
  if (hosted) return <AssistantBubble avatarSrc={adapter.avatarSrc}>{hosted}</AssistantBubble>;

  return (
    <AssistantBubble avatarSrc={adapter.avatarSrc}>
      {result.resultType === "insight" && result.insight && (
        <InsightCard
          answer={result.insight.answer || result.answer}
          highlights={result.insight.highlights}
          followUps={result.insight.followUps}
          onFollowUp={onAsk}
          onOpenLink={adapter.onOpenLink}
        />
      )}

      {result.resultType === "uiAction" && (
        <UiActionCard
          answer={result.answer}
          state={message.apply}
          warnings={result.uiAction?.warnings ?? []}
          onUndo={() => assistant.undoApply(message.id)}
          onApply={() => assistant.applyAction(message.id)}
          onOpenLink={adapter.onOpenLink}
        />
      )}

      {result.resultType === "commandProposal" && result.commandProposal && (
        <CommandProposalCard
          summary={result.commandProposal.summary || result.answer}
          detail={result.commandProposal.detail}
          targetLabel={result.commandProposal.targetLabel}
          warnings={result.commandProposal.warnings}
          destructive={result.commandProposal.destructive}
          state={message.command}
          allowed={
            result.commandProposal.destructive
              ? adapter.permissions?.canDelete(result.commandProposal.zoneId) ?? true
              : adapter.permissions?.canUpdate(result.commandProposal.zoneId) ?? true
          }
          onConfirm={() => assistant.runCommand(message.id)}
          onDismiss={() => assistant.dismissCommand(message.id)}
          onOpenLink={adapter.onOpenLink}
        />
      )}

      {result.resultType === "clarification" && result.clarification && (
        <ClarificationCard
          question={result.clarification.question}
          suggestions={result.clarification.suggestions}
          onPick={onAsk}
        />
      )}

      {result.resultType === "refusal" && result.refusal && (
        <RefusalCard
          reason={result.refusal.reason}
          question={previousQuestion}
          canEdit={Boolean(activeCapability)}
          suggestions={(capabilities?.examples ?? []).slice(0, 2)}
          onPick={onAsk}
        />
      )}

      {result.resultType === "queued" && <QueuedCard />}
    </AssistantBubble>
  );
}
