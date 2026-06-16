// [LAYER: CORE]
// @classification PURE
/**
 * Service classification registry for BroccoliDB v22 agent-context discipline.
 * Used by guardrail tests to enforce lifecycle boundaries.
 */
export const AGENT_CONTEXT_CLASSIFICATIONS = {
  AuditService: 'PURE',
  CleanupService: 'OWNED',
  CompactService: 'PURE',
  CoordinatorService: 'OWNED',
  DiagnosisService: 'PURE',
  GraphService: 'PURE',
  InvariantEngine: 'PURE',
  LifecycleRegistry: 'PURE',
  LspService: 'OWNED',
  MailboxService: 'PURE',
  MutexService: 'OWNED',
  QueryLoop: 'PURE',
  ReasoningService: 'PURE',
  ScratchpadService: 'PURE',
  SideQueryService: 'PURE',
  SovereignPolicy: 'PURE',
  SpiderService: 'PURE',
  StreamingToolExecutor: 'PURE',
  StructuralDiscoveryService: 'PURE',
  SuggestionService: 'PURE',
  TaskService: 'PURE',
  TokenService: 'PURE',
  StorageCapability: 'CAPABILITY',
  TelemetryCapability: 'CAPABILITY',
  RecoveryCapability: 'CAPABILITY',
  AuditCapability: 'CAPABILITY',
  CoordinationCapability: 'CAPABILITY',
  QueryCapability: 'CAPABILITY',
  SnapshotCapability: 'CAPABILITY',
} as const;

export type ServiceClassification =
  (typeof AGENT_CONTEXT_CLASSIFICATIONS)[keyof typeof AGENT_CONTEXT_CLASSIFICATIONS];
