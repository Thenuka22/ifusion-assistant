import React from "react";
import { createRoot } from "react-dom/client";
import { AssistantProvider, AssistantWidget, assistantCapabilitiesSchema, assistantQueryResponseSchema, type AssistantAdapter } from "../../src/index";
import "../../src/styles/assistant.css";
import "./preview.css";
const source = "https://www.pti.org.uk/system/files/files/BODS_NeTEx_Fares_profile_v1_1.pdf";
const adapter: AssistantAdapter = {
  app: "ticketing", user: { name: "Demo Operator", id: "qa" }, scopeKey: "qa-company", avatarSrc: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='72'%3E%3Crect width='72' height='72' rx='36' fill='%231b64d1'/%3E%3Ctext x='36' y='47' text-anchor='middle' font-size='34' fill='white'%3EiF%3C/text%3E%3C/svg%3E",
  getCapabilities: async () => assistantCapabilitiesSchema.parse({ enabled: true, provider: "OpenRouter", model: "deepseek/test", supportsImages: false, guidanceAvailable: true, sections: [{ section: "fare-editor", title: "Fare editor", suggestions: ["How do I create fare stages?", "What does the effective date mean?", "What should I check before exporting?"] }] }),
  ask: async () => assistantQueryResponseSchema.parse({ runId: "6d4a3f42-1c2b-4e5f-8a9b-0c1d2e3f4a5b", resultType: "insight", insight: {
    answer: `**Fare stages and member stops**\n\nFare stages group stops for pricing. This application maps each fare stage and its member stops to a NeTEx fare zone.\n\nChoose the route, inspect stops, assign fare groups, then choose the ticket class and effective date before preparing prices.\n\n[NeTEx Fares 1.1: section 5.2, Table 7](${source})`, highlights: [], followUps: ["How are these fares calculated?"], evidence: [],
    guidance: { topic: "membership", title: "Stop membership", version: "2026-10-01", explanation: "Fare stages group member stops.", why: "Membership connects prices to stops.", nextAction: "Review member stops.", steps: [], screens: ["fare-editor"], commonMistakes: ["Timing points and fare stages are different fields.", "These tips do not certify complete compliance."], references: [{ title: "NeTEx Fares 1.1", url: source, section: "5.2, Table 7" }] }
  } }),
  getRun: async () => { throw new Error("No queued fixture runs"); }
};
createRoot(document.getElementById("root")!).render(<AssistantProvider adapter={adapter} context={{ app: "ticketing", section: "fare-editor", moduleTitle: "Fare editor" }}>
  <main><header><strong>iFusion</strong><span>Ticketing workspace · Preview data</span></header><section><p>Pricing</p><h1>Diss – Harleston</h1><p>Adult Single · Live fares · Review your draft before saving.</p><table><thead><tr><th>Destination / Origin</th><th>Diss</th><th>Station</th><th>Harleston</th></tr></thead><tbody><tr><th>Diss</th><td>10.00</td><td></td><td></td></tr><tr><th>Station</th><td>13.00</td><td>13.00</td><td></td></tr><tr><th>Harleston</th><td>16.00</td><td>16.00</td><td>16.00</td></tr></tbody></table><p>Fare groups price travel between stages. Member stops become NeTEx fare zones.</p></section></main>
  <AssistantWidget />
</AssistantProvider>);
