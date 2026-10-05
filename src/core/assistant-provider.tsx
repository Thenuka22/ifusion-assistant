"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from "react";
import type {
  AssistantAskRequest,
  AssistantCapabilities,
  AssistantQueryResponse,
  AssistantSectionCapability
} from "../contracts/assistant-contracts";
import {
  ASSISTANT_CONTEXT_VERSION,
  getBrowserTimeZone,
  type AssistantApp,
  type AssistantContext,
  type AssistantSubject
} from "../contracts/section-context";
import type { UiAction } from "../contracts/ui-actions";
import type { AssistantAdapter } from "./adapter";
import {
  CapabilityRegistry,
  CapabilityRegistryContext,
  type EditorCapability
} from "./capability-registry";
import { getFriendlyRequestError } from "./guardrails";

/* --------------------------------------------------------------- thread state */

export type ApplyState =
  | {
      status: "applied";
      appliedCount: number;
      skipped: { ref: string; reason: string }[];
      canUndo: boolean;
      /** Why undo stopped being available, when it was withdrawn rather than never offered. */
      undoNote?: string;
    }
  | { status: "undone" }
  | { status: "unavailable"; reason: string };

export type CommandState =
  | { status: "confirming" }
  | { status: "done"; message: string }
  | { status: "failed"; message: string }
  | { status: "dismissed" };

/**
 * One entry in the conversation. `at` is when it arrived, in epoch milliseconds; threads stored
 * before 0.8 have none and simply show no time.
 */
export type ThreadMessage =
  | { id: string; role: "user"; text: string; at?: number }
  | {
      id: string;
      role: "assistant";
      response: AssistantQueryResponse;
      apply?: ApplyState;
      command?: CommandState;
      at?: number;
    }
  | { id: string; role: "error"; text: string; retry?: string; at?: number }
  | { id: string; role: "notice"; text: string; at?: number };

type ThreadState = {
  messages: ThreadMessage[];
  sessionId: string;
  /** The storage key this thread belongs to, so a thread is never written under another scope. */
  scope: string;
};

/** Whether a fare-setup card is the newest revision of its draft. */
export type FareSetupStatus = "current" | "superseded";

/** An uploaded image waiting to go with the user's next message. */
export type PendingAttachment = { attachmentId: string; name: string };

const MAX_THREAD_MESSAGES = 30;

type ThreadAction =
  | { type: "user"; id: string; text: string; at?: number }
  | { type: "assistant"; id: string; response: AssistantQueryResponse; at?: number }
  | { type: "replace"; id: string; response: AssistantQueryResponse }
  | { type: "error"; id: string; text: string; retry?: string; at?: number }
  | { type: "notice"; id: string; text: string; at?: number }
  | { type: "apply"; id: string; state: ApplyState }
  | { type: "command"; id: string; state: CommandState }
  | { type: "session"; sessionId: string }
  | { type: "restore"; state: ThreadState }
  | { type: "reset" };

function trim(messages: ThreadMessage[]) {
  return messages.length > MAX_THREAD_MESSAGES ? messages.slice(-MAX_THREAD_MESSAGES) : messages;
}

function threadReducer(state: ThreadState, action: ThreadAction): ThreadState {
  switch (action.type) {
    case "user":
      return { ...state, messages: trim([...state.messages, { id: action.id, role: "user", text: action.text, at: action.at }]) };
    case "assistant":
      return {
        ...state,
        messages: trim([...state.messages, { id: action.id, role: "assistant", response: action.response, at: action.at }])
      };
    case "replace":
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.id && message.role === "assistant"
            ? { ...message, response: action.response }
            : message
        )
      };
    case "error":
      return {
        ...state,
        messages: trim([...state.messages, { id: action.id, role: "error", text: action.text, retry: action.retry, at: action.at }])
      };
    case "notice":
      return { ...state, messages: trim([...state.messages, { id: action.id, role: "notice", text: action.text, at: action.at }]) };
    case "apply":
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.id && message.role === "assistant"
            ? { ...message, apply: action.state }
            : message
        )
      };
    case "command":
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.id && message.role === "assistant"
            ? { ...message, command: action.state }
            : message
        )
      };
    case "session":
      return { ...state, sessionId: action.sessionId };
    case "restore":
      return action.state;
    case "reset":
      return { messages: [], sessionId: "", scope: state.scope };
    default:
      return state;
  }
}

/* ------------------------------------------------------------------- context */

/** What the host app knows about where the user is, without the editor's own contribution. */
export type AssistantContextInput = {
  app: AssistantApp;
  section: string;
  module?: string;
  moduleTitle?: string;
  path?: string;
  zoneId?: number;
  selection?: Record<string, number | string>;
};

export type AssistantContextValue = {
  adapter: AssistantAdapter;
  capabilities: AssistantCapabilities | null;
  sectionCapability: AssistantSectionCapability | null;
  activeCapability: EditorCapability | null;
  messages: ThreadMessage[];
  status: "idle" | "asking" | "polling";
  isOpen: boolean;
  setOpen(open: boolean): void;
  ask(question: string, options?: { attachmentId?: string; intent?: string }): void;
  reset(): void;
  stop(): void;
  buildContext(): AssistantContext;
  applyAction(messageId: string): void;
  undoApply(messageId: string): void;
  /** Whether undo would still act on the editor it was made for; the reason when it would not. */
  undoAvailability(messageId: string): { ok: true } | { ok: false; reason: string };
  runCommand(messageId: string): void;
  dismissCommand(messageId: string): void;
  /** Optional result types this client asks the service for. */
  accepts: string[];
  /** True when the service prepares fare setups and the host can review them. */
  fareSetupEnabled: boolean;
  openFareSetup(messageId: string): void;
  fareSetupStatus(messageId: string): FareSetupStatus;
  /** A question to put back into the composer after it failed, so nothing typed is lost. */
  restoredQuestion: { text: string; nonce: number } | null;
  consumeRestoredQuestion(): void;
  /** Epoch milliseconds before which the service asked not to be sent another question. */
  retryAt: number | null;
  pendingAttachment: PendingAttachment | null;
  setPendingAttachment(attachment: PendingAttachment | null): void;
};

const AssistantStateContext = createContext<AssistantContextValue | null>(null);

export function useAssistant() {
  const value = useContext(AssistantStateContext);
  if (!value) throw new Error("useAssistant must be used inside <AssistantProvider>.");
  return value;
}

/** True where the assistant is mounted; lets an editor skip registration work when it is not. */
export function useHasAssistant() {
  return useContext(AssistantStateContext) !== null;
}

let messageCounter = 0;
function nextId(prefix: string) {
  messageCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${messageCounter}`;
}

/* ------------------------------------------------------------------ provider */

export function AssistantProvider({
  adapter,
  context,
  children
}: {
  adapter: AssistantAdapter;
  context: AssistantContextInput;
  children: ReactNode;
}) {
  // A stable id and the scope (the company) key the conversation. The display name is only the
  // fallback for hosts that do not supply an id, which is what versions before 0.5 keyed on.
  const userKey = String(adapter.user.id ?? adapter.user.name.trim().toLocaleLowerCase());
  const storageKey = `ifusion-assistant-thread:${adapter.app}:${userKey}:${adapter.scopeKey ?? ""}`;

  const [registry] = useState(() => new CapabilityRegistry());
  const [thread, dispatch] = useReducer(threadReducer, { messages: [], sessionId: "", scope: storageKey });
  const [capabilities, setCapabilities] = useState<AssistantCapabilities | null>(null);
  const [status, setStatus] = useState<"idle" | "asking" | "polling">("idle");
  const [isOpen, setOpen] = useState(false);
  const [pendingRun, setPendingRun] = useState<{
    messageId: string;
    runId: string;
    delay: number;
    startedAt: number;
    question: string;
  } | null>(null);
  const [restoredQuestion, setRestoredQuestion] = useState<{ text: string; nonce: number } | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);

  // Undo closures belong to the editor that made them, so they live outside reducer state and are
  // dropped on reload — a card then honestly reports that undo is no longer available. Each one
  // remembers which editor and which scope it was made against, and only runs there.
  const undoRef = useRef(new Map<string, { undo: () => void; signature: string; scope: string }>());
  const actionRef = useRef(new Map<string, UiAction>());

  // One question at a time, however fast the button is pressed; the controller aborts it on reset
  // and unmount, and the generation makes any answer that arrives after either of those a no-op.
  const inFlightRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);

  const registryVersion = useSyncExternalStore(
    registry.subscribe,
    registry.getVersion,
    () => 0
  );
  const activeCapability = useMemo(
    () => (registryVersion >= 0 ? registry.getActive() : null),
    [registry, registryVersion]
  );

  const contextRef = useRef(context);
  contextRef.current = context;

  const scopeRef = useRef(storageKey);
  scopeRef.current = storageKey;

  const fareSetupEnabled = Boolean(adapter.fareSetup) && Boolean(capabilities?.fareSetup.enabled);
  const accepts = useMemo(() => (fareSetupEnabled ? ["fareSetup", "guidance", "bulkFareV2"] : ["guidance", "bulkFareV2"]), [fareSetupEnabled]);

  /** Drops everything in flight: the request, the poll, and anything a late answer would touch. */
  const abandonInFlight = useCallback(() => {
    generationRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = null;
    inFlightRef.current = false;
    setPendingRun(null);
    setStatus("idle");
  }, []);

  useEffect(() => () => {
    generationRef.current += 1;
    requestRef.current?.abort();
  }, []);

  /* capabilities */
  useEffect(() => {
    let controller: AbortController;
    const refresh = () => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      void adapter.getCapabilities(signal).then(value => {
        if (!signal.aborted) setCapabilities(value);
      }).catch(() => {
        if (!signal.aborted) setCapabilities(null);
      });
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("ifusion:assistant-configuration-changed", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("ifusion:assistant-configuration-changed", refresh);
    };
  }, [adapter]);

  /* thread persistence — one thread per user and scope */
  useEffect(() => {
    // A new scope (another company) starts from its own stored thread; nothing prepared under the
    // old one may land here, so whatever was in flight is abandoned and every undo is forgotten.
    abandonInFlight();
    undoRef.current.clear();
    actionRef.current.clear();
    setPendingAttachment(null);
    setRetryAt(null);

    let restored: ThreadState = { messages: [], sessionId: "", scope: storageKey };
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      const parsed = raw ? (JSON.parse(raw) as Partial<ThreadState>) : null;
      if (parsed && Array.isArray(parsed.messages)) {
        // Undo closures did not survive the reload; say so rather than offering a dead button.
        const messages = parsed.messages.map((message) =>
          message.role === "assistant" && message.apply?.status === "applied"
            ? { ...message, apply: { ...message.apply, canUndo: false } }
            : message
        );
        restored = { messages, sessionId: parsed.sessionId ?? "", scope: storageKey };
      }
    } catch {
      // Blocked storage is not a reason to fail; the thread simply starts empty.
    }
    dispatch({ type: "restore", state: restored });
  }, [storageKey, abandonInFlight]);

  useEffect(() => {
    // Written only under the key the thread was loaded for, so switching scope never copies one
    // company's conversation into another's.
    if (thread.scope !== storageKey) return;
    try {
      window.sessionStorage.setItem(
        storageKey,
        JSON.stringify({ messages: thread.messages, sessionId: thread.sessionId })
      );
    } catch {
      // Nothing here is worth interrupting the conversation for.
    }
  }, [storageKey, thread]);

  const buildContext = useCallback((): AssistantContext => {
    const base = contextRef.current;
    const capability = registry.getActive();
    const snapshot = capability?.getSnapshot();
    const selection = {
      ...(base.selection ?? {}),
      ...(capability?.getSelection?.() ?? {})
    };
    const view = registry.getView();
    const viewFacts = view?.facts ? boundFacts(view.facts) : undefined;

    return {
      version: ASSISTANT_CONTEXT_VERSION,
      app: base.app,
      section: base.section,
      ...(base.module ? { module: base.module } : {}),
      ...(base.moduleTitle ? { moduleTitle: base.moduleTitle } : {}),
      ...(base.path ? { path: base.path } : {}),
      ...(base.zoneId ? { zoneId: base.zoneId } : {}),
      ...(Object.keys(selection).length > 0 ? { selection } : {}),
      ...(snapshot ? { editor: snapshot } : {}),
      ...(getBrowserTimeZone() ? { timeZone: getBrowserTimeZone() } : {}),
      ...(view?.view ? { view: view.view.slice(0, 64) } : {}),
      ...(viewFacts && Object.keys(viewFacts).length > 0 ? { viewFacts } : {}),
      ...(view?.subject ? { subject: boundSubject(view.subject) } : {})
    };
  }, [registry]);

  /**
   * Puts a validated change into the open editor.
   *
   * Fills land in the grid straight away and are highlighted there: the user reviews what changed
   * and presses the editor's own Save button, exactly as if they had typed it.
   */
  const applyToEditor = useCallback(
    (messageId: string, action: UiAction) => {
      // Not a change of its own: it takes back the latest one, through that change's own undo.
      if (action.kind === "assistant/undo-last") {
        undoLatestRef.current(messageId);
        return;
      }
      const capability = registry.getActive();
      if (!capability || !capability.accepts.includes(action.kind)) {
        dispatch({
          type: "apply",
          id: messageId,
          state: { status: "unavailable", reason: "Open the screen this change belongs to and apply it there." }
        });
        return;
      }

      const decision = capability.canApply(action);
      if (!decision.ok) {
        dispatch({ type: "apply", id: messageId, state: { status: "unavailable", reason: decision.reason } });
        return;
      }

      const result = capability.apply(action);
      if (result.undo) {
        undoRef.current.set(messageId, {
          undo: result.undo,
          signature: capability.signature ?? capability.id,
          scope: scopeRef.current
        });
      }
      dispatch({
        type: "apply",
        id: messageId,
        state: {
          status: "applied",
          appliedCount: result.appliedCount,
          skipped: result.skipped,
          canUndo: Boolean(result.undo)
        }
      });
    },
    [registry]
  );

  // "Undo that" from chat, wired once the undo helpers below exist.
  const undoLatestRef = useRef<(messageId: string) => void>(() => undefined);

  const finalize = useCallback(
    (messageId: string, response: AssistantQueryResponse, mode: "add" | "replace") => {
      dispatch(mode === "add" ? { type: "assistant", at: Date.now(), id: messageId, response } : { type: "replace", id: messageId, response });
      if (response.sessionId) dispatch({ type: "session", sessionId: response.sessionId });

      if (response.resultType === "uiAction" && response.uiAction) {
        actionRef.current.set(messageId, response.uiAction);
        applyToEditor(messageId, response.uiAction);
      }
    },
    [applyToEditor]
  );

  /** A refusal that says "try again later" keeps what was typed and, when told, how long to wait. */
  const noteTransientRefusal = useCallback((response: AssistantQueryResponse, question: string) => {
    if (response.resultType !== "refusal" || !response.refusal) return;
    const reason = response.refusal.reason;
    if (!TRANSIENT_REFUSALS.has(reason)) return;
    setRestoredQuestion({ text: question, nonce: Date.now() });
    const wait = response.refusal.retryAfterSeconds;
    if (wait && wait > 0) setRetryAt(Date.now() + wait * 1000);
  }, []);

  const ask = useCallback(
    (question: string, options?: { attachmentId?: string; intent?: string }) => {
      const attachmentId = options?.attachmentId ?? pendingAttachment?.attachmentId;
      const trimmed = question.trim() || (attachmentId ? "Read this fare table." : "");
      if (trimmed.length < 2 || inFlightRef.current || status !== "idle") return;
      if (retryAt !== null && retryAt > Date.now()) return;

      inFlightRef.current = true;
      const generation = generationRef.current;
      const controller = new AbortController();
      requestRef.current = controller;

      if (!options?.attachmentId && pendingAttachment) setPendingAttachment(null);
      setRetryAt(null);
      dispatch({ type: "user", at: Date.now(), id: nextId("u"), text: trimmed });
      setStatus("asking");

      const request: AssistantAskRequest = {
        question: trimmed,
        context: buildContext(),
        ...(thread.sessionId ? { sessionId: thread.sessionId } : {}),
        ...(attachmentId ? { attachmentId } : {}),
        ...(accepts.length > 0 ? { accepts } : {}),
        ...(options?.intent ? { intent: options.intent } : {})
      };

      const messageId = nextId("a");
      adapter
        .ask(request, controller.signal)
        .then((response) => {
          if (generation !== generationRef.current) return;
          inFlightRef.current = false;
          requestRef.current = null;

          if (response.resultType === "queued") {
            dispatch({ type: "assistant", at: Date.now(), id: messageId, response });
            if (response.sessionId) dispatch({ type: "session", sessionId: response.sessionId });
            setPendingRun({
              messageId,
              runId: response.runId,
              delay: Math.max(1, response.queued?.retryAfterSeconds ?? 2) * 1000,
              startedAt: Date.now(),
              question: trimmed
            });
            setStatus("polling");
            return;
          }

          finalize(messageId, response, "add");
          noteTransientRefusal(response, trimmed);
          setStatus("idle");
        })
        .catch((error: unknown) => {
          if (generation !== generationRef.current) return;
          inFlightRef.current = false;
          requestRef.current = null;
          if (error instanceof DOMException && error.name === "AbortError") {
            setStatus("idle");
            return;
          }

          const described = adapter.describeError?.(error);
          dispatch({
            type: "error", at: Date.now(),
            id: nextId("e"),
            text: described || getFriendlyRequestError(error),
            retry: trimmed
          });
          setRestoredQuestion({ text: trimmed, nonce: Date.now() });
          setStatus("idle");
        });
    },
    [accepts, adapter, buildContext, finalize, noteTransientRefusal, pendingAttachment, retryAt, status, thread.sessionId]
  );

  /* A question that outlived the API's synchronous window is polled until the worker finishes it. */
  useEffect(() => {
    if (!pendingRun) return;

    const generation = generationRef.current;
    const controller = new AbortController();
    const stale = () => controller.signal.aborted || generation !== generationRef.current;

    const timer = window.setTimeout(() => {
      adapter
        .getRun(pendingRun.runId, controller.signal)
        .then((response) => {
          if (stale()) return;
          if (response.resultType === "queued") {
            // Waiting is bounded: past the limit the run is cancelled and the question handed back.
            if (Date.now() - pendingRun.startedAt > MAX_POLL_MS) {
              if (adapter.cancelRun) void adapter.cancelRun(pendingRun.runId).catch(() => undefined);
              dispatch({
                type: "error", at: Date.now(),
                id: nextId("e"),
                text: "That is taking much longer than it should, so I’ve stopped waiting. Your editor draft is preserved.",
                retry: pendingRun.question
              });
              setRestoredQuestion({ text: pendingRun.question, nonce: Date.now() });
              setPendingRun(null);
              setStatus("idle");
              return;
            }
            setPendingRun({ ...pendingRun });
            return;
          }
          finalize(pendingRun.messageId, response, "replace");
          setPendingRun(null);
          setStatus("idle");
        })
        .catch(() => {
          if (stale()) return;
          dispatch({
            type: "error", at: Date.now(),
            id: nextId("e"),
            text: "I couldn’t collect the completed answer right now. Please try again shortly.",
            retry: pendingRun.question
          });
          setPendingRun(null);
          setStatus("idle");
        });
    }, pendingRun.delay);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [adapter, finalize, pendingRun]);

  const applyAction = useCallback(
    (messageId: string) => {
      const action = actionRef.current.get(messageId);
      if (action) applyToEditor(messageId, action);
    },
    [applyToEditor]
  );

  const undoAvailability = useCallback(
    (messageId: string): { ok: true } | { ok: false; reason: string } => {
      const entry = undoRef.current.get(messageId);
      if (!entry) return { ok: false, reason: "Undo is no longer available." };
      if (entry.scope !== scopeRef.current) {
        return { ok: false, reason: "That fill was made for another company, so it can’t be undone here." };
      }
      const capability = registry.getActive();
      if (!capability || (capability.signature ?? capability.id) !== entry.signature) {
        return { ok: false, reason: "Undo works only while the table it filled is still open." };
      }
      return { ok: true };
    },
    // The registry version is read so availability follows the user opening another table.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registry, registryVersion]
  );

  const undoApply = useCallback(
    (messageId: string) => {
      const entry = undoRef.current.get(messageId);
      if (!entry) return;
      const availability = undoAvailability(messageId);
      if (!availability.ok) {
        // Never undo into something else: an undo keyed to the wrong table would overwrite it.
        const message = thread.messages.find((item) => item.id === messageId);
        if (message?.role === "assistant" && message.apply?.status === "applied") {
          dispatch({
            type: "apply",
            id: messageId,
            state: { ...message.apply, canUndo: false, undoNote: availability.reason }
          });
        }
        return;
      }
      entry.undo();
      undoRef.current.delete(messageId);
      dispatch({ type: "apply", id: messageId, state: { status: "undone" } });
    },
    [thread.messages, undoAvailability]
  );

  /**
   * Takes back the newest change the assistant made that can still be undone, exactly as its card's
   * Undo does: every cell returns to what it held before, including cells that differed. Asked for in
   * chat, so a model never has to imitate an undo by filling the old values in again.
   */
  const undoLatest = useCallback(
    (messageId: string) => {
      const latest = [...undoRef.current.keys()].at(-1);
      if (!latest) {
        dispatch({
          type: "apply",
          id: messageId,
          state: { status: "unavailable", reason: "There’s no change of mine left to undo here. Ctrl+Z in the grid steps back through your own edits." }
        });
        return;
      }
      const availability = undoAvailability(latest);
      if (!availability.ok) {
        dispatch({ type: "apply", id: messageId, state: { status: "unavailable", reason: availability.reason } });
        return;
      }
      undoApply(latest);
      dispatch({ type: "apply", id: messageId, state: { status: "undone" } });
    },
    [undoApply, undoAvailability]
  );

  useEffect(() => {
    undoLatestRef.current = undoLatest;
  }, [undoLatest]);

  const runCommand = useCallback(
    (messageId: string) => {
      const message = thread.messages.find((item) => item.id === messageId);
      if (!message || message.role !== "assistant") return;
      const proposal = message.response.commandProposal;
      if (!proposal) return;

      // The open editor is asked first: saving what is on screen is its own job, and it knows what
      // is in the grid. Only a command no editor claims falls through to the app.
      const editorCommand = registry.getActive()?.commands?.[proposal.commandId];
      const appCommand = adapter.commands?.[proposal.commandId];
      if (!editorCommand && !appCommand) {
        dispatch({
          type: "command",
          id: messageId,
          state: {
            status: "failed",
            message: "That change belongs to a screen that isn’t open any more."
          }
        });
        return;
      }

      dispatch({ type: "command", id: messageId, state: { status: "confirming" } });

      const load = editorCommand || !adapter.getProposalPayload
        ? Promise.resolve(undefined)
        : adapter.getProposalPayload(proposal.proposalId);

      load
        .then((payload) => (editorCommand ? editorCommand() : appCommand!(payload)))
        .then((outcome) => {
          dispatch({
            type: "command",
            id: messageId,
            state: outcome.ok
              ? { status: "done", message: outcome.message }
              : { status: "failed", message: outcome.message }
          });
          void adapter.acknowledgeProposal?.(proposal.proposalId, outcome.ok ? "executed" : "failed");
        })
        .catch((error: unknown) => {
          const described = adapter.describeError?.(error);
          dispatch({
            type: "command",
            id: messageId,
            state: { status: "failed", message: described || getFriendlyRequestError(error) }
          });
          void adapter.acknowledgeProposal?.(proposal.proposalId, "failed");
        });
    },
    [adapter, registry, thread.messages]
  );

  const dismissCommand = useCallback(
    (messageId: string) => {
      const message = thread.messages.find((item) => item.id === messageId);
      dispatch({ type: "command", id: messageId, state: { status: "dismissed" } });
      if (message?.role === "assistant" && message.response.commandProposal) {
        void adapter.acknowledgeProposal?.(message.response.commandProposal.proposalId, "dismissed");
      }
    },
    [adapter, thread.messages]
  );

  /** The message holding the newest revision of each fare-setup draft. */
  const currentFareSetups = useMemo(() => {
    const newest = new Map<string, { messageId: string; revision: number }>();
    for (const message of thread.messages) {
      if (message.role !== "assistant") continue;
      const proposal = message.response.fareSetup;
      if (message.response.resultType !== "fareSetup" || !proposal) continue;
      const seen = newest.get(proposal.proposalId);
      // A later message with the same revision replaces an earlier one: the thread order is the
      // order the server answered in.
      if (!seen || proposal.revision >= seen.revision) {
        newest.set(proposal.proposalId, { messageId: message.id, revision: proposal.revision });
      }
    }
    return new Set([...newest.values()].map((entry) => entry.messageId));
  }, [thread.messages]);

  const fareSetupStatus = useCallback(
    (messageId: string): FareSetupStatus => (currentFareSetups.has(messageId) ? "current" : "superseded"),
    [currentFareSetups]
  );

  const openFareSetup = useCallback(
    (messageId: string) => {
      if (!adapter.fareSetup || !currentFareSetups.has(messageId)) return;
      const message = thread.messages.find((item) => item.id === messageId);
      if (message?.role !== "assistant" || !message.response.fareSetup) return;
      // The host opens its own review screen; it saves through its own API and reports the outcome
      // itself, so the widget does not acknowledge anything here.
      adapter.fareSetup.open(message.response.fareSetup, { messageId });
    },
    [adapter, currentFareSetups, thread.messages]
  );

  const consumeRestoredQuestion = useCallback(() => setRestoredQuestion(null), []);

  const stop = useCallback(() => {
    const runId = pendingRun?.runId;
    abandonInFlight();
    if (runId && adapter.cancelRun) void adapter.cancelRun(runId).catch(() => undefined);
    dispatch({ type: "notice", at: Date.now(), id: nextId("notice"), text: "Stopped. Your editor draft is preserved." });
  }, [abandonInFlight, adapter, pendingRun]);

  const reset = useCallback(() => {
    abandonInFlight();
    undoRef.current.clear();
    actionRef.current.clear();
    setPendingAttachment(null);
    setRestoredQuestion(null);
    setRetryAt(null);
    dispatch({ type: "reset" });
  }, [abandonInFlight]);

  const sectionCapability = useMemo(() => {
    if (!capabilities) return null;
    return capabilities.sections.find((entry) => entry.section === context.section) ?? null;
  }, [capabilities, context.section]);

  const value = useMemo<AssistantContextValue>(
    () => ({
      adapter,
      capabilities,
      sectionCapability,
      activeCapability,
      messages: thread.messages,
      status,
      isOpen,
      setOpen,
      ask,
      reset,
      stop,
      buildContext,
      applyAction,
      undoApply,
      undoAvailability,
      runCommand,
      dismissCommand,
      accepts,
      fareSetupEnabled,
      openFareSetup,
      fareSetupStatus,
      restoredQuestion,
      consumeRestoredQuestion,
      retryAt,
      pendingAttachment,
      setPendingAttachment
    }),
    [
      adapter,
      capabilities,
      sectionCapability,
      activeCapability,
      thread.messages,
      status,
      isOpen,
      ask,
      reset,
      stop,
      buildContext,
      applyAction,
      undoApply,
      undoAvailability,
      runCommand,
      dismissCommand,
      accepts,
      fareSetupEnabled,
      openFareSetup,
      fareSetupStatus,
      restoredQuestion,
      consumeRestoredQuestion,
      retryAt,
      pendingAttachment
    ]
  );

  return (
    <CapabilityRegistryContext.Provider value={registry}>
      <AssistantStateContext.Provider value={value}>{children}</AssistantStateContext.Provider>
    </CapabilityRegistryContext.Provider>
  );
}

/** Refusals that mean "not now" rather than "no": what was typed is kept for another go. */
const TRANSIENT_REFUSALS = new Set([
  "model_rate_limited",
  "model_timeout",
  "model_unavailable",
  "input_too_long",
  // The model ran out of steps or replied in a form that could not be read: the same question
  // usually works on a second go, so it is kept rather than lost.
  "tool_limit_reached",
  "malformed_model_output"
]);

/** How long a queued answer is waited for before the widget gives up and offers to ask again. */
const MAX_POLL_MS = 90_000;

/** What the screen says about the open item, cut to what the schema takes rather than refused. */
function boundSubject(subject: AssistantSubject): AssistantSubject {
  return {
    kind: subject.kind.slice(0, 40),
    title: subject.title.slice(0, 200),
    ...(subject.state ? { state: subject.state.slice(0, 80) } : {}),
    lines: subject.lines.map((line) => line.trim()).filter(Boolean).slice(0, 20).map((line) => line.slice(0, 400))
  };
}

/** At most a dozen short display facts; anything longer is cut rather than refused by the schema. */
function boundFacts(facts: Record<string, string>): Record<string, string> {
  const bounded: Record<string, string> = {};
  for (const [key, value] of Object.entries(facts).slice(0, 12)) {
    const name = key.trim().slice(0, 40);
    const text = String(value ?? "").trim().slice(0, 120);
    if (name && text) bounded[name] = text;
  }
  return bounded;
}
