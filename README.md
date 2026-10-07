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

Fill cells address **fare stages** (`fromFareStageId`/`toFareStageId`, the `core.Fares` columns).
Since 0.5 the parsed cell also carries the older `fromStageId`/`toStageId` names with the same
values, so an editor written against them keeps working.

An applied fill remembers the editor's `signature` and the adapter's `scopeKey`. Undo is offered
only while both still match: an undo made for one table or one company never runs against another.

## Who, and for which company (0.5)

```ts
const adapter: AssistantAdapter = {
  app: "ticketing",
  user: { name: session.name, id: session.userId },   // id: stable key for the stored thread
  scopeKey: String(session.companyId),                  // one conversation per company
  permissions: { canUpdate, canDelete, canInsert },     // canInsert is optional
  // …
};
```

The conversation is kept in `sessionStorage` under the app, the user id (the display name only
when no id is given) and the scope. Changing `scopeKey` loads that scope's own thread and drops
anything in flight, so a late answer for the old company cannot land in the new one.

Requests are one at a time, aborted on reset and unmount, and an answer that arrives after either
is ignored. A question that failed, or that the service turned away for now (quota, timeout, too
long), goes back into the composer; when the service says how long to wait, send is held with a
countdown. Messages are limited to 4,000 characters, the same limit as the service; a longer paste
is not cut off, it is refused with the count.

## Fare setup (0.5)

The service can prepare fare stages and fare tables for one or more routes, from typed
instructions, a pasted table or a photo, from any screen. It is negotiated, never assumed:

- the host supplies `adapter.fareSetup.open(proposal, { messageId })`, which opens its own review
  screen; and
- `capabilities.fareSetup.enabled` is true on the service.

Only then does the widget include `fareSetup` in `accepts` with each question (and with an image
upload), and only then does the service return `resultType: "fareSetup"` with a
`FareSetupProposal`. An older widget, or a host without a review screen, never receives one.

The `FareSetupCard` summarises the proposal per route and offers **Review and save**. The widget
saves nothing: the host reviews the proposal, saves each route through its own API under the
user's own permissions, and reports the outcome to the service itself. A draft keeps its
`proposalId` across clarifying turns and bumps `revision`; only the newest revision's card can be
opened, older ones read "Superseded by a newer draft".

With fare setup available, a photo can be attached on any screen: it waits as a chip and goes with
the next message ("Adult fares for route 12 from 1 October"). On the fare editor with a table open,
a photo is still read straight into the grid as before.

The wire contract is `docs/assistant-fare-setup.md` in the Reporting API repository.

## Panel, guidance and bulk fare editing (0.6)

The panel resizes with pointer or keyboard, expands for longer conversations, and fills the
mobile viewport. Stop aborts the active request/poll and keeps editor drafts. Reporting adapters
can retain their own generation and polling endpoints while rendering the shared result cards.

Clients advertise `guidance` and `bulkFareV2`. The latter permits validated fare actions up to
14,400 cells; the service retains its 500-cell limit for older clients. Editor snapshots include
the current unsaved prices, row order, membership and a revision fingerprint. The host rejects
actions prepared for an older revision; Undo restores the preceding draft without saving.

Guidance topics and official references are curated in the Reporting API. Explain this screen
does not itself edit anything. Models without image input show a clear pasted-table alternative.
Provider/model and image capabilities refresh on window focus and the
`ifusion:assistant-configuration-changed` event after administrator activation.

Both frontends currently consume synchronized `packages/assistant` snapshots with
`file:./packages/assistant`. Copy this repository's `src` and `package.json` into both snapshots
when releasing, then run `pnpm install` in each host to refresh the file dependency and lockfile.
The host apps must compile the package through `transpilePackages`.

## Views and explain-this-screen (0.7)

A screen says which part of it is showing, even when there is nothing to edit:

```tsx
useAssistantView(fareMasterId ? "matrix" : "fare-table-list", {
  "Ticket product": "Adult single",
  "Prices set": "3 of 741",
});
```

The view and at most twelve short display facts travel as `context.view` and `context.viewFacts`
(never ids or grids). "Explain this screen" sends `intent: "explainScreen"`; the service answers
from its reviewed text for that screen and view, worded by the model with no tools. Editor
snapshots should send priced draft cells only: a missing cell is an empty one.

Refusals with `tool_limit_reached` or `malformed_model_output` keep the question and offer Try
again. Refusal suggestions come from the open editor, then the screen, then the general examples.
A queued answer is polled for at most 90 seconds. Fill refusals use `editor_precondition`.

## Lora, fare groups and import help (0.8)

The assistant is **Lora, by iFusion Intelligence**: hosts pass `title: "Lora"` and the new
`tagline`. The header is a gradient band (`--asst-header-gradient`, `--asst-brand` to override);
messages carry the speaker's name and the time (`at` on thread messages; older stored threads show
no time). The panel never shows the provider or model; the service only tells administrators.

`route-stages/apply-fare-groups` puts stops into fare groups and creates new groups, naming stops
and groups by the editor's own draft keys (new groups arrive as `ai-new-1`…). The Stage Editor
sends its draft as `editor.data.stops` / `fareGroups`; Undo restores stops and groups together.

`useAssistantView(view, facts, subject)` takes an optional subject — the one item open, such as a
BODS import item under review — with up to twenty lines of what the screen shows about it. The
service explains those lines (they are never treated as instructions). A view with a subject wins
over the screen beneath it.

## Flat fares (0.9)

`flat-fares/prepare` carries a flat fare (ticket class, amount, start date, routes) for the fare
editor's Flat fares form to open filled in. The editor never saves it on the assistant's behalf.

## Commands that open something (0.11)

A `commandProposal` may now carry `args`: a small object for a command that *opens* something
rather than writes it. The editor's command receives them (`commands[id](args)`), and an app-level
command gets them when there is no stored payload. Saves and deletes still carry none, so a save
handler must not read a parameter it does not expect; wrap it (`"x/save": () => save()`).

- `route-stages/find-stops { fromText, toText, viaTexts }` opens the Stage Editor's Find stops
  with the place names in its search boxes. The user still picks the end stops on the map.
- `route-stages/open-route { routeId }` opens a route in the Stage Editor (an app-level command in
  Ticketing, so it works from the route picker too).

Run `node qa/smoke.mjs` with Ticketing installed at the neighboring workspace path, or pass its
absolute directory as the first argument. The fixture uses the actual panel and mocked data;
it checks desktop/mobile sizing, keyboard controls, guidance and serious axe violations.
Screenshots are generated under ignored `qa/screenshots`. This does not replace authenticated
staging/provider checks described in `docs/assistant-upgrade-rollout.md` in the Reporting API.
