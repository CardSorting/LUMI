// [LAYER: CORE]
/**
 * Unified failure envelopes for check, pipeline, and scenario MCP/CI hard-stops.
 * Mirrors GitHub Actions failure payloads and SARIF run failures.
 */
import type {
  SpiderAgentFailureEnvelope,
  SpiderCheckPipelineResult,
  SpiderCheckResponse,
  SpiderCheckResult,
  SpiderGithubCheckRun,
  SpiderScenarioResponse,
} from './report-types.js';
import { validateScenarioResponse } from './AgentScenarioResponse.js';
import { toCheckResponse, validateCheckResult, toGithubCheckRun, type ToCheckResponseOptions } from './AgentResponse.js';
import { SpiderAuditError } from './spider-errors.js';

export interface SpiderFailureValidationIssue {
  code: string;
  message: string;
  field?: string;
}

function toFailureValidationIssue(error: unknown): SpiderFailureValidationIssue {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('$schema')) return { code: 'SPI-FAIL-001', message, field: '$schema' };
  if (message.includes('source')) return { code: 'SPI-FAIL-002', message, field: 'source' };
  if (message.includes('exitCode')) return { code: 'SPI-FAIL-003', message, field: 'exitCode' };
  if (message.includes('proceed')) return { code: 'SPI-FAIL-004', message, field: 'proceed' };
  if (message.includes('digest')) return { code: 'SPI-FAIL-005', message, field: 'digest' };
  return { code: 'SPI-FAIL-000', message };
}

export const SPIDER_FAILURE_OUTPUT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'SpiderAgentFailureEnvelope',
  type: 'object',
  required: ['$schema', 'source', 'exitCode', 'proceed', 'digest'],
  properties: {
    $schema: { const: 'broccolidb.spider.failure/v1' },
    source: { enum: ['check', 'scenario', 'pipeline'] },
    exitCode: { const: 1 },
    proceed: { const: false },
    digest: { type: 'string' },
    scenario: { type: 'string' },
    phase: { type: 'string' },
    failedPhase: { type: 'string' },
    response: { type: 'object' },
  },
} as const;

export function isFailureEnvelope(value: unknown): value is SpiderAgentFailureEnvelope {
  try {
    validateFailureEnvelope(value);
    return true;
  } catch {
    return false;
  }
}

export function validateFailureEnvelope(envelope: unknown): asserts envelope is SpiderAgentFailureEnvelope {
  if (!envelope || typeof envelope !== 'object') {
    throw new SpiderAuditError('SpiderAgentFailureEnvelope must be a non-null object');
  }
  const e = envelope as SpiderAgentFailureEnvelope;
  if (e.$schema !== 'broccolidb.spider.failure/v1') {
    throw new SpiderAuditError('failure.$schema must be broccolidb.spider.failure/v1');
  }
  if (!['check', 'scenario', 'pipeline'].includes(e.source)) {
    throw new SpiderAuditError('failure.source must be check | scenario | pipeline');
  }
  if (e.exitCode !== 1) throw new SpiderAuditError('failure.exitCode must be 1');
  if (e.proceed !== false) throw new SpiderAuditError('failure.proceed must be false');
  if (!e.digest || typeof e.digest !== 'string') {
    throw new SpiderAuditError('failure.digest required');
  }
  if (e.source === 'scenario' && !e.scenario) {
    throw new SpiderAuditError('failure.scenario required when source=scenario');
  }
}

export function safeValidateFailureEnvelope(
  envelope: unknown
):
  | { valid: true; envelope: SpiderAgentFailureEnvelope }
  | { valid: false; errors: string[]; issues: SpiderFailureValidationIssue[] } {
  try {
    validateFailureEnvelope(envelope);
    return { valid: true, envelope: envelope as SpiderAgentFailureEnvelope };
  } catch (error) {
    const issue = toFailureValidationIssue(error);
    return { valid: false, errors: [issue.message], issues: [issue] };
  }
}

export function parseFailureJson(json: string): SpiderAgentFailureEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new SpiderAuditError('failure JSON must be valid JSON');
  }
  validateFailureEnvelope(parsed);
  return parsed;
}

export function formatCheckFailure(response: SpiderCheckResponse): SpiderAgentFailureEnvelope {
  return {
    $schema: 'broccolidb.spider.failure/v1',
    source: 'check',
    exitCode: 1,
    proceed: false,
    digest: response.digest,
    phase: response.phase,
    response,
  };
}

export function formatPipelineFailure(pipeline: SpiderCheckPipelineResult): SpiderAgentFailureEnvelope {
  const last = pipeline.phases[pipeline.phases.length - 1];
  const digest = pipeline.response?.digest ?? last?.agentContext?.split('\n')[0] ?? 'Pipeline failed';
  return {
    $schema: 'broccolidb.spider.failure/v1',
    source: 'pipeline',
    exitCode: 1,
    proceed: false,
    digest,
    failedPhase: pipeline.failedPhase,
    phase: pipeline.failedPhase ?? last?.phase,
    response: pipeline.response,
  };
}

export function formatScenarioFailure(response: SpiderScenarioResponse): SpiderAgentFailureEnvelope {
  validateScenarioResponse(response);
  return {
    $schema: 'broccolidb.spider.failure/v1',
    source: 'scenario',
    exitCode: 1,
    proceed: false,
    digest: response.digest,
    scenario: response.scenario,
    failedPhase: response.failedPhase,
    phase: response.failedPhase ?? response.checkResponse?.phase,
    response,
  };
}

/** Build failure envelope from check result — requires exitCode !== 0. */
export function formatFailureFromCheck(
  result: SpiderCheckResult,
  options: ToCheckResponseOptions = {}
): SpiderAgentFailureEnvelope {
  validateCheckResult(result);
  if (result.exitCode === 0) {
    throw new SpiderAuditError('formatFailureFromCheck requires exitCode !== 0');
  }
  return formatCheckFailure(toCheckResponse(result, options));
}

/** CI hard-stop inverse of assertCheckPassed — throws when check passed. */
export function assertCheckFailed(result: SpiderCheckResult, message?: string): SpiderAgentFailureEnvelope {
  validateCheckResult(result);
  if (result.exitCode === 0) {
    throw new SpiderAuditError(message ?? `Spider check passed (phase=${result.phase}) — expected failure`);
  }
  return formatFailureFromCheck(result);
}

export type SpiderFailureNdjsonEvent = {
  type: string;
  source?: SpiderAgentFailureEnvelope['source'];
  phase?: string;
  scenario?: string;
  digest?: string;
  envelope?: SpiderAgentFailureEnvelope;
};

/** NDJSON stream for failure envelopes — CI log parsers and session replay. */
export function toFailureNdjsonStream(envelope: SpiderAgentFailureEnvelope): string {
  validateFailureEnvelope(envelope);
  const lines: string[] = [
    JSON.stringify({
      type: 'spider.failure.start',
      schema: envelope.$schema,
      source: envelope.source,
      phase: envelope.phase,
      scenario: envelope.scenario,
    }),
    JSON.stringify({
      type: 'spider.failure.digest',
      source: envelope.source,
      line: envelope.digest.split('\n')[0],
    }),
    JSON.stringify({
      type: 'spider.failure.envelope',
      envelope,
    }),
    JSON.stringify({
      type: 'spider.failure.end',
      source: envelope.source,
      exitCode: envelope.exitCode,
      proceed: envelope.proceed,
      failedPhase: envelope.failedPhase ?? null,
    }),
  ];
  return lines.join('\n');
}

export function parseFailureNdjsonStream(stream: string): SpiderFailureNdjsonEvent[] {
  const events: SpiderFailureNdjsonEvent[] = [];
  for (const line of stream.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as SpiderFailureNdjsonEvent);
    } catch {
      throw new SpiderAuditError('failure ndjsonStream contains invalid JSON line');
    }
  }
  return events;
}

/** GitHub Checks payload from failure envelope when nested check response is unavailable. */
export function toGithubCheckRunFromFailure(envelope: SpiderAgentFailureEnvelope): SpiderGithubCheckRun {
  validateFailureEnvelope(envelope);
  const nested = envelope.response;
  if (
    nested &&
    typeof nested === 'object' &&
    '$schema' in nested &&
    (nested as { $schema?: string }).$schema === 'broccolidb.spider.check-response/v1'
  ) {
    const run = toGithubCheckRun(nested as SpiderCheckResponse);
    return { ...run, conclusion: 'failure' };
  }
  const title =
    envelope.source === 'scenario'
      ? `Spider scenario failed: ${envelope.scenario ?? 'unknown'}`
      : `Spider ${envelope.source} failed (${envelope.phase ?? envelope.failedPhase ?? 'unknown'})`;
  return {
    name: 'Spider Forensic',
    status: 'completed',
    conclusion: 'failure',
    output: {
      title,
      summary: envelope.digest,
    },
  };
}
