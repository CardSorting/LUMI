// [LAYER: CORE]
/**
 * JSON-safe bundle serialization for MCP transport and agent session persistence.
 */
import type { SpiderAgentBundle, SpiderBundleWireFormat, SpiderCheckPhase } from './report-types.js';
import { validateAgentBundleShape, toSuggestedCommands } from './AgentToolkit.js';
import { SpiderAuditError } from './spider-errors.js';

export const SPIDER_WIRE_SCHEMA_V2 = 'broccolidb.spider.wire/v2' as const;

export const SPIDER_BUNDLE_OUTPUT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'SpiderAgentBundle',
  type: 'object',
  required: [
    'reportId',
    'verdict',
    'proceed',
    'brief',
    'nextAction',
    'summary',
    'agentContext',
    'priorityQueue',
    'workflow',
    'suggestedCommands',
  ],
  properties: {
    reportId: { type: 'string' },
    verdict: { enum: ['pass', 'warn', 'fail'] },
    proceed: { type: 'boolean' },
    brief: { type: 'string' },
    nextAction: { type: 'string' },
    summary: { type: 'string' },
    exitCode: { enum: [0, 1] },
    agentContext: { type: 'string' },
    workflowSummary: { type: 'string' },
    priorityQueue: { type: 'array' },
    workflow: { type: 'array' },
    suggestedCommands: { type: 'array', items: { type: 'string' } },
    compactLines: { type: 'array', items: { type: 'string' } },
    clusters: { type: 'array' },
    truncation: { type: 'object' },
  },
} as const;

export function serializeAgentBundle(
  bundle: SpiderAgentBundle,
  agentContext: string,
  workflowSummary: string
): SpiderBundleWireFormat {
  validateAgentBundleShape(bundle);
  return {
    reportId: bundle.reportId,
    verdict: bundle.verdict,
    proceed: bundle.proceed,
    brief: bundle.brief,
    nextAction: bundle.nextAction,
    summary: bundle.summary,
    exitCode: bundle.gate.exitCode,
    agentContext,
    workflowSummary,
    priorityQueue: bundle.priorityQueue,
    workflow: bundle.workflow,
    suggestedCommands: toSuggestedCommands(bundle),
    compactLines: bundle.compactLines,
    clusters: bundle.clusters,
    truncation: bundle.truncation,
    gate: bundle.gate,
  };
}

export function parseAgentBundleWire(data: unknown): SpiderBundleWireFormat {
  if (!data || typeof data !== 'object') {
    throw new SpiderAuditError('SpiderBundleWireFormat must be a non-null object');
  }
  const w = data as SpiderBundleWireFormat;
  validateWireFormat(w);
  return w;
}

/** Fail-closed wire validation for MCP/session restore. */
export function validateWireFormat(wire: unknown): asserts wire is SpiderBundleWireFormat {
  if (!wire || typeof wire !== 'object') {
    throw new SpiderAuditError('SpiderBundleWireFormat must be a non-null object');
  }
  const w = wire as SpiderBundleWireFormat;
  if (!w.reportId) throw new SpiderAuditError('wire.reportId required');
  if (!w.brief) throw new SpiderAuditError('wire.brief required');
  if (!w.agentContext) throw new SpiderAuditError('wire.agentContext required');
  if (!Array.isArray(w.priorityQueue)) throw new SpiderAuditError('wire.priorityQueue required');
  if (!Array.isArray(w.workflow)) throw new SpiderAuditError('wire.workflow required');
  if (!Array.isArray(w.suggestedCommands)) throw new SpiderAuditError('wire.suggestedCommands required');
  if (!w.gate || typeof w.gate.blocked !== 'boolean') throw new SpiderAuditError('wire.gate required');
  if (w.wireSchema === SPIDER_WIRE_SCHEMA_V2 && w.ndjsonStream !== undefined && typeof w.ndjsonStream !== 'string') {
    throw new SpiderAuditError('wire.ndjsonStream must be string when wireSchema is v2');
  }
}

/** Upgrade wire payload to v2 with optional NDJSON stream embed. */
export function enrichWireV2(
  wire: SpiderBundleWireFormat,
  extras: { phase?: SpiderCheckPhase; ndjsonStream?: string }
): SpiderBundleWireFormat {
  validateWireFormat(wire);
  return {
    ...wire,
    wireSchema: SPIDER_WIRE_SCHEMA_V2,
    ...(extras.phase ? { phase: extras.phase } : {}),
    ...(extras.ndjsonStream ? { ndjsonStream: extras.ndjsonStream } : {}),
  };
}

export function serializeAgentBundleV2(
  bundle: SpiderAgentBundle,
  agentContext: string,
  workflowSummary: string,
  extras: { phase?: SpiderCheckPhase; ndjsonStream?: string }
): SpiderBundleWireFormat {
  return enrichWireV2(serializeAgentBundle(bundle, agentContext, workflowSummary), extras);
}

/** Agent context from wire-only session restore (no full bundle on disk). */
export function formatWireDigest(wire: SpiderBundleWireFormat, maxCompactLines = 8): string {
  validateWireFormat(wire);
  const lines = [
    `## Spider Wire — ${wire.verdict.toUpperCase()} (exit ${wire.exitCode})`,
    wire.brief,
    `**Next:** ${wire.nextAction}`,
    wire.workflowSummary,
  ];
  if (wire.compactLines.length > 0) {
    lines.push('', ...wire.compactLines.slice(0, maxCompactLines));
  }
  if (wire.suggestedCommands[0]) {
    lines.push('', `**Run:** \`${wire.suggestedCommands[0]}\``);
  }
  return lines.join('\n');
}

/** OpenTelemetry-inspired structured log event for observability pipelines. */
export function toStructuredTelemetry(wire: SpiderBundleWireFormat): Record<string, unknown> {
  validateWireFormat(wire);
  return {
    event: 'spider.forensic',
    reportId: wire.reportId,
    verdict: wire.verdict,
    proceed: wire.proceed,
    exitCode: wire.exitCode,
    gateConclusion: wire.gate.conclusion,
    blockerCount: wire.priorityQueue.filter((q) => q.kind === 'blocker').length,
    driftCount: wire.priorityQueue.filter((q) => q.kind === 'drift').length,
    repairCount: wire.priorityQueue.filter((q) => q.kind === 'repair').length,
    topCause: wire.clusters[0]?.cause ?? null,
    workflowSteps: wire.workflow.length,
    truncated: Boolean(wire.truncation),
  };
}
