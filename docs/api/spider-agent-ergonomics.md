# Spider Agent Ergonomics

Spider reports are designed for **agents first** — structured like SARIF runs, ESLint JSON output, LSP `PublishDiagnostics`, and GitHub Checks conclusions.

## Agent toolkit catalog

Bootstrap MCP/LLM clients with one call:

```typescript
const catalog = ctx.graph.spider.getAgentToolkitCatalog();
// catalog.runbook — agent system prompt doctrine
// catalog.promptDigest — token-efficient bootstrap for LLM system prompts
// catalog.toolSchema — function-calling schema
// catalog.mcpTools — native MCP tool names (includes spider_get_catalog)
// catalog.phaseWorkflow — structured pre-edit → ci → delta map
// catalog.preferredEntrypoints — canonical entry points
// catalog.checkOutputSchema / wireOutputSchema
// catalog.gatePresets — ci | strict | advisory
// catalog.problemMatchers — VS Code / GitHub Actions parsers

// catalog.checkInputSchema / pipelineInputSchema — JSON Schema for requests
// catalog.workflowPresets — local-edit | ci-gate | pr-review | advisory-scan

// catalog.schemaRegistry — all JSON Schemas with stable $id URIs
// catalog.agentScenarios — before-edit | after-edit | ci-gate | pr-review | …
// catalog.decisionGuide — markdown scenario picker for LLM system prompts

// Scenario router (no guessing):
const req = ctx.graph.spider.recommendCheckRequest('before-edit', { filePath: 'src/foo.ts' });
await ctx.graph.spider.check(req);

// Or one-shot scenario run (recommend + execute):
const run = await ctx.graph.spider.runAgentScenario('before-edit', { filePath: 'src/foo.ts' });
const json = await ctx.graph.spider.runAgentScenarioAndRespond('before-edit', { filePath: 'src/foo.ts' });
// MCP: spider_run_scenario({ scenario: 'before-edit', filePath: 'src/foo.ts', responseFormat: 'json' })
// MCP: spider_export_schemas({ outputDir: './spider-schemas' })

// Normalize defaults before check:
const normalized = ctx.graph.spider.normalizeCheckRequest({ phase: 'ci' });
// → { phase: 'ci', scope: 'changed-files', gatePreset: 'ci', includeRepairDirectives: true, … }

// Workflow preset pipeline:
await ctx.graph.spider.runCheckPipeline({
  workflowPreset: 'local-edit',
  filePath: 'src/foo.ts',
});

// Or MCP bootstrap (no audit run):
// spider_get_catalog({ responseFormat: 'markdown' | 'json' })
```

Gate presets on check:

```typescript
await ctx.graph.spider.check({ phase: 'ci', scope: 'changed-files', gatePreset: 'strict' });
ctx.graph.spider.validateCheckRequest({ phase: 'pre-edit', filePath: 'src/foo.ts' });
```

## Quick start

### Unified check (single MCP entry)

```typescript
// Pre-edit
const pre = await ctx.graph.spider.check({
  phase: 'pre-edit',
  filePath: 'src/foo.ts',
  bundleBudget: { maxCompactLines: 5 },
});

// Post-edit / CI
const post = await ctx.graph.spider.check({ phase: 'ci', scope: 'changed-files' });
if (post.exitCode === 1) console.log(post.agentContext, post.workflowSummary);

// Regression delta
const delta = await ctx.graph.spider.check({ phase: 'delta' });
```

### Pre-edit gate (preflightBundle — preferred)

```typescript
const pre = await ctx.graph.spider.preflightBundle('src/core/provider.ts');
if (!pre.proceed) {
  console.log(ctx.graph.spider.agentContext(pre.bundle, { maxCompactLines: 5 }));
}
```

### Pre-edit gate (preflight)

```typescript
const gate = await ctx.graph.spider.preflight('src/core/provider.ts');
if (!gate.audit.passed) {
  console.log(gate.audit.agentDigest!.agentNarrative);
  for (const step of gate.audit.agentDigest!.playbook) {
    console.log(step.step, step.phase, step.instruction);
  }
}
```

### CI gate + bundle (preferred)

```typescript
const { gate, bundle } = await ctx.graph.spider.gateBundle({ scope: 'changed-files' });
if (gate.blocked) {
  console.log(bundle.brief);       // one-line cargo-check style
  console.log(bundle.nextAction); // first playbook step
  process.exit(gate.exitCode);
}
```

### Token-efficient compact view

```typescript
const report = await ctx.graph.spider.audit({ scope: ['src/foo.ts'] });
const compact = ctx.graph.spider.compact(report);
// compact.lines — ESLint-style: file:line:col: severity rule message [findingId]
// compact.playbook — ordered resync → repair → verify steps
// compact.gate — blocked, conclusion, exitCode
```

## Agent bundle (single payload)

```typescript
const gate = await ctx.graph.spider.gate({ scope: 'changed-files' });
const bundle = ctx.graph.spider.bundle(gate.report);

// bundle.proceed — should agent continue?
// bundle.brief — one-line summary
// bundle.nextAction — one-line what to do first
// bundle.clusters — root-cause groups (import-contract, type-soundness, disk-drift, …)
// bundle.compactLines — ESLint-style lines
// bundle.narrative — full markdown
// bundle.formats.sarif / .lsp — CI + editor shapes
// bundle.problemMatchers — GitHub Actions log parsing
```

Or use **`batchPreflight`** for multi-file edits:

```typescript
const batch = await ctx.graph.spider.batchPreflight(['src/a.ts', 'src/b.ts']);
if (!batch.proceed) console.log(batch.bundle.nextAction);
```

## Baseline comparison (PR delta)

```typescript
const before = await ctx.graph.spider.audit({ scope: 'changed-files' });
ctx.graph.spider.setBaseline(before);

// ... agent makes changes ...

const after = await ctx.graph.spider.audit({ scope: 'changed-files' });
const delta = ctx.graph.spider.compareBaseline(after);
console.log(delta!.narrative);

const session = ctx.graph.spider.sessionDelta();
if (session) console.log(session.narrative);
```

## MCP / function-calling schema

```typescript
const schema = ctx.graph.spider.toolSchema();
// Register schema with MCP tool: spider_forensic_audit

// Native MCP server tool (stdio):
// spider_forensic_check({ phase: 'pre-edit' | 'post-edit' | 'ci' | 'delta', filePath?, scope? })
```

### Check-first digest (post-mutation)

Tool mirror and MCP use `check({ phase })` + `formatCheckDigest()` — not raw gate output:

```typescript
const post = await ctx.graph.spider.check({
  phase: 'post-edit',
  scope: ['src/foo.ts'],
  neighborhoodDepth: 1,
});
if (post.exitCode !== 0) console.log(ctx.graph.spider.formatCheckDigest(post));
```

### JSON check response (MCP / CI)

```typescript
const result = await ctx.graph.spider.check({ phase: 'ci', scope: 'changed-files' });
const json = ctx.graph.spider.toCheckResponse(result, { includeSarifMeta: true });
// json.$schema === 'broccolidb.spider.check-response/v1'
// json.summary — errors/warnings/byCause rollup
// json.ci.githubAnnotations — ::error file=… workflow commands
// json.ci.githubStepSummary — write to $GITHUB_STEP_SUMMARY
// json.ci.sarif — artifact metadata for Code Scanning upload
// json.problemMatchers — VS Code / GitHub Actions log parsers

ctx.graph.spider.assertCheckPassed(result); // throws SpiderAuditError on exitCode !== 0
```

MCP tool `spider_forensic_check` accepts `responseFormat: 'json'` for the full envelope.

### Multi-phase pipeline

```typescript
const pipeline = await ctx.graph.spider.runCheckPipeline({
  phases: ['pre-edit', 'ci', 'delta'],
  filePath: 'src/foo.ts',
  scope: 'changed-files',
});
if (pipeline.exitCode !== 0) console.log(pipeline.response?.digest);
// MCP: spider_forensic_pipeline({ phases: ['pre-edit', 'ci'] })
```

### NDJSON streaming + GitHub Checks API

```typescript
const result = await ctx.graph.spider.check({ phase: 'ci', scope: 'changed-files' });
const ndjson = ctx.graph.spider.toCheckNdjsonStream(result);
// Events: spider.check.start | .annotation | .compact | .summary | .end

const checkRun = ctx.graph.spider.toGithubCheckRun(result);
// GitHub REST createCheckRun payload

const matchers = ctx.graph.spider.getProblemMatcherConfig();
// VS Code / GitHub Actions problem matcher JSON (version 2)
```

### SARIF upload helper

```typescript
const report = await ctx.graph.spider.audit({ scope: 'changed-files' });
const { artifactName, sarif, exitCode } = ctx.graph.spider.prepareSarifUpload(report);
// Upload sarif to GitHub Code Scanning; exit with exitCode in CI
```

### Pre-edit gate (tool mirror)

Before file mutations, `StreamingToolExecutor` runs `check({ phase: 'pre-edit' })` when `forensicPreEditGate` is enabled (default). Set `failOnPreEditBlockers: true` to hard-stop.

```typescript
const pre = await ctx.graph.spider.check({ phase: 'pre-edit', filePath: 'src/foo.ts' });
console.log(ctx.graph.spider.formatPreflightDigest(pre));
```

### CI artifact export

```typescript
const result = await ctx.graph.spider.check({ phase: 'ci', scope: 'changed-files' });
const artifacts = ctx.graph.spider.buildCiArtifacts(result, { includeSarifMeta: true });
await ctx.graph.spider.writeCiArtifacts('./spider-out', result);
// MCP: spider_export_ci_artifacts({ phase: 'ci', outputDir: './spider-out' })
```

### Handoff v2

```typescript
const handoff = ctx.graph.spider.handoff(bundle, undefined, { phase: 'ci' });
// handoff.wire.wireSchema === v2, handoff.checkResponse, ndjsonStream embedded

const fromCheck = ctx.graph.spider.handoffFromCheck(checkResult);
```

Pass `correlationId` on `check()` for intent traces: `ctx.audit.traces({ correlationId })`.

### Wire format v2 + session restore

Check results embed NDJSON streams in wire payloads for session restore:

```typescript
const result = await ctx.graph.spider.check({ phase: 'ci', scope: ['src/foo.ts'] });
// result.wire.wireSchema === 'broccolidb.spider.wire/v2'
// result.wire.ndjsonStream — replayable CI event log

// Restore without re-auditing disk
const restored = ctx.graph.spider.restoreFromWire(result.wire!);
// restored.agentContext, restored.digest, restored.ndjsonEvents

// MCP: spider_restore_wire({ wireJson: JSON.stringify(result.wire) })
```

MCP `spider_forensic_check` and `spider_forensic_pipeline` accept `blockOnFailure: true` for CI hard-stop semantics.

### Intent routing (v25)

Spider capability operations emit typed `inputSummary.intentKind` traces (`forensic-check`, `check-pipeline`, `preflight`, `wire-restore`, …) for `ctx.audit.traces({ correlationId })`.

### Alternate entry parity

`ctx.audit.spider` exposes the same agent-ergonomics methods as `ctx.graph.spider` (structural ops like `applyChanges` remain graph-only).

### Wire-only session restore

When persisting only the wire payload (token budget):

```typescript
const wire = ctx.graph.spider.serializeBundle(bundle).wire;
ctx.graph.spider.validateWire(wire);
console.log(ctx.graph.spider.formatWireDigest(wire));
console.log(ctx.graph.spider.toStructuredTelemetry(wire)); // OTel-style log event
```

## Root-cause clusters

Findings are grouped by `cause`:

| Cause | SPI |
| --- | --- |
| `import-contract` | SPI-001 |
| `type-soundness` | SPI-002 |
| `structural-cycle` | SPI-004 |
| `layer-violation` | SPI-005 |
| `disk-drift` | SPI-006 |
| `compiler-unavailable` | SPI-009 |

## Export formats

| Method | Industry analog | Use |
| --- | --- | --- |
| `checkAndRespond(request)` | check + JSON envelope | Single round-trip agents |
| `runCheckPipeline({ phases })` | Multi-phase CI chain | pre-edit → ci → delta |
| `toCheckNdjsonStream(result)` | NDJSON event stream | Streaming CI parsers |
| `toGithubCheckRun(result)` | GitHub Checks API payload | createCheckRun integration |
| `getProblemMatcherConfig()` | VS Code problem matchers v2 | CI log → editor navigation |
| `toCheckResponse(result)` | ESLint JSON / Checks API envelope | MCP `responseFormat=json`, CI agents |
| `getCheckOutputSchema()` | JSON Schema for check response | MCP output validation |
| `prepareSarifUpload(report)` | SARIF artifact + exit code | GitHub Code Scanning upload |
| `buildDiagnosticSummary(report)` | Severity/SPI rollup | Dashboards, step summaries |
| `assertCheckPassed(result)` | Fail-closed CI guard | `process.exit` replacement |
| `handoffFromCheck(result)` | Handoff from check result | Agent-to-agent with v2 wire |
| `buildCiArtifacts(result)` | CI file bundle manifest | GitHub Actions upload |
| `writeCiArtifacts(dir, result)` | Write artifacts to disk | CI pipeline integration |
| `restoreFromWire(wire)` | Session checkpoint restore | Agent handoff without re-audit |
| `parseNdjsonStream(stream)` | Parse embedded NDJSON events | Wire v2 replay |
| `getWireOutputSchema()` | JSON Schema for wire v2 | MCP validation |
| `formatPreflightDigest(result)` | Pre-edit blocked digest | Tool mirror pre-mutation |
| `formatWireDigest(wire)` | Wire-only restore digest | Session persistence without full bundle |
| `validateWire(wire)` | Fail-closed wire validation | MCP/session restore hardening |
| `toStructuredTelemetry(wire)` | OTel-style JSON event | Observability pipelines |
| `check({ phase }).wire` | MCP-safe JSON payload | Session persistence without SARIF/LSP |
| `handoff(bundle)` | Context + workflow + wire | Agent-to-agent handoff |
| `outputSchema()` | JSON Schema for wire format | MCP output validation |
| `bundle.suggestedCommands` | Runnable verify/resync cmds | Copy-paste agent actions |
| `toNdjson(report)` | NDJSON diagnostic stream | Streaming CI parsers |
| `compareBaselineBundle()` | Baseline delta + bundle | PR review handoff |
| `bundle.priorityQueue` | Ranked actions | blockers → repairs → warnings |
| `bundle.workflow` | CI pipeline steps | Blocking vs advisory phases |
| `toTap(report)` / `toJUnitXml(report)` | TAP / JUnit XML | Jenkins, GitLab CI |
| `applyBundleBudget(bundle, budget)` | Clippy-style diagnostic caps | Token-limited payloads |
| `preflightBundle(file)` | Preflight + bundle | Pre-edit single round-trip |
| `sessionDelta()` | Diff + narrative since last audit | In-session regression check |
| `validateBundle(bundle)` | Fail-closed shape check | Production hardening |
| `formats.codeActions` | LSP CodeAction quick fixes | Editor/agent repair hints |
| `compact(report)` | ESLint compact / `cargo check` summary | Low-token agent context |
| `toGithubAnnotations(report)` | `::error file=…` workflow commands | GitHub Actions annotations |
| `formatDiffNarrative(diff)` | PR delta markdown | Session/baseline review |
| `gateBundle(options)` | Gate + bundle round-trip | Preferred agent entry |
| `toSarif(report)` | SARIF 2.1.0 | GitHub Code Scanning, CI upload |
| `toLspDiagnostics(report)` | LSP PublishDiagnostics | Editor overlays, relatedInformation → repairs |
| `formatNarrative(report)` | Human + LLM markdown | Tool output |
| `diff(before, after)` | Code scanning delta | PR review — introduced vs resolved |
| `diffSinceLast()` | Session baseline | Before/after mutation in one session |
| `explain(report, findingId)` | Rule doc + directives | Follow-up on a specific finding |
| `explainForAgent(report, findingId)` | Explain + root-cause cluster | Agent follow-up with remediation context |

## Agent digest fields

| Field | Purpose |
| --- | --- |
| `verdict` | `pass` \| `warn` \| `fail` |
| `passed` | Boolean gate |
| `blockers` | ERROR findings with `location` (`file:line:col`) and `ruleDoc` |
| `playbook` | Ordered steps: `resync` → `repair` → `verify` → `investigate` |
| `recommendedActions` | Prioritized repairs with `verificationCommand` |
| `agentNarrative` | Full markdown including playbook |

## Gate policy

```typescript
interface SpiderGatePolicy {
  blockOnErrors?: boolean;   // default true
  blockOnWarnings?: boolean; // default false
  blockOnDegraded?: boolean; // default false
  blockOnDrift?: boolean;    // default true
}
```

`conclusion` follows GitHub Checks: `success` | `failure` | `neutral`.

## Stable IDs

- `findingId` — cite in PRs and `explain()`
- `evidenceId` — links evidence to findings
- `directiveId` — links playbook steps to repairs

## Alternate entry

```typescript
await ctx.audit.spider.gate({ scope: 'changed-files' });
```

## Recommended workflow

1. `preflight(file)` before editing high-impact paths
2. Make changes
3. `gate({ scope: 'changed-files' })` — hard stop on `exitCode === 1`
4. `diffSinceLast()` to see introduced vs resolved findings
5. Follow `playbook` in order; never skip `verificationCommand`

## Production guarantees

- `validateSpiderReport()` on every audit
- SARIF fingerprints use stable `findingId`
- LSP diagnostics attach repair `relatedInformation`
- Post-mutation tool mirror appends **check digest** (`formatCheckDigest` via `check({ phase: 'post-edit' })`) when `exitCode !== 0` — compact lines + priority queue + suggested command
