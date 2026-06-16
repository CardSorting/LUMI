// [LAYER: CORE]
/**
 * Agent workflow orchestration — CI pipeline-style phases for LLM agents.
 * Mirrors: GitHub Actions job steps, rust-analyzer flycheck workflow, ESLint --fix dry-run flow.
 */
import type {
  SpiderAgentBundle,
  SpiderGateResult,
  SpiderPlaybookStep,
  SpiderReport,
  SpiderWorkflowStep,
} from './report-types.js';
import { buildAgentContext } from './AgentToolkit.js';
import type { SpiderBundleBudget } from './report-types.js';

export function buildWorkflowPlan(
  bundle: SpiderAgentBundle,
  gate?: SpiderGateResult
): SpiderWorkflowStep[] {
  const steps: SpiderWorkflowStep[] = [];
  let n = 1;

  if (bundle.gate.blocked && bundle.clusters.some((c) => c.cause === 'disk-drift')) {
    steps.push({
      id: `wf-${n++}`,
      phase: 'resync',
      title: 'Resync disk parity (SPI-006) before symbolic repair',
      blocking: true,
      command: 'await ctx.graph.spider.resync({ files: [...] })',
    });
  }

  for (const step of bundle.playbook) {
    steps.push({
      id: `wf-${n++}`,
      phase: step.phase,
      title: step.instruction,
      blocking: step.phase === 'resync' || step.phase === 'repair' || (step.phase === 'verify' && bundle.gate.blocked),
      command: step.command,
      findingIds: step.findingIds,
      directiveIds: step.directiveIds,
    });
  }

  if (steps.length === 0 && bundle.gate.conclusion === 'success') {
    steps.push({
      id: 'wf-1',
      phase: 'verify',
      title: 'Proceed — structural gate passed',
      blocking: false,
    });
  } else if (steps.length === 0 && bundle.gate.blocked) {
    steps.push({
      id: 'wf-1',
      phase: 'investigate',
      title: bundle.nextAction,
      blocking: true,
      command: 'await ctx.graph.spider.gateBundle({ scope: "changed-files" })',
    });
  }

  const conclusion = gate?.conclusion ?? bundle.gate.conclusion;
  if (conclusion !== 'success') {
    steps.push({
      id: `wf-${n++}`,
      phase: 'verify',
      title: 'Re-run gateBundle to confirm resolution',
      blocking: true,
      command: 'await ctx.graph.spider.gateBundle({ scope: "changed-files" })',
    });
  }

  return steps;
}

export function workflowSummary(steps: SpiderWorkflowStep[]): string {
  const blockers = steps.filter((s) => s.blocking).length;
  return `${steps.length} step(s), ${blockers} blocking — next: ${steps.find((s) => s.blocking)?.title ?? steps[0]?.title ?? 'done'}`;
}

/** Full agent handoff: context string + workflow plan. */
export function buildAgentHandoff(
  bundle: SpiderAgentBundle,
  budget?: SpiderBundleBudget,
  gate?: SpiderGateResult
): { agentContext: string; workflow: SpiderWorkflowStep[]; workflowSummary: string } {
  const workflow = buildWorkflowPlan(bundle, gate);
  return {
    agentContext: buildAgentContext(bundle, budget),
    workflow,
    workflowSummary: workflowSummary(workflow),
  };
}
