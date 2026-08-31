"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import type { EditorContextSnapshot } from "../contracts/section-context";
import type { ApplyDecision, ApplyResult, UiAction, UiActionKind } from "../contracts/ui-actions";

/**
 * What an editor screen offers the assistant.
 *
 * An editor registers one of these while it is mounted. The assistant can then describe what is on
 * screen and, where the screen allows it, merge a validated change into the editor's own draft
 * state. Nothing here talks to an API: `apply` changes local state and leaves the screen dirty, and
 * the person still presses the editor's Save button.
 */
export interface EditorCapability {
  /** Matches the first segment of the action kinds this editor understands, e.g. "fare-triangle". */
  id: string;
  accepts: UiActionKind[];
  /** Facts about what is open, sent with every question. */
  getSnapshot(): EditorContextSnapshot;
  /** Ids of what is open, e.g. { routeId: 42, fareMasterId: 981 }. */
  getSelection?(): Record<string, number | string>;
  /** Whether this action can be applied right now, and why not when it cannot. */
  canApply(action: UiAction): ApplyDecision;
  /** Merges the action into the editor's draft state and marks it dirty. */
  apply(action: UiAction): ApplyResult;
  /** Present only on screens that accept an image. Its absence hides the upload button. */
  attachments?: {
    kinds: string[];
    accept: string;
    maxBytes: number;
    hint: string;
  };
  suggestions?: string[];
  /**
   * A cheap string that changes when what is open changes.
   *
   * The widget re-reads the snapshot when this moves, so the context chip and any pending proposal
   * follow the user switching route or fare table.
   */
  signature?: string;
}

type Entry = { token: object; read: () => EditorCapability };

/**
 * Which editor the assistant is currently talking to.
 *
 * The registry stores a getter rather than the capability itself, so the entry stays stable across
 * renders while the callbacks always see the editor's current state. The most recently registered
 * editor wins, which matches how these screens mount — one workspace at a time.
 */
export class CapabilityRegistry {
  private entries: Entry[] = [];
  private version = 0;
  private listeners = new Set<() => void>();

  register = (read: () => EditorCapability) => {
    const token = {};
    this.entries.push({ token, read });
    this.bump();
    return () => {
      this.entries = this.entries.filter((entry) => entry.token !== token);
      this.bump();
    };
  };

  /** Announces that the active editor now has something different open. */
  touch = () => this.bump();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** A primitive, so it is safe as a `useSyncExternalStore` snapshot. */
  getVersion = () => this.version;

  getActive = (): EditorCapability | null => {
    const entry = this.entries[this.entries.length - 1];
    return entry ? entry.read() : null;
  };

  private bump() {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

export const CapabilityRegistryContext = createContext<CapabilityRegistry | null>(null);

export function useCapabilityRegistry() {
  return useContext(CapabilityRegistryContext);
}

/**
 * Offers this editor to the assistant for as long as the screen is mounted.
 *
 * Pass `null` while there is nothing to act on — before a fare table is chosen, for instance. The
 * hook is always called, so hook order never changes, and passing null simply withdraws the offer.
 *
 * An editor rendered with no assistant around it — in a unit test, say — registers with nothing and
 * behaves exactly as it did before, so offering itself never becomes a reason to fail.
 */
export function useAssistantEditor(capability: EditorCapability | null): void {
  const registry = useCapabilityRegistry();
  const latest = useRef<EditorCapability | null>(capability);
  latest.current = capability;

  const isOffered = capability !== null;
  const signature = capability?.signature ?? "";

  useEffect(() => {
    if (!registry || !isOffered) return;
    return registry.register(() => {
      const current = latest.current;
      if (!current) throw new Error("The assistant read an editor that is no longer registered.");
      return current;
    });
  }, [registry, isOffered]);

  useEffect(() => {
    if (!registry || !isOffered) return;
    registry.touch();
  }, [registry, isOffered, signature]);
}
