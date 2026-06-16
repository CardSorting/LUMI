// [LAYER: CORE]
/**
 * Multi-phase check pipelines — mirrors GitHub Actions job steps and rust-analyzer flycheck chains.
 */
import type {
  SpiderCheckPhase,
  SpiderCheckPipelineRequest,
  SpiderCheckPipelineResult,
  SpiderCheckRequest,
  SpiderCheckResult,
} from './report-types.js';
import { toCheckResponse, type ToCheckResponseOptions } from './AgentResponse.js';

export function aggregatePipelineResults(
  phases: SpiderCheckResult[],
  stopOnFailure: boolean
): Pick<SpiderCheckPipelineResult, 'exitCode' | 'proceed' | 'failedPhase'> {
  for (const phase of phases) {
    if (phase.exitCode !== 0) {
      return { exitCode: 1, proceed: false, failedPhase: phase.phase };
    }
    if (stopOnFailure === false) continue;
  }
  const last = phases[phases.length - 1];
  return {
    exitCode: last?.exitCode ?? 0,
    proceed: last?.proceed ?? true,
    failedPhase: undefined,
  };
}

export function buildPipelineResponse(
  phases: SpiderCheckResult[],
  failedPhase: SpiderCheckPhase | undefined,
  options?: ToCheckResponseOptions
): SpiderCheckPipelineResult['response'] {
  const target =
    (failedPhase ? phases.find((p) => p.phase === failedPhase) : undefined) ?? phases[phases.length - 1];
  return target ? toCheckResponse(target, options) : undefined;
}

export type CheckRunner = (request: SpiderCheckRequest) => Promise<SpiderCheckResult>;

/** Pure pipeline composer — SpiderService injects the async check runner. */
export async function runCheckPipeline(
  runCheck: CheckRunner,
  request: SpiderCheckPipelineRequest,
  responseOptions?: ToCheckResponseOptions
): Promise<SpiderCheckPipelineResult> {
  const stopOnFailure = request.stopOnFailure !== false;
  const phases: SpiderCheckResult[] = [];

  for (const phase of request.phases) {
    const { phases: _ignored, stopOnFailure: _stop, ...checkBase } = request;
    const result = await runCheck({ ...checkBase, phase });
    phases.push(result);
    if (stopOnFailure && result.exitCode !== 0) break;
  }

  const aggregate = aggregatePipelineResults(phases, stopOnFailure);
  return {
    ...aggregate,
    phases,
    response: buildPipelineResponse(phases, aggregate.failedPhase, responseOptions),
  };
}
