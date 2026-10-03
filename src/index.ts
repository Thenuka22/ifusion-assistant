export {
  ASSISTANT_MAX_QUESTION_LENGTH,
  assistantAskRequestSchema,
  assistantCapabilitiesSchema,
  assistantCommandProposalSchema,
  assistantFareSetupCapabilitySchema,
  assistantOptionalResultTypes,
  assistantQueryResponseSchema,
  assistantQuestionSchema,
  assistantRefusalSchema,
  assistantResultTypes,
  assistantSectionCapabilitySchema,
  isGuid,
  type AssistantAppliedFilter,
  type AssistantAskRequest,
  type AssistantCapabilities,
  type AssistantClarification,
  type AssistantCommandProposal,
  type AssistantEvidence,
  type AssistantFareSetupCapability,
  type AssistantOptionalResultType,
  type AssistantInsight,
  type AssistantQueryResponse,
  type AssistantRefusal,
  type AssistantReportProposal,
  type AssistantResultType,
  type AssistantSectionCapability,
  type CommandOutcome
} from "./contracts/assistant-contracts";

export {
  FARE_SETUP_PRICE_PATTERN,
  FARE_SETUP_VERSION,
  describeFareSetupRoute,
  fareSetupIssueSchema,
  fareSetupPriceSchema,
  fareSetupPriceSources,
  fareSetupProposalSchema,
  fareSetupRouteSchema,
  fareSetupStageSchema,
  fareSetupStopAssignmentSchema,
  fareSetupTableSchema,
  type FareSetupIssue,
  type FareSetupPrice,
  type FareSetupPriceSource,
  type FareSetupProposal,
  type FareSetupRoute,
  type FareSetupStage,
  type FareSetupStopAssignment,
  type FareSetupTable
} from "./contracts/fare-setup";

export {
  ASSISTANT_CONTEXT_VERSION,
  assistantContextSchema,
  assistantSubjectSchema,
  editorContextSnapshotSchema,
  getBrowserTimeZone,
  type AssistantApp,
  type AssistantContext,
  type AssistantSubject,
  type EditorContextSnapshot
} from "./contracts/section-context";

export {
  FARE_VALUE_PATTERN,
  MAX_UI_ACTION_CELLS,
  fareTriangleApplyCellsSchema,
  fareTriangleCellSchema,
  routeStagesApplyRowsSchema,
  routeStagesApplyFareGroupsSchema,
  uiActionBodySchema,
  uiActionKinds,
  uiActionSchema,
  type ApplyDecision,
  type ApplyResult,
  type FareTriangleApplyCells,
  type FareTriangleCell,
  type RouteStagesApplyRows,
  type RouteStagesApplyFareGroups,
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
  type FareSetupStatus,
  type PendingAttachment,
  type ThreadMessage
} from "./core/assistant-provider";

export {
  useAssistantEditor,
  useAssistantView,
  type AssistantView,
  type EditorCapability
} from "./core/capability-registry";

export {
  formatWait,
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
  FareSetupCard,
  FriendlyFailure,
  InsightCard,
  QueuedCard,
  RefusalCard,
  SuggestionChips,
  ThinkingLine,
  UiActionCard
} from "./components/result-cards";
export { editorDraftRevision } from "./core/editor-revision";
