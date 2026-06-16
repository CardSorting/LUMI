// [LAYER: CORE]
/**
 * Agent scenario router — helps LLMs pick the correct Spider entry without guessing.
 * Mirrors GitHub Actions workflow_dispatch inputs and rust-analyzer command palettes.
 */
import type { SpiderCheckPipelineRequest, SpiderCheckRequest } from './report-types.js';
import { normalizeCheckRequest } from './AgentCheckInput.js';

export const SPIDER_AGENT_SCENARIOS = {
  'before-edit': {
    description: 'rust-analyzer flycheck before mutating a file',
    capability: 'check',
    mcpTool: 'spider_forensic_check',
    requestTemplate: {
      phase: 'pre-edit',
      includeTypes: false,
      includeRepairDirectives: true,
    } satisfies Partial<SpiderCheckRequest>,
    requiredParams: ['filePath or filePaths'],
  },
  'after-edit': {
    description: 'cargo check gate on the file just edited',
    capability: 'check',
    mcpTool: 'spider_forensic_check',
    requestTemplate: {
      phase: 'post-edit',
      scope: 'changed-files',
      gatePreset: 'ci',
      includeTypes: false,
      includeRepairDirectives: true,
    } satisfies Partial<SpiderCheckRequest>,
    optionalParams: ['filePath for scoped array scope'],
  },
  'ci-gate': {
    description: 'GitHub Checks hard-stop on changed files',
    capability: 'check',
    mcpTool: 'spider_forensic_check',
    requestTemplate: {
      phase: 'ci',
      scope: 'changed-files',
      gatePreset: 'ci',
      includeRepairDirectives: true,
    } satisfies Partial<SpiderCheckRequest>,
  },
  'pr-review': {
    description: 'Pre-edit → strict CI → baseline delta regression',
    capability: 'runCheckPipeline',
    mcpTool: 'spider_forensic_pipeline',
    requestTemplate: {
      workflowPreset: 'pr-review',
      includeTypes: false,
      includeRepairDirectives: true,
    } satisfies Partial<SpiderCheckPipelineRequest>,
    requiredParams: ['filePath or filePaths', 'setBaseline before delta'],
  },
  'advisory-scan': {
    description: 'Non-blocking structural report',
    capability: 'check',
    mcpTool: 'spider_forensic_check',
    requestTemplate: {
      phase: 'ci',
      scope: 'changed-files',
      gatePreset: 'advisory',
      includeRepairDirectives: true,
    } satisfies Partial<SpiderCheckRequest>,
  },
  'local-edit-loop': {
    description: 'Full local edit loop: pre-edit then post-edit',
    capability: 'runCheckPipeline',
    mcpTool: 'spider_forensic_pipeline',
    requestTemplate: {
      workflowPreset: 'local-edit',
      includeTypes: false,
      includeRepairDirectives: true,
    } satisfies Partial<SpiderCheckPipelineRequest>,
    requiredParams: ['filePath or filePaths'],
  },
} as const;

export type SpiderAgentScenario = keyof typeof SPIDER_AGENT_SCENARIOS;

export function recommendCheckRequest(
  scenario: SpiderAgentScenario,
  params: {
    filePath?: string;
    filePaths?: string[];
    scope?: SpiderCheckRequest['scope'];
    correlationId?: string;
  } = {}
): SpiderCheckRequest | SpiderCheckPipelineRequest {
  const def = SPIDER_AGENT_SCENARIOS[scenario];
  const base = {
    ...def.requestTemplate,
    ...(params.filePath ? { filePath: params.filePath } : {}),
    ...(params.filePaths ? { filePaths: params.filePaths } : {}),
    ...(params.scope !== undefined ? { scope: params.scope } : {}),
    ...(params.correlationId ? { correlationId: params.correlationId } : {}),
  };

  if (def.capability === 'runCheckPipeline') {
    return base as SpiderCheckPipelineRequest;
  }

  const check = base as SpiderCheckRequest;
  if (check.phase === 'post-edit' && params.filePath && !params.scope) {
    check.scope = [params.filePath];
  }
  return normalizeCheckRequest(check);
}

export function formatAgentDecisionGuide(): string {
  const lines = [
    'Spider Agent Scenario Guide',
    '',
    'Pick a scenario — do not call audit() directly unless exploring.',
    '',
  ];
  for (const [key, scenario] of Object.entries(SPIDER_AGENT_SCENARIOS)) {
    lines.push(`## ${key}`);
    lines.push(scenario.description);
    lines.push(`- Capability: ctx.graph.spider.${scenario.capability}()`);
    lines.push(`- MCP: ${scenario.mcpTool}`);
    if ('requiredParams' in scenario && scenario.requiredParams) {
      lines.push(`- Requires: ${scenario.requiredParams.join(', ')}`);
    }
    lines.push('');
  }
  lines.push('Bootstrap: spider_get_catalog | validate: spider_validate_check_request');
  return lines.join('\n');
}
