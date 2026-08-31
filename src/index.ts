export {
  ASSISTANT_MAX_QUESTION_LENGTH,
  assistantAskRequestSchema,
  assistantCapabilitiesSchema,
  assistantCommandProposalSchema,
  assistantQueryResponseSchema,
  assistantQuestionSchema,
  assistantResultTypes,
  assistantSectionCapabilitySchema,
  isGuid,
  type AssistantAppliedFilter,
  type AssistantAskRequest,
  type AssistantCapabilities,
  type AssistantClarification,
  type AssistantCommandProposal,
  type AssistantEvidence,
  type AssistantInsight,
  type AssistantQueryResponse,
  type AssistantRefusal,
  type AssistantReportProposal,
  type AssistantResultType,
  type AssistantSectionCapability,
  type CommandOutcome
} from "./contracts/assistant-contracts";

export {
  ASSISTANT_CONTEXT_VERSION,
  assistantContextSchema,
  editorContextSnapshotSchema,
  getBrowserTimeZone,
  type AssistantApp,
  type AssistantContext,
  type EditorContextSnapshot
} from "./contracts/section-context";

export {
  FARE_VALUE_PATTERN,
  MAX_UI_ACTION_CELLS,
  fareTriangleApplyCellsSchema,
  routeStagesApplyRowsSchema,
  uiActionBodySchema,
  uiActionKinds,
  uiActionSchema,
  type ApplyDecision,
  type ApplyResult,
  type FareTriangleApplyCells,
  type FareTriangleCell,
  type RouteStagesApplyRows,
  type StageEditableFields,
  type UiAction,
  type UiActionKind,
  type UiActionSource
} from "./contracts/ui-actions";

export type { AssistantAdapter } from "./core/adapter";

export {
  AssistantProvider,
  useAssistant,
  useHasAssistant,
  type ApplyState,
  type AssistantContextInput,
  type AssistantContextValue,
  type CommandState,
  type ThreadMessage
} from "./core/assistant-provider";

export {
  useAssistantEditor,
  type EditorCapability
} from "./core/capability-registry";

export {
  getFriendlyName,
  getFriendlyRequestError,
  getRefusalMessage,
  isSensitiveRequest,
  isWriteRequest,
  maskSensitiveNumbers
} from "./core/guardrails";

export { AssistantWidget } from "./components/assistant-widget";
export { Markdown } from "./components/markdown";
export {
  ClarificationCard,
  CommandProposalCard,
  FriendlyFailure,
  InsightCard,
  QueuedCard,
  RefusalCard,
  SuggestionChips,
  ThinkingLine,
  UiActionCard
} from "./components/result-cards";
