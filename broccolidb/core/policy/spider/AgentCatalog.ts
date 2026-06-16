// [LAYER: CORE]
/**
 * Agent toolkit catalog — bootstrap payload for MCP clients and LLM system prompts.
 * Mirrors ESLint shareable configs + rustc diagnostic documentation bundles.
 */
import type { SpiderGatePolicy } from './report-types.js';
import { SPIDER_AGENT_TOOL_SCHEMA, exportProblemMatcherConfig } from './AgentToolkit.js';
import { SPIDER_CHECK_OUTPUT_SCHEMA } from './AgentResponse.js';
import { SPIDER_WIRE_OUTPUT_SCHEMA } from './AgentWireRestore.js';
import { SPIDER_MCP_TOOL_NAMES } from './spider-mcp-tools.js';
import {
  SPIDER_CHECK_INPUT_SCHEMA,
  SPIDER_PIPELINE_INPUT_SCHEMA,
  SPIDER_WORKFLOW_PRESETS,
} from './AgentCheckInput.js';
import { getSpiderSchemaRegistry } from './AgentSchemaRegistry.js';
import { SPIDER_AGENT_SCENARIOS, formatAgentDecisionGuide, formatAgentQuickStart } from './AgentDecisionGuide.js';
import { getAgentMethodGroups } from './spider-agent-methods.js';
import { SPIDER_FAILURE_OUTPUT_SCHEMA } from './AgentFailure.js';

export { validateCheckRequest, validateCheckPipelineRequest, safeValidateCheckRequest, safeValidateCheckPipelineRequest } from './AgentCheckInput.js';

export const SPIDER_PHASE_WORKFLOW = [
  {
    phase: 'pre-edit' as const,
    when: 'Before editing a file or neighborhood',
    industryAnalog: 'rust-analyzer flycheck / LSP pre-mutation gate',
    requires: ['filePath or filePaths'],
    mcp: 'spider_forensic_check',
  },
  {
    phase: 'post-edit' as const,
    when: 'Immediately after local edits',
    industryAnalog: 'cargo check / ESLint --fix-dry-run gate',
    requires: ['scope optional'],
    mcp: 'spider_forensic_check',
  },
  {
    phase: 'ci' as const,
    when: 'CI hard-stop on changed files',
    industryAnalog: 'GitHub Checks / SARIF upload gate',
    requires: ['scope optional', 'gatePreset optional'],
    mcp: 'spider_forensic_check',
  },
  {
    phase: 'delta' as const,
    when: 'Regression vs baseline or session',
    industryAnalog: 'PR introduced-finding delta / junit regression',
    requires: ['baseline set via setBaseline or sessionDelta'],
    mcp: 'spider_forensic_check',
  },
] as const;

export const SPIDER_PREFERRED_ENTRYPOINTS = {
  unifiedCheck: 'ctx.graph.spider.check({ phase })',
  mcpCheck: 'spider_forensic_check',
  mcpBootstrap: 'spider_get_catalog',
  mcpValidate: 'spider_validate_check_request',
  mcpPipeline: 'spider_forensic_pipeline',
  ciArtifacts: 'writeCiArtifacts | spider_export_ci_artifacts',
  sessionRestore: 'restoreFromWire | spider_restore_wire',
  catalog: 'getAgentToolkitCatalog()',
  scenarioRun: 'runAgentScenario(scenario, { filePath })',
  schemaExport: 'writeSchemaRegistry | spider_export_schemas',
} as const;

export const SPIDER_GATE_POLICY_PRESETS: Record<'ci' | 'strict' | 'advisory', SpiderGatePolicy> = {
  ci: {
    blockOnErrors: true,
    blockOnWarnings: false,
    blockOnDegraded: false,
    blockOnDrift: true,
  },
  strict: {
    blockOnErrors: true,
    blockOnWarnings: true,
    blockOnDegraded: true,
    blockOnDrift: true,
  },
  advisory: {
    blockOnErrors: false,
    blockOnWarnings: false,
    blockOnDegraded: false,
    blockOnDrift: false,
  },
};

export const SPIDER_AGENT_RUNBOOK = `Spider Forensic Agent Runbook (v20)

Doctrine: Spider proves structural truth with evidence. Never mutate during audit. Never execute repairs inside Spider.

Workflow (preferred):
1. check({ phase: 'pre-edit', filePath }) before editing high-impact files
2. Make changes
3. check({ phase: 'post-edit' | 'ci', scope: 'changed-files' }) — hard stop on exitCode === 1
4. compareBaseline() / sessionDelta() for regressions
5. Follow playbook: resync (SPI-006 drift) → repair → verify

Phase map:
- pre-edit: rust-analyzer flycheck before edit
- post-edit/ci: cargo check gate
- delta: PR introduced-finding regression

On failure: formatCheckFailure / formatPipelineFailure / formatScenarioFailure → broccolidb.spider.failure/v1.
Or formatCheckDigest / toCheckResponse(json). Cite findingId in explain(report, findingId).
Persist wire v2 for session restore: handoff(bundle) or restoreFromWire(wire).
CI: buildCiArtifacts / buildScenarioCiArtifacts + write*CiArtifacts, or MCP spider_export_ci_artifacts.`;

export function formatCatalogPrompt(catalog: {
  runbook: string;
  mcpTools: readonly string[] | string[];
  gatePresets: Record<string, unknown>;
  phaseWorkflow: readonly { phase: string; when: string }[];
  preferredEntrypoints: { mcpBootstrap: string };
}): string {
  const phases = catalog.phaseWorkflow.map((p) => `- ${p.phase}: ${p.when}`).join('\n');
  return [
    catalog.runbook,
    '',
    'Phases:',
    phases,
    '',
    `MCP: ${catalog.mcpTools.join(', ')}`,
    `Gate presets: ${Object.keys(catalog.gatePresets).join(', ')}`,
    `Workflow presets: ${'workflowPresets' in catalog ? Object.keys(catalog.workflowPresets as object).join(', ') : 'local-edit, ci-gate, pr-review, advisory-scan'}`,
    `Bootstrap: ${catalog.preferredEntrypoints.mcpBootstrap}`,
    `Validate: spider_validate_check_request`,
    `Validate failure: spider_validate_failure`,
    `Run scenario: spider_run_scenario`,
    `Export schemas: spider_export_schemas`,
  ].join('\n');
}

export function getAgentToolkitCatalog() {
  const base = {
    schema: 'broccolidb.spider.agent-catalog/v1',
    runbook: SPIDER_AGENT_RUNBOOK,
    toolSchema: SPIDER_AGENT_TOOL_SCHEMA,
    mcpTools: [...SPIDER_MCP_TOOL_NAMES],
    checkOutputSchema: SPIDER_CHECK_OUTPUT_SCHEMA,
    checkInputSchema: SPIDER_CHECK_INPUT_SCHEMA,
    pipelineInputSchema: SPIDER_PIPELINE_INPUT_SCHEMA,
    wireOutputSchema: SPIDER_WIRE_OUTPUT_SCHEMA,
    failureOutputSchema: SPIDER_FAILURE_OUTPUT_SCHEMA,
    problemMatchers: exportProblemMatcherConfig(),
    gatePresets: SPIDER_GATE_POLICY_PRESETS,
    workflowPresets: SPIDER_WORKFLOW_PRESETS,
    agentScenarios: SPIDER_AGENT_SCENARIOS,
    schemaRegistry: getSpiderSchemaRegistry(),
    phaseWorkflow: [...SPIDER_PHASE_WORKFLOW],
    preferredEntrypoints: { ...SPIDER_PREFERRED_ENTRYPOINTS },
    methodGroups: getAgentMethodGroups(),
  };
  return {
    ...base,
    promptDigest: formatCatalogPrompt(base),
    decisionGuide: formatAgentDecisionGuide(),
    quickStart: formatAgentQuickStart(),
  };
}
