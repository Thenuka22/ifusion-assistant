# @ifusion/assistant

The shared AI assistant widget for the iFusion **Reporting** and **Ticketing** applications.

Both apps mount the same widget and talk to the same assistant service (hosted on the Reporting
API). This package holds everything that is identical between them: the wire contracts, the
conversation state, the editor bridge and the UI. Everything that differs — how a request reaches
the API, which avatar is shown, which editors exist — is supplied by the host app through a single
`AssistantAdapter`.

Architecture and delivery plan:
`TIcketing Package/docs/ai-assistant-architecture.md`.

## Consuming it

The package ships raw TypeScript; each app compiles it with its own toolchain.

```jsonc
// package.json
"dependencies": {
  "@ifusion/assistant": "link:../../ifusion-assistant"   // during development
  // "@ifusion/assistant": "git+ssh://…/ifusion-assistant.git#v0.1.0"   // pinned tag
}
```

```ts
// next.config.ts
transpilePackages: ["@ifusion/assistant"]
```

```css
/* globals.css — import once, then map the tokens onto the app's own palette */
@import "@ifusion/assistant/styles.css";

:root {
  --asst-fg-1: var(--fg-1);
  --asst-fg-3: var(--fg-3);
  --asst-fg-4: var(--fg-4);
  --asst-surface-0: var(--surface-0);
  --asst-surface-1: var(--surface-1);
  --asst-border: var(--border);
  --asst-accent: var(--accent);
  /* …see src/styles/assistant.css for the full list */
}
```

Peer dependencies (`react`, `react-dom`, `zod`, `lucide-react`) come from the host app, so there is
only ever one copy of each. The package itself has **no runtime dependencies**: the markdown in an
answer is rendered by a small built-in renderer that emits React nodes and never raw HTML, which
keeps the surface both small and safe.

## Mounting

```tsx
<AssistantProvider adapter={adapter} context={{ app: "ticketing", section, module, moduleTitle, zoneId }}>
  {children}
  <AssistantWidget />
</AssistantProvider>
```

Mount it in the authenticated layout so the conversation survives navigation, and so editors deeper
in the tree can register with it.

## Letting an editor be filled

An editor offers itself to the assistant while it is on screen:

```tsx
useAssistantEditor(fareMasterId ? {
  id: "fare-triangle",
  accepts: ["fare-triangle/apply-cells"],
  signature: `${routeId}:${fareMasterId}:${readOnly}`,
  getSnapshot: () => ({ capabilityId: "fare-triangle", label, readOnly, data: { stages } }),
  getSelection: () => ({ routeId, fareMasterId }),
  canApply,
  apply,
} : null);
```

`apply` merges the change into the editor's **own draft state** and marks it dirty. It never calls
an API. The person reviews the highlighted cells and presses the editor's existing Save button, so
every write goes through the same endpoint, the same validation and the same permissions as one
typed by hand.

Real writes asked for in chat ("save it", "delete this") arrive as a `commandProposal` instead: the
widget shows a confirmation card, and on confirm the host app runs the command from its own
`adapter.commands` map — again, its ordinary endpoint under the user's own token.
