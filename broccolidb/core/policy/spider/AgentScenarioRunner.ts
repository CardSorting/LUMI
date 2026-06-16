// [LAYER: CORE]
/**
 * Scenario runner — recommend + execute in one agent round-trip.
 * Mirrors GitHub Actions workflow_dispatch → job run.
 */
import type {
  SpiderCheckPipelineRequest,
  SpiderCheckPipelineResult,
  SpiderCheckRequest,
  SpiderCheckResult,
  SpiderScenarioRunResult,
} from './report-types.js';
import {
  recommendCheckRequest,
  SPIDER_AGENT_SCENARIOS,
  type SpiderAgentScenario,
} from './AgentDecisionGuide.js';
import { formatCheckDigest } from './AgentToolkit.js';

export type ScenarioCheckRunner = (request: SpiderCheckRequest) => Promise<SpiderCheckResult>;
export type ScenarioPipelineRunner = (
  request: SpiderCheckPipelineRequest,
  options?: { maxCompactLines?: number; includeSarifMeta?: boolean }
) => Promise<SpiderCheckPipelineResult>;

export async function runAgentScenario(
  runCheck: ScenarioCheckRunner,
  runPipeline: ScenarioPipelineRunner,
  scenario: SpiderAgentScenario,
  params: {
    filePath?: string;
    filePaths?: string[];
    scope?: SpiderCheckRequest['scope'];
    correlationId?: string;
  } = {},
  options?: { maxCompactLines?: number; includeSarifMeta?: boolean }
): Promise<SpiderScenarioRunResult> {
  const recommended = recommendCheckRequest(scenario, params);
  const def = SPIDER_AGENT_SCENARIOS[scenario];

  if (def.capability === 'runCheckPipeline') {
    const pipeline = await runPipeline(recommended as SpiderCheckPipelineRequest, options);
    const lastPhase = pipeline.phases[pipeline.phases.length - 1];
    const digest =
      pipeline.response?.digest ??
      (lastPhase ? formatCheckDigest(lastPhase, options?.maxCompactLines) : 'Pipeline completed');
    return {
      scenario,
      recommendedRequest: recommended,
      kind: 'pipeline',
      pipeline,
      exitCode: pipeline.exitCode,
      proceed: pipeline.proceed,
      digest,
    };
  }

  const check = await runCheck(recommended as SpiderCheckRequest);
  return {
    scenario,
    recommendedRequest: recommended,
    kind: 'check',
    check,
    exitCode: check.exitCode,
    proceed: check.proceed,
    digest: formatCheckDigest(check, options?.maxCompactLines),
  };
}
