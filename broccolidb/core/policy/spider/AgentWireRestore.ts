// [LAYER: CORE]
/**
 * Wire v2 session restore — replay agent context without re-auditing disk.
 * Mirrors checkpoint restore in CI systems and LSP workspace state hydration.
 */
import type { SpiderBundleWireFormat, SpiderCheckPhase, SpiderWorkflowStep } from './report-types.js';
import {
  parseAgentBundleWire,
  formatWireDigest,
  toStructuredTelemetry,
  validateWireFormat,
  SPIDER_WIRE_SCHEMA_V2,
} from './AgentSerialization.js';
import { SpiderAuditError } from './spider-errors.js';

export const SPIDER_WIRE_OUTPUT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'SpiderBundleWireFormat',
  type: 'object',
  required: [
    'reportId',
    'verdict',
    'proceed',
    'brief',
    'nextAction',
    'summary',
    'exitCode',
    'agentContext',
    'workflowSummary',
    'priorityQueue',
    'workflow',
    'suggestedCommands',
    'compactLines',
    'clusters',
    'gate',
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
    wireSchema: { enum: ['broccolidb.spider.wire/v1', SPIDER_WIRE_SCHEMA_V2] },
    phase: { enum: ['pre-edit', 'post-edit', 'ci', 'delta'] },
    ndjsonStream: { type: 'string' },
    priorityQueue: { type: 'array' },
    workflow: { type: 'array' },
    suggestedCommands: { type: 'array', items: { type: 'string' } },
    compactLines: { type: 'array', items: { type: 'string' } },
    clusters: { type: 'array' },
    gate: { type: 'object' },
    truncation: { type: 'object' },
  },
} as const;

export interface SpiderNdjsonEvent {
  type: string;
  phase?: SpiderCheckPhase;
  [key: string]: unknown;
}

export interface SpiderWireRestoreResult {
  wire: SpiderBundleWireFormat;
  phase?: SpiderCheckPhase;
  proceed: boolean;
  exitCode: 0 | 1;
  agentContext: string;
  workflowSummary: string;
  workflow: SpiderWorkflowStep[];
  suggestedCommands: string[];
  digest: string;
  telemetry: Record<string, unknown>;
  ndjsonEvents?: SpiderNdjsonEvent[];
}

/** Parse embedded NDJSON check stream from wire v2. */
export function parseNdjsonStream(stream: string): SpiderNdjsonEvent[] {
  const events: SpiderNdjsonEvent[] = [];
  for (const line of stream.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as SpiderNdjsonEvent;
      if (!parsed.type || typeof parsed.type !== 'string') {
        throw new SpiderAuditError('NDJSON event missing type field');
      }
      events.push(parsed);
    } catch (error) {
      throw new SpiderAuditError(
        `Invalid NDJSON line in wire stream: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return events;
}

/** Restore agent handoff from wire-only payload — no disk audit required. */
export function restoreFromWire(wire: unknown, maxCompactLines = 8): SpiderWireRestoreResult {
  const parsed = parseAgentBundleWire(wire);
  const ndjsonEvents =
    parsed.ndjsonStream && parsed.wireSchema === SPIDER_WIRE_SCHEMA_V2
      ? parseNdjsonStream(parsed.ndjsonStream)
      : undefined;

  return {
    wire: parsed,
    phase: parsed.phase,
    proceed: parsed.proceed,
    exitCode: parsed.exitCode,
    agentContext: parsed.agentContext,
    workflowSummary: parsed.workflowSummary,
    workflow: parsed.workflow,
    suggestedCommands: parsed.suggestedCommands,
    digest: formatWireDigest(parsed, maxCompactLines),
    telemetry: toStructuredTelemetry(parsed),
    ndjsonEvents,
  };
}

/** Validate restore payload without building full handoff. */
export function validateWireRestore(wire: unknown): { valid: true; reportId: string; wireSchema?: string } {
  validateWireFormat(wire);
  const w = wire as SpiderBundleWireFormat;
  return { valid: true, reportId: w.reportId, wireSchema: w.wireSchema };
}
