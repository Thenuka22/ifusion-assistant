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
  AssistantCapabilities,
  AssistantQueryResponse,
  AssistantSectionCapability
} from "../contracts/assistant-contracts";
import {
  ASSISTANT_CONTEXT_VERSION,
  getBrowserTimeZone,
  type AssistantApp,
  type AssistantContext
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
  | { status: "applied"; appliedCount: number; skipped: { ref: string; reason: string }[]; canUndo: boolean }
  | { status: "undone" }
  | { status: "unavailable"; reason: string };

export type CommandState =
  | { status: "confirming" }
  | { status: "done"; message: string }
  | { status: "failed"; message: string }
  | { status: "dismissed" };

export type ThreadMessage =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      response: AssistantQueryResponse;
      apply?: ApplyState;
      command?: CommandState;
    }
  | { id: string; role: "error"; text: string; retry?: string }
  | { id: string; role: "notice"; text: string };

type ThreadState = {
  messages: ThreadMessage[];
  sessionId: string;
};

const MAX_THREAD_MESSAGES = 30;

type ThreadAction =
  | { type: "user"; id: string; text: string }
  | { type: "assistant"; id: string; response: AssistantQueryResponse }
  | { type: "replace"; id: string; response: AssistantQueryResponse }
  | { type: "error"; id: string; text: string; retry?: string }
  | { type: "notice"; id: string; text: string }
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
      return { ...state, messages: trim([...state.messages, { id: action.id, role: "user", text: action.text }]) };
    case "assistant":
      return {
        ...state,
        messages: trim([...state.messages, { id: action.id, role: "assistant", response: action.response }])
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
        messages: trim([...state.messages, { id: action.id, role: "error", text: action.text, retry: action.retry }])
      };
    case "notice":
      return { ...state, messages: trim([...state.messages, { id: action.id, role: "notice", text: action.text }]) };
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
      return { messages: [], sessionId: "" };
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
  ask(question: string, options?: { attachmentId?: string }): void;
  reset(): void;
  buildContext(): AssistantContext;
  applyAction(messageId: string): void;
  undoApply(messageId: string): void;
  runCommand(messageId: string): void;
  dismissCommand(messageId: string): void;
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
  const [registry] = useState(() => new CapabilityRegistry());
  const [thread, dispatch] = useReducer(threadReducer, { messages: [], sessionId: "" });
  const [capabilities, setCapabilities] = useState<AssistantCapabilities | null>(null);
  const [status, setStatus] = useState<"idle" | "asking" | "polling">("idle");
  const [isOpen, setOpen] = useState(false);
  const [pendingRun, setPendingRun] = useState<{ messageId: string; runId: string; delay: number } | null>(null);

  // Undo closures belong to the editor that made them, so they live outside reducer state and are
  // dropped on reload — a card then honestly reports that undo is no longer available.
  const undoRef = useRef(new Map<string, () => void>());
  const actionRef = useRef(new Map<string, UiAction>());

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

  const storageKey = `ifusion-assistant-thread:${adapter.app}:${adapter.user.name.trim().toLocaleLowerCase()}`;

  /* capabilities */
  useEffect(() => {
    const controller = new AbortController();
    adapter
      .getCapabilities(controller.signal)
      .then(setCapabilities)
      .catch(() => {
        // A capabilities failure hides the widget entirely rather than showing a broken one.
        setCapabilities(null);
      });
    return () => controller.abort();
  }, [adapter]);

  /* thread persistence */
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ThreadState;
      if (!Array.isArray(parsed.messages)) return;
      // Undo closures did not survive the reload; say so rather than offering a dead button.
      const messages = parsed.messages.map((message) =>
        message.role === "assistant" && message.apply?.status === "applied"
          ? { ...message, apply: { ...message.apply, canUndo: false } }
          : message
      );
      dispatch({ type: "restore", state: { messages, sessionId: parsed.sessionId ?? "" } });
    } catch {
      // Blocked storage is not a reason to fail; the thread simply starts empty.
    }
    // Restoring once per mount is the intent; the key is stable for a signed-in user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(thread));
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
      ...(getBrowserTimeZone() ? { timeZone: getBrowserTimeZone() } : {})
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
      if (result.undo) undoRef.current.set(messageId, result.undo);
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

  const finalize = useCallback(
    (messageId: string, response: AssistantQueryResponse, mode: "add" | "replace") => {
      dispatch(mode === "add" ? { type: "assistant", id: messageId, response } : { type: "replace", id: messageId, response });
      if (response.sessionId) dispatch({ type: "session", sessionId: response.sessionId });

      if (response.resultType === "uiAction" && response.uiAction) {
        actionRef.current.set(messageId, response.uiAction);
        applyToEditor(messageId, response.uiAction);
      }
    },
    [applyToEditor]
  );

  const ask = useCallback(
    (question: string, options?: { attachmentId?: string }) => {
      const trimmed = question.trim();
      if (trimmed.length < 2 || status !== "idle") return;

      dispatch({ type: "user", id: nextId("u"), text: trimmed });
      setStatus("asking");

      const messageId = nextId("a");
      adapter
        .ask({
          question: trimmed,
          context: buildContext(),
          ...(thread.sessionId ? { sessionId: thread.sessionId } : {}),
          ...(options?.attachmentId ? { attachmentId: options.attachmentId } : {})
        })
        .then((response) => {
          if (response.resultType === "queued") {
            dispatch({ type: "assistant", id: messageId, response });
            if (response.sessionId) dispatch({ type: "session", sessionId: response.sessionId });
            setPendingRun({
              messageId,
              runId: response.runId,
              delay: Math.max(1, response.queued?.retryAfterSeconds ?? 2) * 1000
            });
            setStatus("polling");
            return;
          }

          finalize(messageId, response, "add");
          setStatus("idle");
        })
        .catch((error: unknown) => {
          const described = adapter.describeError?.(error);
          dispatch({
            type: "error",
            id: nextId("e"),
            text: described || getFriendlyRequestError(error),
            retry: trimmed
          });
          setStatus("idle");
        });
    },
    [adapter, buildContext, finalize, status, thread.sessionId]
  );

  /* A question that outlived the API's synchronous window is polled until the worker finishes it. */
  useEffect(() => {
    if (!pendingRun) return;

    let cancelled = false;
    const controller = new AbortController();

    const timer = window.setTimeout(() => {
      adapter
        .getRun(pendingRun.runId, controller.signal)
        .then((response) => {
          if (cancelled) return;
          if (response.resultType === "queued") {
            setPendingRun({ ...pendingRun });
            return;
          }
          finalize(pendingRun.messageId, response, "replace");
          setPendingRun(null);
          setStatus("idle");
        })
        .catch(() => {
          if (cancelled) return;
          dispatch({
            type: "error",
            id: nextId("e"),
            text: "I couldn’t collect the completed answer right now. Please try again shortly."
          });
          setPendingRun(null);
          setStatus("idle");
        });
    }, pendingRun.delay);

    return () => {
      cancelled = true;
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

  const undoApply = useCallback((messageId: string) => {
    const undo = undoRef.current.get(messageId);
    if (!undo) return;
    undo();
    undoRef.current.delete(messageId);
    dispatch({ type: "apply", id: messageId, state: { status: "undone" } });
  }, []);

  const runCommand = useCallback(
    (messageId: string) => {
      const message = thread.messages.find((item) => item.id === messageId);
      if (!message || message.role !== "assistant") return;
      const proposal = message.response.commandProposal;
      if (!proposal) return;

      const command = adapter.commands?.[proposal.commandId];
      if (!command) {
        dispatch({
          type: "command",
          id: messageId,
          state: { status: "failed", message: "This app can’t carry out that change." }
        });
        return;
      }

      dispatch({ type: "command", id: messageId, state: { status: "confirming" } });

      const load = adapter.getProposalPayload
        ? adapter.getProposalPayload(proposal.proposalId)
        : Promise.resolve(undefined);

      load
        .then((payload) => command(payload))
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
    [adapter, thread.messages]
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

  const reset = useCallback(() => {
    undoRef.current.clear();
    actionRef.current.clear();
    dispatch({ type: "reset" });
    setPendingRun(null);
    setStatus("idle");
  }, []);

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
      buildContext,
      applyAction,
      undoApply,
      runCommand,
      dismissCommand
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
      buildContext,
      applyAction,
      undoApply,
      runCommand,
      dismissCommand
    ]
  );

  return (
    <CapabilityRegistryContext.Provider value={registry}>
      <AssistantStateContext.Provider value={value}>{children}</AssistantStateContext.Provider>
    </CapabilityRegistryContext.Provider>
  );
}
