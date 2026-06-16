# SPIDER: Structural Forensic Engine

Spider proves structural truth. It does not guess. Agents access Spider **only** via `ctx.graph.spider`.

Public docs: [../../docs/getting-started.md](../../docs/getting-started.md) · [Spider ergonomics](../../../docs/api/spider-agent-ergonomics.md)

## Forensic contracts

1. **Evidence** — typed `SpiderEvidence` on every finding
2. **Identity** — `SemanticFootprint` with AST-normalized hashing
3. **Reality** — `DiskParityResult` with explicit `driftStatus`
4. **Repair** — JSON-serializable `RepairDirective` with verification commands

Audit and gate are **read-only**. File mutations go through `ctx.runtime.execute`.

## SPI diagnostics

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

## Agent workflow

```typescript
// 0. Discover toolkit surface
const catalog = ctx.graph.spider.getAgentToolkitCatalog();

// 1. Unified check (recommended)
const pre = await ctx.graph.spider.check({ phase: 'pre-edit', filePath: 'src/core/provider.ts' });
const post = await ctx.graph.spider.check({
  phase: 'ci',
  scope: 'changed-files',
  gatePreset: 'strict',
});
if (post.exitCode === 1) process.exit(1);

// JSON envelope for MCP/CI
const json = ctx.graph.spider.toCheckResponse(post, { includeSarifMeta: true });

// 2. Pre-edit bundle (alternate)
const preBundle = await ctx.graph.spider.preflightBundle('src/core/provider.ts');
if (!preBundle.proceed) console.log(ctx.graph.spider.agentContext(preBundle.bundle));

// 3. Multi-file pre-edit
const batch = await ctx.graph.spider.batchPreflight(['src/a.ts', 'src/b.ts']);

// 4. CI gate (preferred: gateBundle)
const { gate: ci, bundle } = await ctx.graph.spider.gateBundle({ scope: 'changed-files' });
if (ci.blocked) process.exit(ci.exitCode);

// 5. PR baseline delta
ctx.graph.spider.setBaseline(ci.report);
const delta = ctx.graph.spider.compareBaseline();
```

## Runtime integration

Spider findings feed the repair pipeline through runtime sessions:

```typescript
const session = await ctx.runtime.beginSession({ taskId: 'structural-fix' });
const audit = await ctx.graph.spider.audit({ scope: 'all', includeRepairDirectives: true });
ctx.runtime.recordAudit(session.sessionId, audit);
const gate = await ctx.graph.spider.gate({ scope: 'all' });
ctx.runtime.recordGate(session.sessionId, gate.exitCode, audit.reportId);

if (gate.blocked) {
  const plan = ctx.runtime.planRepairs({ audit, sessionId: session.sessionId });
  // preview → approve → ctx.runtime.execute({ plan })
}
```

## Phase reference

| Phase | Use |
|-------|-----|
| `pre-edit` | Before local edits |
| `post-edit` | After edits, before commit |
| `ci` | Pipeline gate |
| `pr-review` | PR review scope |

## Output formats

- **Compact** — `formatCheckDigest` for token-efficient CI logs
- **JSON** — `toCheckResponse` for MCP and automation
- **SARIF** — `toSarifLog` / `buildCiArtifacts` for tool interchange
- **Scenario** — `runAgentScenarioAndRespond` for preset workflows

## Rules

- Respect SPI-006 drift — call `resync` before mutations when disk parity fails
- Follow `agentDigest.playbook` or `bundle.playbook` in order
- Never bypass capabilities to call `SpiderService` directly

Internal implementation: `core/policy/spider/`. Architecture history: [../../../docs/architecture/spider-v20-forensic-engine.md](../../../docs/architecture/spider-v20-forensic-engine.md).
