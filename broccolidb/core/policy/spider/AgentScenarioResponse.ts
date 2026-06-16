// [LAYER: CORE]
/**
 * Structured scenario-run responses — mirrors check JSON envelope and GitHub Actions job outputs.
 */
import type { SpiderScenarioResponse, SpiderScenarioRunResult } from './report-types.js';
import { toCheckResponse, type ToCheckResponseOptions } from './AgentResponse.js';
import { toStructuredTelemetry } from './AgentSerialization.js';
import { SpiderAuditError } from './spider-errors.js';

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
  },
} as const;

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

  return response;
}

export function assertScenarioPassed(result: SpiderScenarioRunResult, message?: string): void {
  validateScenarioResult(result);
  if (result.exitCode !== 0 || !result.proceed) {
    throw new SpiderAuditError(
      message ?? `Spider scenario '${result.scenario}' failed (exitCode=${result.exitCode})`
    );
  }
}
