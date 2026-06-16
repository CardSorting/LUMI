// [LAYER: CORE]
// @classification PURE
/**
 * BroccoliDB v23 service and capability classification registry.
 */
export const AGENT_CONTEXT_CLASSIFICATIONS = {
  AuditService: 'PURE_SERVICE',
  CleanupService: 'OWNED_SERVICE',
  CompactService: 'PURE_SERVICE',
  CoordinatorService: 'OWNED_SERVICE',
  DiagnosisService: 'PURE_SERVICE',
  GraphService: 'PURE_SERVICE',
  InvariantEngine: 'PURE_SERVICE',
  LifecycleRegistry: 'INTERNAL',
  LspService: 'OWNED_SERVICE',
  MailboxService: 'PURE_SERVICE',
  MutexService: 'OWNED_SERVICE',
  QueryLoop: 'PURE_SERVICE',
  ReasoningService: 'PURE_SERVICE',
  ScratchpadService: 'PURE_SERVICE',
  SideQueryService: 'PURE_SERVICE',
  SovereignPolicy: 'PURE_SERVICE',
  SpiderService: 'PURE_SERVICE',
  StreamingToolExecutor: 'PURE_SERVICE',
  StructuralDiscoveryService: 'PURE_SERVICE',
  SuggestionService: 'PURE_SERVICE',
  TaskService: 'PURE_SERVICE',
  TokenService: 'PURE_SERVICE',
  StorageService: 'OWNED_SERVICE',
  BufferedDbPool: 'OWNED_SERVICE',
  StorageCapability: 'CAPABILITY',
  TelemetryCapability: 'CAPABILITY',
  RecoveryCapability: 'CAPABILITY',
  AuditCapability: 'CAPABILITY',
  CoordinationCapability: 'CAPABILITY',
  QueryCapability: 'CAPABILITY',
  SnapshotCapability: 'CAPABILITY',
  GraphCapability: 'CAPABILITY',
  ReasoningCapability: 'CAPABILITY',
  TaskCapability: 'CAPABILITY',
  ScratchpadCapability: 'CAPABILITY',
  MailboxCapability: 'CAPABILITY',
  AgentContext: 'INTERNAL',
  compatibilityPurge: 'INTERNAL',
} as const;

export type ServiceClassification =
  (typeof AGENT_CONTEXT_CLASSIFICATIONS)[keyof typeof AGENT_CONTEXT_CLASSIFICATIONS];

export const FORBIDDEN_CLASSIFICATIONS = [
  'TRANSITIONAL_BRIDGE',
  'FORBIDDEN',
  'DELETED',
] as const;
