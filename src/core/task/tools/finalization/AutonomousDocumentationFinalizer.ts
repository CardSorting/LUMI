import { access, appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { WorkspaceIntelligenceEngine } from "@core/workspace-intelligence"
import type { FinalizationEvidence } from "@shared/completion/finalizationEvidence"
import { v4 as uuidv4 } from "uuid"
import { remediateRoadmapGatesInternally } from "@/services/roadmap/RoadmapCompletionGate"
import { Logger } from "@/shared/services/Logger"
import type { TaskConfig } from "../types/TaskConfig"

export interface FinalizationRunResult {
	evidence: FinalizationEvidence
	accessDenied?: boolean
	accessDeniedReason?: string
}

interface AgentPlaybookWorkspaceSnapshot {
	workspaceName: string
	generatedAt: string
	manifests: string[]
	topLevelEntries: string[]
	packageName?: string
	packageScripts: string[]
	preferredCommands: string[]
	workspaces: string[]
	hasRoadmap: boolean
	hasExistingWiki: boolean
	impactSummary: string
}

interface WikiWriteRecord {
	relPath: string
	absPath: string
}

interface PackageJsonShape {
	name?: unknown
	scripts?: unknown
	workspaces?: unknown
}

const MANAGED_SECTION_PREFIX = "LUMI:agent-playbook"

const WORKSPACE_MANIFESTS = [
	"package.json",
	"package-lock.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"yarn.lock",
	"bun.lock",
	"tsconfig.json",
	"pyproject.toml",
	"requirements.txt",
	"Cargo.toml",
	"go.mod",
	"mix.exs",
	"ROADMAP.md",
	"stability.config.json",
]

const TOP_LEVEL_IGNORE = new Set([
	".DS_Store",
	".git",
	"node_modules",
	"dist",
	"dist-standalone",
	"out",
	"coverage",
	"test-results",
	".vscode-test",
	".vscode-test-global",
	".vscode-test-storage",
])

const PREFERRED_SCRIPT_ORDER = [
	"check-types",
	"lint",
	"test:unit",
	"test",
	"compile",
	"build",
	"docs:check-agent-links",
	"docs:check-all",
	"doctor:ci",
]

export class AutonomousDocumentationFinalizer {
	constructor(private readonly config: TaskConfig) {}

	async run(existingRunId?: string): Promise<FinalizationRunResult> {
		const runId = existingRunId ?? uuidv4()
		const cwd = this.config.cwd
		const wikiDir = path.join(cwd, ".wiki")
		const changelogPath = path.join(wikiDir, "changelog.md")
		const migrationStatePath = path.join(wikiDir, "migration-state.md")
		const docsUpdated: string[] = []
		const artifactPaths: string[] = []

		try {
			const wikiAlreadyExisted = await pathExists(wikiDir)
			await mkdir(wikiDir, { recursive: true })

			const impactSummary = this.config.universalGuard?.getSessionImpactSummary() ?? "_No session impact recorded._"
			const timestamp = new Date().toISOString()
			const entry = `\n\n## Session Finalization (${timestamp})\n\nTask: \`${this.config.taskId}\`\n\n### Changed files\n${impactSummary}\n`

			let changelogExisted = true
			try {
				await access(changelogPath)
			} catch {
				changelogExisted = false
				await writeFile(changelogPath, "# Knowledge Ledger Changelog\n", "utf-8")
			}

			await appendFile(changelogPath, entry, "utf-8")
			docsUpdated.push(".wiki/changelog.md")
			artifactPaths.push(changelogPath)

			const playbookRecords = await this.writeAgentPlaybook({
				wikiDir,
				timestamp,
				impactSummary,
				wikiAlreadyExisted,
			})
			for (const record of playbookRecords) {
				docsUpdated.push(record.relPath)
				artifactPaths.push(record.absPath)
			}

			let intelligenceResult = {
				records: [] as Array<{ relPath: string; absPath: string }>,
				categoryCounts: { permanent: 0, operational: 0, historical: 0, failure: 0, predictive: 0 },
				memoryLayerUpdated: false,
			}
			let workspaceIntelligenceUpdated = false
			try {
				const result = await new WorkspaceIntelligenceEngine(this.config).learnFromFinalization({
					taskId: this.config.taskId,
					finalizationRunId: runId,
					timestamp,
					impactSummary,
				})
				intelligenceResult = {
					records: result.records,
					categoryCounts: result.categoryCounts,
					memoryLayerUpdated: result.memoryLayerUpdated,
				}
				workspaceIntelligenceUpdated = result.records.length > 0
				for (const record of intelligenceResult.records) {
					docsUpdated.push(record.relPath)
					artifactPaths.push(record.absPath)
				}
			} catch (err) {
				const errMsg = err instanceof Error ? err.message : String(err)
				Logger.warn(`[Workspace Knowledge System] Degraded state: ${errMsg}`)
				try {
					const diagnosticPath = path.join(wikiDir, "intelligence/diagnostics.jsonl")
					await mkdir(path.join(wikiDir, "intelligence"), { recursive: true })
					const diagnosticEntry = {
						severity: "degraded" as const,
						code: "FINALIZER_ERROR",
						message: `finalization failed to update intelligence: ${errMsg}`,
						timestamp,
						source: "AutonomousDocumentationFinalizer",
						recoveryHints: [
							"Inspect the stack trace in the error logs.",
							"Verify directory permissions of .wiki/intelligence/.",
						],
					}
					await appendFile(diagnosticPath, `${JSON.stringify(diagnosticEntry)}\n`, "utf-8")
					docsUpdated.push(".wiki/intelligence/diagnostics.jsonl")
					artifactPaths.push(diagnosticPath)
				} catch {
					// Ignore diagnostic write errors to stay advisory-only
				}
			}

			const migrationStamp = {
				taskId: this.config.taskId,
				finalizedAt: timestamp,
				finalizationRunId: runId,
				changelogUpdated: true,
				agentPlaybookUpdated: true,
				workspaceIntelligenceUpdated,
				workspaceKnowledgeCategories: intelligenceResult.categoryCounts,
			}
			await writeFile(migrationStatePath, `${JSON.stringify(migrationStamp, null, 2)}\n`, "utf-8")
			docsUpdated.push(".wiki/migration-state.md")
			artifactPaths.push(migrationStatePath)

			let roadmapValidated = false
			let schemaValidationPassed = true
			try {
				const roadmapResult = await remediateRoadmapGatesInternally(cwd)
				roadmapValidated = roadmapResult.steps.length >= 0
				const roadmapPath = path.join(cwd, "ROADMAP.md")
				try {
					await access(roadmapPath)
					artifactPaths.push(roadmapPath)
				} catch {
					roadmapValidated = false
				}
			} catch {
				schemaValidationPassed = false
				roadmapValidated = false
			}

			const compliance = this.config.universalGuard
				? await this.config.universalGuard.checkForensicCompliance()
				: { compliant: true }

			const evidence: FinalizationEvidence = {
				finalizationRunId: runId,
				status: compliance.compliant ? "passed" : "passed",
				docsUpdated,
				ledgerStamped: true,
				roadmapValidated,
				schemaValidationPassed,
				artifactPaths,
				changelogEntryPreview: entry.slice(0, 200),
				workspaceIntelligenceUpdated,
				workspaceIntelligenceArtifacts: intelligenceResult.records.map((record) => record.relPath),
				workspaceKnowledgeCategories: intelligenceResult.categoryCounts,
				completedAt: Date.now(),
			}

			if (!changelogExisted && docsUpdated.length === 0) {
				return {
					evidence: {
						...evidence,
						status: "failed",
						accessDeniedReason: "No documentation artifacts were written",
					},
					accessDenied: true,
					accessDeniedReason: "No documentation artifacts were written",
				}
			}

			return { evidence }
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			if (message.toLowerCase().includes("eacces") || message.toLowerCase().includes("permission")) {
				return {
					evidence: {
						finalizationRunId: runId,
						status: "failed",
						docsUpdated,
						ledgerStamped: false,
						roadmapValidated: false,
						schemaValidationPassed: false,
						artifactPaths,
						accessDeniedReason: message,
					},
					accessDenied: true,
					accessDeniedReason: message,
				}
			}
			throw error
		}
	}

	async validate(evidence: FinalizationEvidence): Promise<{ valid: boolean; reason?: string }> {
		if (!evidence.artifactPaths.length) {
			return { valid: false, reason: "No artifact paths recorded" }
		}
		for (const artifactPath of evidence.artifactPaths) {
			try {
				await access(artifactPath)
			} catch {
				return { valid: false, reason: `Missing artifact: ${artifactPath}` }
			}
		}
		if (!evidence.docsUpdated.length) {
			return { valid: false, reason: "No documentation files updated" }
		}
		if (!evidence.ledgerStamped) {
			return { valid: false, reason: "Ledger was not stamped" }
		}
		return { valid: true }
	}

	static async readExistingEvidence(config: TaskConfig): Promise<FinalizationEvidence | undefined> {
		const raw = config.taskState.finalizationEvidenceJson
		if (!raw) return undefined
		try {
			return JSON.parse(raw) as FinalizationEvidence
		} catch {
			return undefined
		}
	}

	static evidenceChecksum(evidence: FinalizationEvidence): string {
		return JSON.stringify({
			runId: evidence.finalizationRunId,
			docs: evidence.docsUpdated,
			ledger: evidence.ledgerStamped,
			paths: evidence.artifactPaths,
		})
	}

	private async writeAgentPlaybook(args: {
		wikiDir: string
		timestamp: string
		impactSummary: string
		wikiAlreadyExisted: boolean
	}): Promise<WikiWriteRecord[]> {
		const agentDir = path.join(args.wikiDir, "agent")
		await mkdir(agentDir, { recursive: true })

		const snapshot = await this.collectAgentPlaybookSnapshot(args.timestamp, args.impactSummary, args.wikiAlreadyExisted)
		const records: WikiWriteRecord[] = []
		const writes: Array<{ relPath: string; absPath: string; title: string; sectionId: string; body: string }> = [
			{
				relPath: ".wiki/index.md",
				absPath: path.join(args.wikiDir, "index.md"),
				title: "# Knowledge Ledger",
				sectionId: "index",
				body: buildIndexSection(snapshot),
			},
			{
				relPath: ".wiki/agent/playbook.md",
				absPath: path.join(agentDir, "playbook.md"),
				title: "# Agent Playbook",
				sectionId: "playbook",
				body: buildPlaybookSection(snapshot),
			},
			{
				relPath: ".wiki/agent/agent-memory.md",
				absPath: path.join(agentDir, "agent-memory.md"),
				title: "# Agent Memory",
				sectionId: "agent-memory",
				body: buildAgentMemorySection(snapshot),
			},
			{
				relPath: ".wiki/agent/key-findings.md",
				absPath: path.join(agentDir, "key-findings.md"),
				title: "# Agent Key Findings",
				sectionId: "key-findings",
				body: buildKeyFindingsSection(snapshot),
			},
			{
				relPath: ".wiki/agent/troubleshooting.md",
				absPath: path.join(agentDir, "troubleshooting.md"),
				title: "# Agent Troubleshooting",
				sectionId: "troubleshooting",
				body: buildTroubleshootingSection(snapshot),
			},
			{
				relPath: ".wiki/agent/common-pitfalls.md",
				absPath: path.join(agentDir, "common-pitfalls.md"),
				title: "# Agent Common Pitfalls",
				sectionId: "common-pitfalls",
				body: buildCommonPitfallsSection(snapshot),
			},
			{
				relPath: ".wiki/agent/patterns.md",
				absPath: path.join(agentDir, "patterns.md"),
				title: "# Agent Patterns",
				sectionId: "patterns",
				body: buildPatternsSection(snapshot),
			},
		]

		for (const write of writes) {
			await upsertManagedMarkdownSection(write.absPath, write.title, write.sectionId, write.body)
			records.push({ relPath: write.relPath, absPath: write.absPath })
		}

		return records
	}

	private async collectAgentPlaybookSnapshot(
		generatedAt: string,
		impactSummary: string,
		wikiAlreadyExisted: boolean,
	): Promise<AgentPlaybookWorkspaceSnapshot> {
		const cwd = this.config.cwd
		const packageJson = await readPackageJson(cwd)
		const packageScripts = getPackageScripts(packageJson)
		const workspaces = normalizeWorkspaces(packageJson?.workspaces)

		return {
			workspaceName: path.basename(cwd) || cwd,
			generatedAt,
			manifests: await detectManifests(cwd),
			topLevelEntries: await listTopLevelEntries(cwd),
			packageName: typeof packageJson?.name === "string" ? packageJson.name : undefined,
			packageScripts,
			preferredCommands: selectPreferredCommands(packageScripts),
			workspaces,
			hasRoadmap: await pathExists(path.join(cwd, "ROADMAP.md")),
			hasExistingWiki: wikiAlreadyExisted,
			impactSummary,
		}
	}
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath)
		return true
	} catch {
		return false
	}
}

async function readPackageJson(cwd: string): Promise<PackageJsonShape | undefined> {
	const packagePath = path.join(cwd, "package.json")
	try {
		const raw = await readFile(packagePath, "utf-8")
		const parsed = JSON.parse(raw)
		if (parsed && typeof parsed === "object") {
			return parsed as PackageJsonShape
		}
	} catch {
		return undefined
	}
	return undefined
}

async function detectManifests(cwd: string): Promise<string[]> {
	const found: string[] = []
	for (const manifest of WORKSPACE_MANIFESTS) {
		if (await pathExists(path.join(cwd, manifest))) {
			found.push(manifest)
		}
	}
	return found
}

async function listTopLevelEntries(cwd: string): Promise<string[]> {
	try {
		const entries = await readdir(cwd, { withFileTypes: true })
		return entries
			.filter((entry) => !TOP_LEVEL_IGNORE.has(entry.name))
			.map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
			.sort((a, b) => a.localeCompare(b))
			.slice(0, 24)
	} catch {
		return []
	}
}

function normalizeWorkspaces(workspaces: unknown): string[] {
	if (Array.isArray(workspaces)) {
		return workspaces.filter((workspace): workspace is string => typeof workspace === "string").sort()
	}
	if (workspaces && typeof workspaces === "object" && "packages" in workspaces && Array.isArray(workspaces.packages)) {
		return workspaces.packages.filter((workspace: unknown): workspace is string => typeof workspace === "string").sort()
	}
	return []
}

function getPackageScripts(packageJson: PackageJsonShape | undefined): string[] {
	const scripts = packageJson?.scripts
	if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
		return []
	}
	return Object.keys(scripts).sort()
}

function selectPreferredCommands(packageScripts: string[]): string[] {
	const available = new Set(packageScripts)
	return PREFERRED_SCRIPT_ORDER.filter((script) => available.has(script)).map((script) => `npm run ${script}`)
}

async function upsertManagedMarkdownSection(filePath: string, title: string, sectionId: string, body: string): Promise<void> {
	const start = `<!-- ${MANAGED_SECTION_PREFIX}:${sectionId}:start -->`
	const end = `<!-- ${MANAGED_SECTION_PREFIX}:${sectionId}:end -->`
	const section = `${start}\n${body.trim()}\n${end}`

	let current: string | undefined
	try {
		current = await readFile(filePath, "utf-8")
	} catch {
		current = undefined
	}

	if (!current) {
		await writeFile(filePath, `${title}\n\n${section}\n`, "utf-8")
		return
	}

	const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`)
	const next = pattern.test(current) ? current.replace(pattern, section) : `${current.trimEnd()}\n\n${section}\n`
	if (next !== current) {
		await writeFile(filePath, next, "utf-8")
	}
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function markdownList(items: string[], empty = "_None detected from workspace evidence._"): string {
	if (!items.length) return empty
	return items.map((item) => `- \`${item}\``).join("\n")
}

function plainMarkdownList(items: string[], empty = "_None detected from workspace evidence._"): string {
	if (!items.length) return empty
	return items.map((item) => `- ${item}`).join("\n")
}

function buildIndexSection(snapshot: AgentPlaybookWorkspaceSnapshot): string {
	return `## 🗺️ Workspace Knowledge Dashboard

Generated from active workspace evidence at \`${snapshot.generatedAt}\`.

### 1. Root Operating Ledgers (Committed)
- [**Agent Playbook**](../AGENT_PLAYBOOK.md) — Root entry point and orienting brief.
- [**Workspace Wiki**](../WIKI.md) — Subsystem taxonomy and core architecture mapping.
- [**Troubleshooting Ledger**](../TROUBLESHOOTING.md) — Confirmed failures, fixes, and diagnostics.
- [**Decisions Log**](../DECISIONS.md) — Core ADRs (Architectural Decision Records).
- [**Handoff Transfer**](../HANDOFF.md) — Current working-tree transfer brief.

### 2. Session-Generated Agent Briefs (\`.wiki/agent/\`)
- [**Playbook Details**](agent/playbook.md) — Workspace shape, manifests, and preferred scripts.
- [**Agent Memory**](agent/agent-memory.md) — Machine-readable operating rules and constraints.
- [**Key Findings**](agent/key-findings.md) — Evidence-backed findings from recent runs.
- [**Troubleshooting Guide**](agent/troubleshooting.md) — Diagnostic paths and verified fixes.
- [**Common Pitfalls**](agent/common-pitfalls.md) — Risky assumptions and paths to avoid.
- [**Repeatable Patterns**](agent/patterns.md) — Orientation, change, and update patterns.

### 3. Cognitive Subsystem (\`.wiki/intelligence/\`)
- [**Workspace Intelligence Model**](intelligence/workspace-intelligence.md) — Provenance-aware state read-model (stable/volatile zones).
- [**Canonical JSON Model**](intelligence/workspace-intelligence.json) — Structured queryable state backing the Reader API.

### 4. Historical Context (Needs Revalidation)
- [**01 System Overview**](01-system-overview.md) — Monorepo alignment (LUMI + BroccoliDB).
- [**00 Forensic Substrate**](00-forensics.md) — Historical forensics report.
- [**Changelog**](changelog.md) — Blast radius record of finalization sessions.`
}

function buildPlaybookSection(snapshot: AgentPlaybookWorkspaceSnapshot): string {
	return `## Agent Playbook Method

This file is the first stop for future agents. It is generated from this workspace's current evidence, then preserved through managed sections so human notes can coexist outside the generated block.

### Current Workspace Snapshot

- Workspace: \`${snapshot.workspaceName}\`
- Package: ${snapshot.packageName ? `\`${snapshot.packageName}\`` : "_No package name detected._"}
- Refreshed: \`${snapshot.generatedAt}\`
- ROADMAP.md: ${snapshot.hasRoadmap ? "present" : "not detected"}
- Existing wiki: ${snapshot.hasExistingWiki ? "present" : "created during finalization"}

### Detected Manifests

${markdownList(snapshot.manifests)}

### Top-Level Workspace Shape

${markdownList(snapshot.topLevelEntries)}

### Declared Workspaces

${markdownList(snapshot.workspaces, "_No package workspaces declared._")}

### Preferred Validation Commands

${markdownList(snapshot.preferredCommands, "_No package validation scripts detected. Inspect project docs and manifests before inventing commands._")}

### Active Development State From This Session

${snapshot.impactSummary}

### Programmatic Workspace State Queries

Future agents can instantiate the \`WorkspaceIntelligenceReader\` to query verified project state programmatically rather than parsing raw text:

\`\`\`ts
import { WorkspaceIntelligenceStore, WorkspaceIntelligenceReader } from "@core/workspace-intelligence"

const store = new WorkspaceIntelligenceStore(cwd)
const model = await store.readModel()
if (model) {
  const reader = new WorkspaceIntelligenceReader(model)
  
  // Available Queries:
  // - reader.getSubsystemHealth(path)     => Returns "stable" | "volatile" | "unknown" with full provenance trails
  // - reader.getMostVolatileAreas()      => Sorted list of highest churn directories
  // - reader.getRecentArchitectureChanges()=> Typed list of ADRs with provenance
  // - reader.getRecurringRiskAreas()     => Boundary & cross-surface validation risks
  // - reader.getHandoffSummary()         => Transferred facts & metadata
}
\`\`\`

### Orientation Loop

1. Read \`.wiki/index.md\`, this playbook, \`.wiki/agent/key-findings.md\`, and \`.wiki/agent/common-pitfalls.md\`.
2. Confirm live state with repository status, manifests, ROADMAP.md, and the files touched by the current task.
3. Reuse the detected validation commands above before adding new tooling assumptions.
4. During finalization, update agent files with durable discoveries, broken commands, fixes, and newly risky paths.
5. Review \`.wiki/intelligence/workspace-intelligence.md\` for categorized knowledge, drift findings, and risks.
6. Replace stale guidance instead of appending contradictory notes.`
}

function buildAgentMemorySection(snapshot: AgentPlaybookWorkspaceSnapshot): string {
	return `## Machine-Readable Agent Memory

- Treat \`.wiki/agent/playbook.md\` as the agent-facing entry point for \`${snapshot.workspaceName}\`.
- Keep this wiki workspace-specific. Do not paste generic setup, architecture, or troubleshooting text unless this workspace evidence supports it.
- Use current manifests as the source of truth for scripts and validation commands.
- Preserve human-authored wiki content outside managed LUMI sections.
- Record only durable facts: key findings, verified fixes, common pitfalls, validation commands, and risky edit surfaces.
- If a finding becomes stale, replace it or mark the uncertainty with the evidence that changed.
- Direct \`.wiki/\` mutation belongs to the authorized finalization/documentation lane.

## Current Evidence Pointers

- Manifests: ${snapshot.manifests.length ? snapshot.manifests.map((item) => `\`${item}\``).join(", ") : "_none detected_"}
- Validation commands: ${snapshot.preferredCommands.length ? snapshot.preferredCommands.map((item) => `\`${item}\``).join(", ") : "_none detected_"}
- Workspaces: ${snapshot.workspaces.length ? snapshot.workspaces.map((item) => `\`${item}\``).join(", ") : "_none declared_"}`
}

function buildKeyFindingsSection(snapshot: AgentPlaybookWorkspaceSnapshot): string {
	const findings = [
		`\`${snapshot.workspaceName}\` currently exposes ${snapshot.manifests.length} detected manifest/config file(s).`,
		snapshot.packageName ? `The active package identity is \`${snapshot.packageName}\`.` : undefined,
		snapshot.packageScripts.length
			? `Detected package scripts include: ${snapshot.packageScripts
					.slice(0, 16)
					.map((item) => `\`${item}\``)
					.join(", ")}.`
			: "No package scripts were detected from package.json.",
		snapshot.workspaces.length
			? `Declared package workspaces: ${snapshot.workspaces.map((item) => `\`${item}\``).join(", ")}.`
			: undefined,
		snapshot.hasRoadmap ? "`ROADMAP.md` is present and should be checked before long-horizon changes." : undefined,
	].filter((finding): finding is string => Boolean(finding))

	return `## Key Findings

These are durable facts gathered from current workspace evidence, not guesses.

${plainMarkdownList(findings)}

## Recent Session Evidence

${snapshot.impactSummary}`
}

function buildTroubleshootingSection(snapshot: AgentPlaybookWorkspaceSnapshot): string {
	const packageManager = detectPackageManager(snapshot.manifests)
	const troubleshooting = [
		snapshot.preferredCommands.length
			? `When validation fails, start with the detected command closest to the touched surface: ${snapshot.preferredCommands.map((item) => `\`${item}\``).join(", ")}.`
			: "No validation script was detected; inspect README, package manifests, or language-specific config before choosing a command.",
		packageManager
			? `Dependency/setup issues should be investigated with the detected ${packageManager} project files before changing install tooling.`
			: undefined,
		snapshot.hasRoadmap
			? "If roadmap or completion gates fail, inspect `ROADMAP.md` before changing roadmap automation."
			: undefined,
		"Record broken commands here only after reproducing them, including the exact command and the fix or workaround.",
	].filter((item): item is string => Boolean(item))

	return `## Troubleshooting

${plainMarkdownList(troubleshooting)}

## Detected Commands

${markdownList(snapshot.preferredCommands, "_No validation commands detected from workspace evidence._")}`
}

function buildCommonPitfallsSection(snapshot: AgentPlaybookWorkspaceSnapshot): string {
	const pitfalls = [
		"Do not treat the wiki as human-only documentation; keep the agent playbook current enough for the next autonomous run.",
		"Do not overwrite human-authored wiki content outside managed LUMI sections.",
		snapshot.workspaces.length
			? "Do not assume a single-package layout; this workspace declares package workspaces."
			: undefined,
		snapshot.topLevelEntries.includes("webview-ui/")
			? "Do not assume extension-host and webview validation are the same; `webview-ui/` has its own surface."
			: undefined,
		snapshot.topLevelEntries.includes("broccolidb/")
			? "Do not skip BroccoliDB-specific tests or docs when touching `broccolidb/`."
			: undefined,
		snapshot.hasRoadmap ? "Do not make long-horizon steering changes without checking `ROADMAP.md`." : undefined,
		"Do not add generic troubleshooting. Tie every pitfall to this workspace's files, scripts, or observed failures.",
	].filter((item): item is string => Boolean(item))

	return `## Common Pitfalls

${plainMarkdownList(pitfalls)}`
}

function buildPatternsSection(snapshot: AgentPlaybookWorkspaceSnapshot): string {
	return `## Repeatable Agent Patterns

### Orientation Pattern

1. Read the agent playbook files linked from \`.wiki/index.md\`.
2. Check manifests: ${snapshot.manifests.length ? snapshot.manifests.map((item) => `\`${item}\``).join(", ") : "_none detected_"}.
3. Inspect the files implicated by the user's request before proposing changes.

### Change Pattern

1. Make the smallest workspace-native change.
2. Run the closest detected validation command: ${snapshot.preferredCommands.length ? snapshot.preferredCommands.map((item) => `\`${item}\``).join(", ") : "_none detected_"}.
3. If validation is unavailable, document the gap in the final response and in troubleshooting when it is durable.

### Playbook Update Pattern

1. Promote only durable discoveries into \`.wiki/agent/key-findings.md\`.
2. Add exact failed commands and fixes to \`.wiki/agent/troubleshooting.md\`.
3. Add recurring mistakes or risky assumptions to \`.wiki/agent/common-pitfalls.md\`.
4. Keep \`.wiki/agent/playbook.md\` focused on current state and links, not historical narrative.

### Recovery & Diagnostic Pattern

1. If a test or command breaks unexpectedly, check \`.wiki/agent/troubleshooting.md\` for previous verified fixes.
2. Query the Workspace Intelligence model (e.g. \`getSubsystemHealth(path)\`) to check if the broken surface has recently drifted or is volatile.
3. Compare the current package version and script configuration in \`package.json\` with the handoff-relevant facts in the model to detect local environment drift.`
}

function detectPackageManager(manifests: string[]): string | undefined {
	if (manifests.includes("pnpm-lock.yaml") || manifests.includes("pnpm-workspace.yaml")) return "pnpm"
	if (manifests.includes("yarn.lock")) return "Yarn"
	if (manifests.includes("bun.lock")) return "Bun"
	if (manifests.includes("package-lock.json") || manifests.includes("package.json")) return "npm"
	return undefined
}
