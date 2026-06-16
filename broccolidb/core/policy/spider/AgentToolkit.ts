// [LAYER: CORE]
/**
 * Unified agent toolkit — bundles forensic output for LLM tools, MCP, and CI.
 * Mirrors: rust-analyzer flycheck groups, ESLint `--format json`, GitHub problem matchers.
 */
import type {
  SpiderAgentBundle,
  SpiderBundleBudget,
  SpiderBundleTruncation,
  SpiderCheckResult,
  SpiderGateBundleResult,
  SpiderGateResult,
  SpiderPriorityItem,
  SpiderProblemMatcher,
  SpiderReport,
} from './report-types.js';
import { buildAgentDigest, toFindingRef } from './AgentDigest.js';
import { clusterFindingsByCause } from './AgentClusters.js';
export { clusterFindingsByCause } from './AgentClusters.js';
import { buildWorkflowPlan } from './AgentWorkflow.js';
import {
  evaluateGate,
  explainFinding,
  toAgentCompact,
  toCompactLines,
  toCodeActions,
  toDiagnosticJson,
  toGithubAnnotations,
  toLspDiagnostics,
  toSarifLog,
} from './AgentFormats.js';
import { SpiderAuditError } from './spider-errors.js';

/** GitHub Actions / VS Code problem matcher patterns for CI log parsing. */
export function toProblemMatchers(): SpiderProblemMatcher[] {
  return [
    {
      owner: 'spider',
      pattern: [
        {
          regexp: '^(.*):(\\d+):(\\d+):\\s+(error|warning|info)\\s+(SPI-\\d+)\\s+\\(([^)]+)\\)\\s+(.+)\\s+\\[([a-f0-9]+)\\]$',
          file: 1,
          line: 2,
          column: 3,
          severity: 4,
          code: 5,
          message: 7,
        },
        {
          regexp: '^(.*):(\\d+):\\s+(error|warning|info)\\s+(SPI-\\d+)',
          file: 1,
          line: 2,
          severity: 3,
          code: 4,
        },
      ],
    },
  ];
}

/** VS Code / GitHub Actions problem matcher config export. */
export function exportProblemMatcherConfig(): { version: 2; problemMatchers: SpiderProblemMatcher[] } {
  return { version: 2, problemMatchers: toProblemMatchers() };
}

export function shouldProceedFromPreflight(audit: SpiderReport): {
  proceed: boolean;
  reason?: string;
  gate: Pick<SpiderGateResult, 'blocked' | 'conclusion' | 'exitCode' | 'reasons'>;
} {
  const gate = evaluateGate(audit);
  return {
    proceed: !gate.blocked || gate.conclusion === 'neutral',
    reason: gate.blocked ? gate.reasons.join('; ') : undefined,
    gate: {
      blocked: gate.blocked,
      conclusion: gate.conclusion,
      exitCode: gate.exitCode,
      reasons: gate.reasons,
    },
  };
}

/** One-line cargo-check style summary for tight token budgets. */
export function buildAgentBrief(
  bundle: Pick<SpiderAgentBundle, 'verdict' | 'summary' | 'gate' | 'clusters' | 'compactLines'>
): string {
  const top = bundle.clusters.find((c) => c.hasBlockers) ?? bundle.clusters[0];
  const cause = top ? `${top.cause}×${top.count}` : 'clean';
  const sample = bundle.compactLines[0];
  const tail = sample ? ` | ${sample}` : '';
  return `[spider:${bundle.verdict}] ${bundle.summary} (${cause}, exit=${bundle.gate.exitCode})${tail}`;
}

const riskRank = { high: 0, medium: 1, low: 2 };

/** Severity-ranked queue — blockers first, then repairs by risk, then warnings. */
export function buildPriorityQueue(report: SpiderReport): SpiderPriorityItem[] {
  const items: SpiderPriorityItem[] = [];
  let rank = 1;

  for (const p of report.diskParity.filter((d) => d.driftStatus !== 'clean')) {
    items.push({
      rank: rank++,
      kind: 'drift',
      filePath: p.filePath,
      action: `Resync disk parity for ${p.filePath} (${p.driftStatus})`,
      verificationCommand: `await ctx.graph.spider.resync({ files: ['${p.filePath}'] })`,
    });
  }

  for (const finding of report.findings.filter((f) => f.severity === 'ERROR')) {
    const ref = toFindingRef(finding);
    items.push({
      rank: rank++,
      kind: 'blocker',
      findingId: ref.findingId,
      diagnosticId: finding.diagnosticId,
      filePath: finding.filePath,
      action: `${finding.diagnosticId}: ${finding.message}`,
    });
  }

  for (const directive of [...report.repairDirectives].sort(
    (a, b) => (riskRank[a.riskLevel] ?? 2) - (riskRank[b.riskLevel] ?? 2)
  )) {
    items.push({
      rank: rank++,
      kind: 'repair',
      directiveId: directive.directiveId,
      diagnosticId: directive.supportingEvidenceIds[0] as SpiderPriorityItem['diagnosticId'],
      filePath: directive.targetFile,
      action: `[${directive.type}] ${directive.rationale}`,
      verificationCommand: directive.verificationCommand,
    });
  }

  for (const finding of report.findings.filter((f) => f.severity === 'WARN')) {
    const ref = toFindingRef(finding);
    items.push({
      rank: rank++,
      kind: 'warning',
      findingId: ref.findingId,
      diagnosticId: finding.diagnosticId,
      filePath: finding.filePath,
      action: `${finding.diagnosticId}: ${finding.message}`,
    });
  }

  return items;
}

/** Apply token/diagnostic caps — clippy / rust-analyzer style limits. */
export function applyBundleBudget(bundle: SpiderAgentBundle, budget: SpiderBundleBudget = {}): SpiderAgentBundle {
  const maxCompact = budget.maxCompactLines ?? bundle.compactLines.length;
  const maxDiag = budget.maxDiagnostics ?? bundle.formats.json.length;
  const maxClusters = budget.maxClusters ?? bundle.clusters.length;
  const maxPlaybook = budget.maxPlaybookSteps ?? bundle.playbook.length;

  const truncation: SpiderBundleTruncation = {
    compactLinesOmitted: Math.max(0, bundle.compactLines.length - maxCompact),
    diagnosticsOmitted: Math.max(0, bundle.formats.json.length - maxDiag),
    clustersOmitted: Math.max(0, bundle.clusters.length - maxClusters),
    playbookStepsOmitted: Math.max(0, bundle.playbook.length - maxPlaybook),
  };

  const hasTruncation = Object.values(truncation).some((n) => n > 0);
  const trimmed: SpiderAgentBundle = {
    ...bundle,
    compactLines: bundle.compactLines.slice(0, maxCompact),
    clusters: bundle.clusters.slice(0, maxClusters),
    playbook: bundle.playbook.slice(0, maxPlaybook),
    priorityQueue: bundle.priorityQueue.slice(0, maxDiag),
    formats: {
      ...bundle.formats,
      json: bundle.formats.json.slice(0, maxDiag),
      githubAnnotations: bundle.formats.githubAnnotations.slice(0, maxDiag),
      codeActions: bundle.formats.codeActions.slice(0, maxDiag),
    },
    ...(hasTruncation ? { truncation } : {}),
  };
  const finalized = finalizeBundle(trimmed);
  return attachWorkflow(finalized);
}

/** Minimal injectable context for tool/LLM prompts — brief + action + compact lines. */
export function buildAgentContext(bundle: SpiderAgentBundle, budget?: SpiderBundleBudget): string {
  const b = budget ? applyBundleBudget(bundle, budget) : bundle;
  const lines = [b.brief, `**Next:** ${b.nextAction}`];
  if (b.compactLines.length > 0) {
    lines.push('', ...b.compactLines);
  }
  if (b.truncation) {
    const omitted =
      b.truncation.compactLinesOmitted +
      b.truncation.diagnosticsOmitted +
      b.truncation.clustersOmitted;
    if (omitted > 0) {
      lines.push(`… truncated ${omitted} item(s); call explain(findingId) or bundle for full report`);
    }
  }
  return lines.join('\n');
}

function finalizeBundle(bundle: SpiderAgentBundle): SpiderAgentBundle {
  return { ...bundle, brief: buildAgentBrief(bundle) };
}

function attachWorkflow(bundle: SpiderAgentBundle, gate?: SpiderGateResult): SpiderAgentBundle {
  const withWorkflow = { ...bundle, workflow: buildWorkflowPlan(bundle, gate) };
  return { ...withWorkflow, suggestedCommands: toSuggestedCommands(withWorkflow) };
}

export function toSuggestedCommands(bundle: SpiderAgentBundle, max = 8): string[] {
  const fromQueue = bundle.priorityQueue
    .map((item) => item.verificationCommand)
    .filter((cmd): cmd is string => Boolean(cmd));
  const fromWorkflow = bundle.workflow
    .filter((step) => step.blocking && step.command)
    .map((step) => step.command!);
  return [...new Set([...fromQueue, ...fromWorkflow])].slice(0, max);
}

export function buildAgentBundle(
  report: SpiderReport,
  workspaceRoot?: string,
  gate?: SpiderGateResult
): SpiderAgentBundle {
  const resolvedGate = gate ?? evaluateGate(report);
  const digest = report.agentDigest ?? buildAgentDigest(report);
  const clusters = clusterFindingsByCause(report);
  const compact = toAgentCompact(report);
  const primaryCluster = clusters.find((c) => c.hasBlockers) ?? clusters[0];

  let nextAction: string;
  if (resolvedGate.conclusion === 'success') {
    nextAction = 'Proceed — no structural blockers in scope.';
  } else if (digest.playbook[0]) {
    nextAction = digest.playbook[0].instruction;
  } else if (primaryCluster) {
    nextAction = `Address ${primaryCluster.cause}: ${primaryCluster.remediationHint}`;
  } else {
    nextAction = 'Review agentNarrative and re-run gate after fixes.';
  }

  const core = finalizeBundle({
    reportId: report.reportId,
    verdict:
      report.verdict ??
      (resolvedGate.conclusion === 'success' ? 'pass' : resolvedGate.conclusion === 'neutral' ? 'warn' : 'fail'),
    proceed: !resolvedGate.blocked || resolvedGate.conclusion === 'neutral',
    gate: {
      blocked: resolvedGate.blocked,
      conclusion: resolvedGate.conclusion,
      exitCode: resolvedGate.exitCode,
      reasons: resolvedGate.reasons,
    },
    summary: digest.summary ?? compact.summary,
    brief: '',
    nextAction,
    narrative: digest.agentNarrative,
    compactLines: compact.lines,
    clusters,
    playbook: digest.playbook,
    problemMatchers: toProblemMatchers(),
    priorityQueue: buildPriorityQueue(report),
    workflow: [],
    suggestedCommands: [],
    formats: {
      sarif: toSarifLog(report, workspaceRoot),
      lsp: toLspDiagnostics(report, workspaceRoot),
      json: toDiagnosticJson(report),
      githubAnnotations: toGithubAnnotations(report),
      codeActions: toCodeActions(report),
    },
  });
  return attachWorkflow(core, resolvedGate);
}

/** Single round-trip: evaluate gate and build full agent bundle. */
export function buildGateBundle(
  report: SpiderReport,
  workspaceRoot?: string,
  gatePolicy?: Parameters<typeof evaluateGate>[1]
): SpiderGateBundleResult {
  const gate = evaluateGate(report, gatePolicy);
  validateGateResult(gate);
  return { gate, bundle: buildAgentBundle(report, workspaceRoot, gate) };
}

export function validateGateResult(gate: unknown): asserts gate is SpiderGateResult {
  if (!gate || typeof gate !== 'object') {
    throw new SpiderAuditError('SpiderGateResult must be a non-null object');
  }
  const g = gate as SpiderGateResult;
  if (typeof g.blocked !== 'boolean') throw new SpiderAuditError('gate.blocked required');
  if (!['success', 'failure', 'neutral'].includes(g.conclusion)) {
    throw new SpiderAuditError('gate.conclusion invalid');
  }
  if (g.exitCode !== 0 && g.exitCode !== 1) throw new SpiderAuditError('gate.exitCode must be 0 or 1');
  if (!g.report?.reportId) throw new SpiderAuditError('gate.report required');
  validateAgentBundleShape(buildAgentBundle(g.report, undefined, g));
}

export function validateAgentBundleShape(bundle: SpiderAgentBundle): void {
  if (!bundle.reportId) throw new SpiderAuditError('bundle.reportId required');
  if (!bundle.brief) throw new SpiderAuditError('bundle.brief required');
  if (!Array.isArray(bundle.formats.json)) throw new SpiderAuditError('bundle.formats.json required');
  if (!Array.isArray(bundle.formats.codeActions)) throw new SpiderAuditError('bundle.formats.codeActions required');
  if (!Array.isArray(bundle.priorityQueue)) throw new SpiderAuditError('bundle.priorityQueue required');
  if (!Array.isArray(bundle.workflow)) throw new SpiderAuditError('bundle.workflow required');
  if (!Array.isArray(bundle.suggestedCommands)) throw new SpiderAuditError('bundle.suggestedCommands required');
  if (!bundle.narrative && bundle.gate.blocked) {
    throw new SpiderAuditError('blocked bundle must include narrative');
  }
  if (bundle.gate.blocked && bundle.playbook.length === 0 && bundle.clusters.some((c) => c.hasBlockers)) {
    throw new SpiderAuditError('blocked bundle with clusters must include playbook steps');
  }
}

/** JSON-schema-shaped descriptor for MCP / function-calling tool registration. */
export const SPIDER_AGENT_TOOL_SCHEMA = {
  name: 'spider_forensic_audit',
  description: 'Run Spider structural forensic audit with typed evidence and repair playbook.',
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: [
          'check',
          'checkAndRespond',
          'runCheckPipeline',
          'preflight',
          'preflightBundle',
          'batchPreflight',
          'audit',
          'gate',
          'gateBundle',
          'resync',
          'bundle',
          'handoff',
          'handoffFromCheck',
          'restoreFromWire',
          'buildCiArtifacts',
          'explain',
        ],
        description: 'check=unified phase router; runCheckPipeline=multi-phase; handoffFromCheck=agent session export',
      },
      phase: {
        type: 'string',
        enum: ['pre-edit', 'post-edit', 'ci', 'delta'],
        description: 'Used with operation=check',
      },
      filePath: { type: 'string', description: 'Target file for preflight' },
      scope: {
        oneOf: [
          { type: 'string', enum: ['all', 'changed-files'] },
          { type: 'array', items: { type: 'string' } },
        ],
      },
      maxCompactLines: { type: 'number', description: 'Cap ESLint-style lines in agent context' },
      maxDiagnostics: { type: 'number', description: 'Cap json/annotation/codeAction count' },
      responseFormat: {
        type: 'string',
        enum: ['markdown', 'json'],
        description: 'check response shape — json returns SpiderCheckResponse envelope',
      },
      includeSarifMeta: { type: 'boolean', description: 'Include SARIF upload metadata in json check response' },
      blockOnFailure: { type: 'boolean', description: 'CI hard-stop when exitCode !== 0' },
      correlationId: { type: 'string', description: 'Intent trace correlation (BroccoliDB v25)' },
      gatePreset: {
        type: 'string',
        enum: ['ci', 'strict', 'advisory'],
        description: 'Named gate policy preset',
      },
      phases: {
        type: 'array',
        items: { type: 'string', enum: ['pre-edit', 'post-edit', 'ci', 'delta'] },
        description: 'Used with operation=runCheckPipeline',
      },
      workflowPreset: {
        type: 'string',
        enum: ['local-edit', 'ci-gate', 'pr-review', 'advisory-scan'],
        description: 'Named pipeline template — alternative to explicit phases',
      },
      stopOnFailure: { type: 'boolean', description: 'Pipeline stops on first failing phase' },
      wireJson: { type: 'string', description: 'Wire v2 JSON for operation=restoreFromWire' },
      includeRepairDirectives: { type: 'boolean', default: true },
      includeTypes: { type: 'boolean', default: true },
    },
    required: ['operation'],
  },
} as const;

export function explainFindingForAgent(report: SpiderReport, findingId: string) {
  const base = explainFinding(report, findingId);
  if (!base) return null;
  const cluster = clusterFindingsByCause(report).find((c) => c.findingIds.includes(findingId));
  return { ...base, cluster };
}

/** Token-efficient post-mutation digest for tool results (gate + compact + first playbook step). */
export function formatMutationDigest(bundle: SpiderAgentBundle, maxCompactLines = 8): string {
  const lines = [
    `## Spider Gate — ${bundle.verdict.toUpperCase()}`,
    bundle.brief,
    `**Next:** ${bundle.nextAction}`,
  ];
  if (bundle.clusters.length > 0) {
    const top = bundle.clusters[0];
    lines.push(`**Root cause:** ${top.cause} (${top.count} finding${top.count === 1 ? '' : 's'})`);
  }
  if (bundle.compactLines.length > 0) {
    lines.push('', ...bundle.compactLines.slice(0, maxCompactLines));
    if (bundle.compactLines.length > maxCompactLines) {
      lines.push(`… +${bundle.compactLines.length - maxCompactLines} more`);
    }
  }
  if (bundle.gate.blocked && bundle.playbook[0]) {
    lines.push('', `**Playbook:** ${bundle.playbook[0].instruction}`);
  }
  const topPriority = bundle.priorityQueue.slice(0, 3);
  if (topPriority.length > 0) {
    lines.push('', '**Priority queue:**');
    for (const item of topPriority) {
      lines.push(`${item.rank}. [${item.kind}] ${item.action}`);
    }
  }
  if (bundle.suggestedCommands[0]) {
    lines.push('', `**Run:** \`${bundle.suggestedCommands[0]}\``);
  }
  return lines.join('\n');
}

/** Compact digest for unified check() results — post-mutation and MCP responses. */
export function formatCheckDigest(result: SpiderCheckResult, maxCompactLines = 8): string {
  const lines = [
    `## Spider ${result.phase} — exit ${result.exitCode}`,
    result.wire?.brief ?? result.agentContext.split('\n')[0] ?? '',
    `**Workflow:** ${result.workflowSummary}`,
  ];
  if (result.bundle?.clusters[0]) {
    const c = result.bundle.clusters[0];
    lines.push(`**Root cause:** ${c.cause} (${c.count}×)`);
  }
  const compact = result.bundle?.compactLines ?? result.wire?.compactLines ?? [];
  if (compact.length > 0) {
    lines.push('', ...compact.slice(0, maxCompactLines));
  }
  const topPriority = result.bundle?.priorityQueue.slice(0, 3) ?? result.wire?.priorityQueue.slice(0, 3) ?? [];
  if (topPriority.length > 0) {
    lines.push('', '**Priority:**');
    for (const item of topPriority) {
      lines.push(`${item.rank}. [${item.kind}] ${item.action}`);
    }
  }
  if (result.suggestedCommands[0]) {
    lines.push('', `**Run:** \`${result.suggestedCommands[0]}\``);
  }
  return lines.join('\n');
}

/** Pre-edit gate digest — rust-analyzer flycheck before mutation. */
export function formatPreflightDigest(result: SpiderCheckResult, maxCompactLines = 6): string {
  const lines = [
    `## Spider Pre-edit — ${result.proceed ? 'PROCEED' : 'BLOCKED'} (exit ${result.exitCode})`,
    result.wire?.brief ?? result.agentContext.split('\n')[0] ?? '',
  ];
  if (!result.proceed) {
    lines.push(`**Blocked:** ${result.workflowSummary}`);
    if (result.suggestedCommands[0]) {
      lines.push(`**Resolve:** \`${result.suggestedCommands[0]}\``);
    }
  }
  const compact = result.bundle?.compactLines ?? result.wire?.compactLines ?? [];
  if (compact.length > 0) {
    lines.push('', ...compact.slice(0, maxCompactLines));
  }
  return lines.join('\n');
}
