// [LAYER: CORE]
/**
 * Structured scenario-run responses — mirrors check JSON envelope and GitHub Actions job outputs.
 */
import type { SpiderScenarioResponse, SpiderScenarioRunResult, SpiderAgentFailureEnvelope } from './report-types.js';
import { toCheckResponse, toCheckNdjsonStream, type ToCheckResponseOptions } from './AgentResponse.js';
import { formatScenarioFailure } from './AgentFailure.js';
export { formatScenarioFailure } from './AgentFailure.js';
import { toStructuredTelemetry } from './AgentSerialization.js';
import { SpiderAuditError } from './spider-errors.js';

export type SpiderScenarioNdjsonEvent = {
  type: string;
  scenario?: string;
  kind?: string;
  phase?: string;
  line?: string;
  command?: string;
  exitCode?: number;
  proceed?: boolean;
  summary?: unknown;
  telemetry?: unknown;
};

export const SPIDER_SCENARIO_OUTPUT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'SpiderScenarioResponse',
  type: 'object',
  required: ['$schema', 'scenario', 'kind', 'proceed', 'exitCode', 'digest', 'recommendedRequest'],
  properties: {
    $schema: { const: 'broccolidb.spider.scenario-response/v1' },
    scenario: {
      enum: ['before-edit', 'after-edit', 'ci-gate', 'pr-review', 'advisory-scan', 'local-edit-loop'],
    },
    kind: { enum: ['check', 'pipeline'] },
    proceed: { type: 'boolean' },
    exitCode: { enum: [0, 1] },
    digest: { type: 'string' },
    recommendedRequest: { type: 'object' },
    checkResponse: { type: 'object' },
    pipelinePhases: { type: 'array', items: { type: 'string' } },
    failedPhase: { type: 'string' },
    telemetry: { type: 'object' },
    ndjsonStream: { type: 'string' },
  },
} as const;

export function validateScenarioResponse(response: unknown): asserts response is SpiderScenarioResponse {
  if (!response || typeof response !== 'object') {
    throw new SpiderAuditError('SpiderScenarioResponse must be a non-null object');
  }
  const r = response as SpiderScenarioResponse;
  if (r.$schema !== 'broccolidb.spider.scenario-response/v1') {
    throw new SpiderAuditError('scenario.$schema invalid');
  }
  if (!r.scenario || !r.kind) throw new SpiderAuditError('scenario.kind required');
  if (typeof r.proceed !== 'boolean') throw new SpiderAuditError('scenario.proceed required');
  if (r.exitCode !== 0 && r.exitCode !== 1) throw new SpiderAuditError('scenario.exitCode must be 0 or 1');
  if (!r.digest) throw new SpiderAuditError('scenario.digest required');
}

export function validateScenarioResult(result: unknown): asserts result is SpiderScenarioRunResult {
  if (!result || typeof result !== 'object') {
    throw new SpiderAuditError('SpiderScenarioRunResult must be a non-null object');
  }
  const r = result as SpiderScenarioRunResult;
  if (!r.scenario || !r.kind) throw new SpiderAuditError('scenario.kind required');
  if (typeof r.proceed !== 'boolean') throw new SpiderAuditError('scenario.proceed required');
  if (r.exitCode !== 0 && r.exitCode !== 1) throw new SpiderAuditError('scenario.exitCode must be 0 or 1');
  if (!r.digest) throw new SpiderAuditError('scenario.digest required');
}

export function toScenarioResponse(
  result: SpiderScenarioRunResult,
  options: ToCheckResponseOptions = {}
): SpiderScenarioResponse {
  validateScenarioResult(result);
  const response: SpiderScenarioResponse = {
    $schema: 'broccolidb.spider.scenario-response/v1',
    scenario: result.scenario,
    kind: result.kind,
    proceed: result.proceed,
    exitCode: result.exitCode,
    digest: result.digest,
    recommendedRequest: result.recommendedRequest,
  };

  if (result.kind === 'check' && result.check) {
    response.checkResponse = toCheckResponse(result.check, options);
    if (result.check.wire) {
      response.telemetry = toStructuredTelemetry(result.check.wire);
    }
  }

  if (result.kind === 'pipeline' && result.pipeline) {
    response.pipelinePhases = result.pipeline.phases.map((p) => p.phase);
    response.failedPhase = result.pipeline.failedPhase;
    response.checkResponse = result.pipeline.response;
    const last = result.pipeline.phases[result.pipeline.phases.length - 1];
    if (last?.wire) {
      response.telemetry = toStructuredTelemetry(last.wire);
    }
  }

  response.ndjsonStream = toScenarioNdjsonStream(response);
  return response;
}

/** NDJSON stream for scenario runs — mirrors toCheckNdjsonStream / TAP streaming CI parsers. */
export function toScenarioNdjsonStream(response: SpiderScenarioResponse): string {
  validateScenarioResponse(response);
  const lines: string[] = [
    JSON.stringify({
      type: 'spider.scenario.start',
      schema: response.$schema,
      scenario: response.scenario,
      kind: response.kind,
    }),
  ];

  if (response.kind === 'pipeline' && response.pipelinePhases) {
    for (const phase of response.pipelinePhases) {
      lines.push(JSON.stringify({ type: 'spider.scenario.phase', scenario: response.scenario, phase }));
    }
  }

  const checkResponse = response.checkResponse;
  if (checkResponse) {
    const inner = toCheckNdjsonStream(checkResponse)
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const event = JSON.parse(line) as Record<string, unknown>;
        return JSON.stringify({ ...event, scenario: response.scenario, nested: true });
      });
    lines.push(...inner);
  } else {
    lines.push(
      JSON.stringify({
        type: 'spider.scenario.digest',
        scenario: response.scenario,
        line: response.digest.split('\n')[0],
      })
    );
  }

  lines.push(
    JSON.stringify({
      type: 'spider.scenario.end',
      scenario: response.scenario,
      kind: response.kind,
      exitCode: response.exitCode,
      proceed: response.proceed,
      failedPhase: response.failedPhase ?? null,
      telemetry: response.telemetry,
    })
  );
  if (response.exitCode !== 0) {
    lines.push(
      JSON.stringify({
        type: 'spider.scenario.failure',
        scenario: response.scenario,
        schema: 'broccolidb.spider.failure/v1',
        source: 'scenario',
        exitCode: 1,
        proceed: false,
        digest: response.digest,
        failedPhase: response.failedPhase ?? null,
      })
    );
  }
  return lines.join('\n');
}

export function parseScenarioNdjsonStream(stream: string): SpiderScenarioNdjsonEvent[] {
  const events: SpiderScenarioNdjsonEvent[] = [];
  for (const line of stream.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as SpiderScenarioNdjsonEvent);
    } catch {
      throw new SpiderAuditError('scenario ndjsonStream contains invalid JSON line');
    }
  }
  return events;
}

export function assertScenarioPassed(result: SpiderScenarioRunResult, message?: string): void {
  validateScenarioResult(result);
  if (result.exitCode !== 0 || !result.proceed) {
    throw new SpiderAuditError(
      message ?? `Spider scenario '${result.scenario}' failed (exitCode=${result.exitCode})`
    );
  }
}

/** Build failure envelope from scenario run result — requires exitCode !== 0. */
export function formatFailureFromScenario(
  result: SpiderScenarioRunResult,
  options: ToCheckResponseOptions = {}
): SpiderAgentFailureEnvelope {
  validateScenarioResult(result);
  if (result.exitCode === 0) {
    throw new SpiderAuditError('formatFailureFromScenario requires exitCode !== 0');
  }
  return formatScenarioFailure(toScenarioResponse(result, options));
}

/** CI hard-stop inverse of assertScenarioPassed — throws when scenario passed. */
export function assertScenarioFailed(
  result: SpiderScenarioRunResult,
  message?: string
): SpiderAgentFailureEnvelope {
  validateScenarioResult(result);
  if (result.exitCode === 0 && result.proceed) {
    throw new SpiderAuditError(
      message ?? `Spider scenario '${result.scenario}' passed — expected failure`
    );
  }
  return formatFailureFromScenario(result);
}
