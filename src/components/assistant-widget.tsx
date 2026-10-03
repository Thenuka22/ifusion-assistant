"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, ImageIcon, Loader2, MessageSquarePlus, Paperclip, Send, X, Maximize2, Minimize2, CircleHelp, Square } from "lucide-react";
import { ASSISTANT_MAX_QUESTION_LENGTH } from "../contracts/assistant-contracts";
import type { FareSetupProposal } from "../contracts/fare-setup";
import type { AssistantAdapter } from "../core/adapter";
import { useAssistant, type ThreadMessage } from "../core/assistant-provider";
import { formatWait, getFriendlyName, maskSensitiveNumbers } from "../core/guardrails";
import {
  ClarificationCard,
  CommandProposalCard,
  FareSetupCard,
  FriendlyFailure,
  InsightCard,
  QueuedCard,
  RefusalCard,
  SuggestionChips,
  UiActionCard
} from "./result-cards";

const GREETING_KEY = "ifusion-assistant-greeting-seen";

/** What the assistant is called when the host does not say. */
const DEFAULT_NAME = "Lora";

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

/** Openers that read like a colleague at the next desk, not a splash screen. */
function timeOfDayGreeting(name: string) {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";
  return `${part}, ${name}.`;
}

/**
 * Rotated while waiting, so a slow answer feels attended to rather than stuck. None of them claim
 * anything about what is happening — they are body language, not status.
 */
const THINKING_PHRASES = ["Thinking…", "Having a look…", "Pulling that together…"];

/** The fare tables zone, whose rights decide whether a prepared fare setup can be saved. */
const FARES_ZONE_ID = 7;

/** Seconds until `retryAt`, ticking once a second while there is something to count down. */
function useCountdown(retryAt: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (retryAt === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  return retryAt === null ? 0 : Math.max(0, Math.ceil((retryAt - now) / 1000));
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
    reset,
    stop,
    restoredQuestion,
    consumeRestoredQuestion,
    retryAt,
    pendingAttachment,
    setPendingAttachment,
    fareSetupEnabled,
    accepts
  } = assistant;
  const name = adapter.title ?? DEFAULT_NAME;

  const [expanded, setExpanded] = useState(false);
  const [panelWidth, setPanelWidth] = useState(460);
  const [mobile, setMobile] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia("(max-width: 639px)");
    const sync = () => setMobile(media.matches);
    sync(); media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => () => { if (imagePreview) URL.revokeObjectURL(imagePreview); }, [imagePreview]);
  const [question, setQuestion] = useState("");
  const [greetingWasSeen] = useState(() => hasSeenGreeting(adapter.user.name));
  const [isGreetingDismissed, setGreetingDismissed] = useState(false);
  const [upload, setUpload] = useState<{ state: "uploading" | "failed"; message: string } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const friendlyName = getFriendlyName(adapter.user.name);
  const enabled = capabilities?.enabled ?? false;
  const waitSeconds = useCountdown(retryAt);

  // A question that failed comes back into the box, unless something new has been typed since.
  useEffect(() => {
    if (!restoredQuestion) return;
    setQuestion((current) => (current.trim() ? current : restoredQuestion.text));
    consumeRestoredQuestion();
  }, [restoredQuestion, consumeRestoredQuestion]);

  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); launcherRef.current?.focus(); };
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
  // Nothing is cut off: an over-long message is said to be over-long and is not sent.
  const tooLong = question.length > maxLength;
  const waiting = waitSeconds > 0;
  const canSend =
    !busy && !waiting && !tooLong && (question.trim().length >= 2 || Boolean(pendingAttachment));

  // A photo straight into the open fare grid needs both the server and the editor to allow it, so a
  // screen can never offer something the API would turn away.
  const editorTakesImage =
    Boolean(sectionCapability?.attachments) &&
    Boolean(activeCapability?.attachments) &&
    !activeCapability?.getSnapshot().readOnly;
  // Anywhere else a photo can still start a fare setup, when the host can review one.
  const canUpload = Boolean(adapter.uploadAttachment) && (editorTakesImage || fareSetupEnabled);

  const starters = screenSuggestions(assistant).slice(0, 4);

  const contextLabel = activeCapability?.getSnapshot().label || assistant.buildContext().moduleTitle || "";

  function submit(next: string) {
    const trimmed = next.trim();
    if (busy || waiting || trimmed.length > maxLength) return;
    if (trimmed.length < 2 && !pendingAttachment) return;
    setQuestion("");
    ask(trimmed);
  }

  async function onFileChosen(file: File | undefined) {
    if (!file || !adapter.uploadAttachment) return;
    if (capabilities?.supportsImages === false) {
      setUpload({ state: "failed", message: `${name} can't read images just now. Paste the fare table as text instead, or ask an administrator to turn on image reading under Settings → AI assistant.` });
      return;
    }
    setImagePreview(URL.createObjectURL(file));
    const limit = activeCapability?.attachments?.maxBytes ?? capabilities?.maxUploadBytes ?? 8 * 1024 * 1024;
    if (file.size > limit) {
      setUpload({ state: "failed", message: `That image is larger than ${Math.round(limit / 1024 / 1024)} MB.` });
      return;
    }

    setUpload({ state: "uploading", message: "Uploading the image…" });
    try {
      const attachment = await adapter.uploadAttachment(
        file,
        assistant.buildContext(),
        undefined,
        accepts.length > 0 ? { accepts } : undefined
      );
      setUpload(null);
      if (editorTakesImage) {
        // The open grid is the obvious place for it, so it is read straight away.
        ask("Read this fare table and fill in the grid.", { attachmentId: attachment.attachmentId });
      } else {
        // Anywhere else the photo waits for the user to say what it is for.
        setPendingAttachment({ attachmentId: attachment.attachmentId, name: file.name });
        inputRef.current?.focus();
      }
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
        <section role="status" aria-label={`Welcome from ${name}`} className="no-print assistant-greeting">
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
          <p className="assistant-greeting__body">I&apos;m {name}{adapter.tagline ? `, ${adapter.tagline}` : ""}.</p>
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
        ref={launcherRef}
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
          {(expanded || mobile) && <div aria-hidden="true" onClick={() => setOpen(false)} className="no-print assistant-scrim" />}
          <aside
            ref={panelRef}
            id="assistant-panel"
            role="dialog"
            aria-modal={expanded || mobile}
            aria-label={name}
            className={`no-print assistant-panel${expanded ? " assistant-panel--expanded" : ""}`}
            style={{ "--asst-panel-width": `${panelWidth}px` } as CSSProperties}
            onKeyDown={(event) => {
              if (!(expanded || mobile) || event.key !== "Tab") return;
              const controls = panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, a[href], [tabindex="0"]');
              if (!controls?.length) return;
              const first = controls[0], last = controls[controls.length - 1];
              if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
              else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }}
          >
            {!mobile && !expanded && <div role="separator" aria-label="Resize assistant panel" aria-orientation="vertical"
              aria-valuemin={360} aria-valuemax={900} aria-valuenow={panelWidth} tabIndex={0} className="assistant-resizer"
              onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setPanelWidth(value => Math.min(900, Math.max(360, value + (event.key === "ArrowLeft" ? 24 : -24)))); } }}
              onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); }}
              onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setPanelWidth(Math.min(900, Math.max(360, window.innerWidth - event.clientX))); }}
              onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)} />}
            {/* Who it is and what it can see. Never which vendor or model is behind it: that is a
                setting for administrators, not something the person asking needs to know. */}
            <header className="assistant-panel__header assistant-panel__header--hero">
              <div className="assistant-panel__identity">
                <div className="assistant-panel__avatar" aria-hidden="true">
                  <img src={adapter.avatarSrc} alt="" width={48} height={48} className="assistant-avatar__image" />
                  <span className="assistant-avatar__presence" />
                </div>
                <div className="assistant-panel__titles">
                  <h2>{name}</h2>
                  {adapter.tagline && <p className="assistant-panel__tagline">{adapter.tagline}</p>}
                  {contextLabel && (
                    <p className="assistant-context-chip" title="I can see this screen">
                      {contextLabel}
                    </p>
                  )}
                </div>
              </div>
              <div className="assistant-panel__actions">
                <button type="button" aria-label={expanded ? "Collapse assistant" : "Expand assistant"} onClick={() => setExpanded(value => !value)} className="assistant-icon-button">
                  {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
                  <button
                    type="button"
                    aria-label="Start a new conversation"
                    title="New conversation"
                    disabled={messages.length === 0 && !question && !pendingAttachment}
                    onClick={() => { reset(); setQuestion(""); setPendingAttachment(null); setUpload(null); setImagePreview(null); }}
                    className="assistant-icon-button"
                  >
                    <MessageSquarePlus aria-hidden="true" size={16} />
                  </button>
                <button type="button" aria-label="Close assistant" onClick={() => setOpen(false)} className="assistant-icon-button">
                  <X aria-hidden="true" size={16} />
                </button>
              </div>
            </header>

            {capabilities?.guidanceAvailable && <div className="assistant-guidance-entry">
              <button type="button" className="assistant-chip" disabled={busy} onClick={() => { if (!busy && !waiting) ask("Explain this screen and the next setup step.", { intent: "explainScreen" }); }}><CircleHelp size={14} aria-hidden="true" /> Explain this screen</button>
            </div>}
            <div className="assistant-thread" role="log" aria-live="polite" aria-label="Assistant conversation">
              {messages.length === 0 && !busy && (
                <AssistantBubble avatarSrc={adapter.avatarSrc} welcome>
                  <div className="assistant-stack">
                    <div>
                      <p className="assistant-intro__title">{timeOfDayGreeting(friendlyName)}</p>
                      <p className="assistant-intro__body">
                        {contextLabel
                          ? "Ask about this screen, get a quick walkthrough, or let me help with the next step."
                          : adapter.subtitle ??
                            "Ask me about your routes, fares, vehicles and drivers, and I can fill in the editors for you."}
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
                  <TypingBubble polling={status === "polling"} />
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
              {/* Textarea and controls share one bordered box, so the composer reads as a single
                  place to type rather than a field with buttons loose beneath it. */}
              {imagePreview && (pendingAttachment || busy || upload) && <img src={imagePreview} alt="Attached fare table preview" className="assistant-image-preview" />}
              {pendingAttachment && (
                <p className="assistant-attachment-chip">
                  <ImageIcon aria-hidden="true" size={14} />
                  <span className="assistant-attachment-chip__name">{pendingAttachment.name}</span>
                  <span className="assistant-muted">goes with your next message</span>
                  <button
                    type="button"
                    aria-label="Remove the attached image"
                    onClick={() => setPendingAttachment(null)}
                    className="assistant-icon-button"
                  >
                    <X aria-hidden="true" size={14} />
                  </button>
                </p>
              )}
              {tooLong && (
                <p id="assistant-question-limit" role="alert" className="assistant-line assistant-line--danger">
                  That&apos;s {question.length.toLocaleString()} characters; the limit is{" "}
                  {maxLength.toLocaleString()}. Shorten it or split it.
                </p>
              )}
              {waiting && !tooLong && (
                <p role="status" className="assistant-muted">
                  The assistant asked for a pause. You can send again in {formatWait(waitSeconds)}.
                </p>
              )}
              <div className="assistant-composer__box">
                <textarea
                id="assistant-question"
                ref={inputRef}
                value={question}
                rows={2}
                aria-invalid={tooLong || undefined}
                aria-describedby={tooLong ? "assistant-question-limit" : undefined}
                placeholder={
                  pendingAttachment
                    ? "Say which route and ticket this table is for…"
                    : adapter.placeholder ?? "Ask me about this screen…"
                }
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
                  {busy && <button type="button" onClick={stop} className="assistant-chip" aria-label="Stop response"><Square size={13} aria-hidden="true" /> Stop</button>}
                  <button
                    type="submit"
                    aria-label="Send"
                    disabled={!canSend}
                    className="assistant-send"
                  >
                    {busy ? (
                      <Loader2 aria-hidden="true" size={16} className="assistant-spin" />
                    ) : (
                      <Send aria-hidden="true" size={16} />
                    )}
                  </button>
                </div>
              </div>
              </div>
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

/**
 * What the assistant looks like while it works: three breathing dots and a quiet phrase that
 * changes now and then. Screen readers get one steady sentence instead of the rotation.
 */
function TypingBubble({ polling }: { polling: boolean }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 2600);
    return () => window.clearInterval(timer);
  }, []);

  const phrase = polling
    ? "Still on it, a moment more…"
    : THINKING_PHRASES[tick % THINKING_PHRASES.length];

  return (
    <div className="assistant-typing" role="status">
      <span className="assistant-sr-only">Thinking</span>
      <span aria-hidden="true" className="assistant-typing__dots">
        <span />
        <span />
        <span />
      </span>
      <span aria-hidden="true" className="assistant-typing__text">
        {phrase}
      </span>
    </div>
  );
}

/** A message's time as a clock reads it, "08:15". */
function clock(at: number | undefined) {
  if (!at) return null;
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function AssistantBubble({ children, avatarSrc, welcome = false, at }: { children: ReactNode; avatarSrc: string; welcome?: boolean; at?: number }) {
  const { adapter } = useAssistant();
  const name = adapter.title ?? DEFAULT_NAME;
  const time = clock(at);
  return (
    <div className={`assistant-message-row${welcome ? " assistant-message-row--welcome" : ""}`}>
      <div className="assistant-message__avatar" aria-hidden="true">
        <img src={avatarSrc} alt="" width={32} height={32} className="assistant-avatar__image" />
      </div>
      <div className="assistant-message__body">
        {!welcome && <p className="assistant-message__name" aria-hidden="true">{name}</p>}
        <div className="assistant-message__bubble">
          <span className="assistant-sr-only">{name}: </span>
          {children}
        </div>
        {time && <time className="assistant-message__time" dateTime={new Date(at!).toISOString()}>{time}</time>}
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
  const { adapter, activeCapability } = assistant;

  if (message.role === "user") {
    const time = clock(message.at);
    return (
      <div className="assistant-user-row">
        <p className="assistant-user-message">
          <span className="assistant-sr-only">You: </span>
          {maskSensitiveNumbers(message.text)}
        </p>
        {time && <time className="assistant-message__time" dateTime={new Date(message.at!).toISOString()}>{time}</time>}
      </div>
    );
  }

  if (message.role === "error") {
    return (
      <AssistantBubble avatarSrc={adapter.avatarSrc} at={message.at}>
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
  if (hosted) return <AssistantBubble avatarSrc={adapter.avatarSrc} at={message.at}>{hosted}</AssistantBubble>;

  return (
    <AssistantBubble avatarSrc={adapter.avatarSrc} at={message.at}>
      {result.resultType === "insight" && result.insight && (
        <InsightCard
          answer={result.insight.answer || result.answer}
          highlights={result.insight.highlights}
          followUps={result.insight.followUps}
          onFollowUp={onAsk}
          onOpenLink={adapter.onOpenLink}
          evidence={result.insight.evidence}
          guidance={result.insight.guidance}
        />
      )}

      {result.resultType === "uiAction" && (
        <UiActionCard
          answer={result.answer}
          state={message.apply}
          warnings={result.uiAction?.warnings ?? []}
          undoBlockedReason={undoBlockedReason(assistant, message)}
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
          confirmPhrase={result.commandProposal.confirmPhrase}
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

      {result.resultType === "fareSetup" && result.fareSetup && (
        <FareSetupCard
          answer={result.answer}
          proposal={result.fareSetup}
          status={assistant.fareSetupStatus(message.id)}
          allowed={Boolean(adapter.fareSetup) && fareSetupAllowed(adapter, result.fareSetup)}
          blockedReason={
            adapter.fareSetup
              ? "Your role can’t save these fare tables."
              : "Fare setups are reviewed in the ticketing app."
          }
          onReview={() => assistant.openFareSetup(message.id)}
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
          detail={result.refusal.detail}
          question={previousQuestion}
          canEdit={Boolean(activeCapability)}
          suggestions={screenSuggestions(assistant).slice(0, 2)}
          onPick={onAsk}
          retryAfterSeconds={result.refusal.retryAfterSeconds}
        />
      )}

      {result.resultType === "queued" && <QueuedCard onCancel={assistant.status === "polling" ? assistant.stop : undefined} />}
    </AssistantBubble>
  );
}

/**
 * What can be asked on the screen the user is on: the open editor's own suggestions, then the
 * screen's, and only then the service's general examples.
 */
function screenSuggestions(assistant: ReturnType<typeof useAssistant>): string[] {
  const { activeCapability, sectionCapability, capabilities } = assistant;
  if (activeCapability?.suggestions?.length) return activeCapability.suggestions;
  if (sectionCapability?.suggestions?.length) return sectionCapability.suggestions;
  return capabilities?.examples ?? [];
}

/** Why the undo on a fill no longer applies, or undefined while it still does. */
function undoBlockedReason(
  assistant: ReturnType<typeof useAssistant>,
  message: Extract<ThreadMessage, { role: "assistant" }>
) {
  if (message.apply?.status !== "applied" || !message.apply.canUndo) return undefined;
  const availability = assistant.undoAvailability(message.id);
  return availability.ok ? undefined : availability.reason;
}

/**
 * Whether the role could save what a setup contains: new tables need the insert right, prices on
 * existing tables the update right. Cosmetic only — the ticketing API decides for real.
 */
function fareSetupAllowed(adapter: AssistantAdapter, proposal: FareSetupProposal) {
  const permissions = adapter.permissions;
  if (!permissions) return true;
  const tables = proposal.routes.flatMap((route) => route.tables);
  const creates = tables.some((table) => table.fareMasterId === null);
  const updates = tables.some((table) => table.fareMasterId !== null);
  if (creates && permissions.canInsert?.(FARES_ZONE_ID) === false) return false;
  if (updates && !permissions.canUpdate(FARES_ZONE_ID)) return false;
  return true;
}
