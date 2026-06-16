# SPIDER: Sovereign Structural Forensic Engine (V20)

Spider proves structural truth. It does not guess.

## Forensic Contracts

1. **Evidence** — typed `SpiderEvidence` on every finding
2. **Identity** — `SemanticFootprint` with AST-normalized SHA-256
3. **Reality** — `DiskParityResult` with explicit `driftStatus`
4. **Repair** — JSON-serializable `RepairDirective` with verification commands

## SPI Diagnostics

| ID | Name |
| --- | --- |
| SPI-001 | SymbolicContractBreakage |
| SPI-002 | TypeSoundnessFailure |
| SPI-003 | ArchitecturalVolcano |
| SPI-004 | StructuralLoop |
| SPI-005 | LayerViolation |
| SPI-006 | RealityDrift |
| SPI-007 | SemanticIdentityMismatch |
| SPI-008 | RepairDirectiveUnsafe |
| SPI-009 | CompilerUnavailable |
| SPI-010 | GraphStaleness |

## Agent Workflow

```typescript
// 0. Bootstrap (MCP or capability — no disk audit)
const catalog = ctx.graph.spider.getAgentToolkitCatalog();
// MCP: spider_get_catalog({ responseFormat: 'markdown' })

// 1. Unified check (recommended)
const pre = await ctx.graph.spider.check({ phase: 'pre-edit', filePath: 'src/core/provider.ts' });
const post = await ctx.graph.spider.check({
  phase: 'ci',
  scope: 'changed-files',
  gatePreset: 'strict',
});
if (post.exitCode === 1) process.exit(1);

// JSON envelope for MCP/CI (ESLint JSON / GitHub Checks style)
const json = ctx.graph.spider.toCheckResponse(post, { includeSarifMeta: true });
// MCP: spider_forensic_check({ phase: 'ci', responseFormat: 'json', gatePreset: 'strict' })
// MCP: spider_forensic_pipeline({ phases: ['pre-edit', 'ci'] })
// MCP: spider_forensic_pipeline({ workflowPreset: 'local-edit', filePath: '...' })
// MCP: spider_run_scenario({ scenario: 'before-edit', filePath: '...' })
// MCP: spider_validate_check_request({ requestJson, kind: 'check' | 'pipeline' })

// NDJSON stream + GitHub Checks API
const ndjson = ctx.graph.spider.toCheckNdjsonStream(post);
const checkRun = ctx.graph.spider.toGithubCheckRun(post);

// 2. Pre-edit bundle (alternate)
const preBundle = await ctx.graph.spider.preflightBundle('src/core/provider.ts');
if (!preBundle.proceed) console.log(ctx.graph.spider.agentContext(preBundle.bundle, { maxCompactLines: 5 }));

// 3. Multi-file pre-edit
const batch = await ctx.graph.spider.batchPreflight(['src/a.ts', 'src/b.ts']);

// 4. CI gate (preferred: gateBundle)
const { gate: ci, bundle } = await ctx.graph.spider.gateBundle({ scope: 'changed-files' });
if (ci.blocked) process.exit(ci.exitCode);
console.log(bundle.brief, bundle.nextAction);

// 5. PR baseline delta
ctx.graph.spider.setBaseline(ci.report);
// ... after changes ...
const delta = ctx.graph.spider.compareBaseline();
```

- **Preflight** / **batchPreflight** before editing
- **Pre-edit gate** — tool mirror runs `check({ phase: 'pre-edit' })` before mutations (`forensicPreEditGate`, default on)
- **Post-edit gate** — after mirror, `check({ phase: 'post-edit' })` with optional `failOnPostEditBlockers`
- **Scenario JSON** — `runAgentScenarioAndRespond()` → `broccolidb.spider.scenario-response/v1`
- **Gate** for CI-style pass/fail (`conclusion`, `exitCode`)
- **Bundle** for one-shot agent context (narrative + compact + clusters + SARIF/LSP)
- **Compact** for token-efficient `file:line:col` lines
- **Baseline** / **diffSinceLast** for introduced vs resolved findings
- Respect SPI-006 drift — `resync` before mutations
- Follow `agentDigest.playbook` or `bundle.playbook` in order

See [spider-agent-ergonomics.md](../../../docs/api/spider-agent-ergonomics.md) and [spider-v20-forensic-engine.md](../../../docs/architecture/spider-v20-forensic-engine.md).
