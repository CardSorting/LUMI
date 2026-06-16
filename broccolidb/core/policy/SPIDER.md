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
// 0. Unified check (recommended)
const pre = await ctx.graph.spider.check({ phase: 'pre-edit', filePath: 'src/core/provider.ts' });
const post = await ctx.graph.spider.check({ phase: 'ci', scope: 'changed-files' });
if (post.exitCode === 1) process.exit(1);

// JSON envelope for MCP/CI (ESLint JSON / GitHub Checks style)
const json = ctx.graph.spider.toCheckResponse(post, { includeSarifMeta: true });
// MCP: spider_forensic_check({ phase: 'ci', responseFormat: 'json' })
// MCP: spider_forensic_pipeline({ phases: ['pre-edit', 'ci'] })

// NDJSON stream + GitHub Checks API
const ndjson = ctx.graph.spider.toCheckNdjsonStream(post);
const checkRun = ctx.graph.spider.toGithubCheckRun(post);

// 1. Pre-edit (preferred)
const pre = await ctx.graph.spider.preflightBundle('src/core/provider.ts');
if (!pre.proceed) console.log(ctx.graph.spider.agentContext(pre.bundle, { maxCompactLines: 5 }));

// 2. Multi-file pre-edit
const batch = await ctx.graph.spider.batchPreflight(['src/a.ts', 'src/b.ts']);

// 3. CI gate (preferred: gateBundle)
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
- **Gate** for CI-style pass/fail (`conclusion`, `exitCode`)
- **Bundle** for one-shot agent context (narrative + compact + clusters + SARIF/LSP)
- **Compact** for token-efficient `file:line:col` lines
- **Baseline** / **diffSinceLast** for introduced vs resolved findings
- Respect SPI-006 drift — `resync` before mutations
- Follow `agentDigest.playbook` or `bundle.playbook` in order

See [spider-agent-ergonomics.md](../../../docs/api/spider-agent-ergonomics.md) and [spider-v20-forensic-engine.md](../../../docs/architecture/spider-v20-forensic-engine.md).
