import { access, readdir, readFile } from "node:fs/promises"
import path from "node:path"
import type { KnowledgeGraphService } from "@core/context/KnowledgeGraphService"
import type { TaskConfig } from "@core/task/tools/types/TaskConfig"
import { Logger } from "@/shared/services/Logger"
import {
	type ArchitectureDecisionFact,
	type SubsystemStabilityFact,
	WORKSPACE_KNOWLEDGE_CATEGORIES,
	type WorkspaceCognitiveModel,
	type WorkspaceDriftFinding,
	type WorkspaceFact,
	type WorkspaceIntelligenceArtifactRecord,
	type WorkspaceIntelligenceFinalizationInput,
	type WorkspaceIntelligenceRunResult,
	type WorkspaceIntelligenceSourceSnapshot,
	type WorkspaceKnowledgeCategory,
	type WorkspaceKnowledgeSignal,
	type WorkspaceProvenance,
} from "./types"
import { WorkspaceIntelligenceStore } from "./WorkspaceIntelligenceStore"

interface PackageJsonShape {
	name?: unknown
	version?: unknown
	scripts?: unknown
	workspaces?: unknown
}

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

const ROOT_CONTINUITY_DOCS = ["AGENT_PLAYBOOK.md", "WIKI.md", "TROUBLESHOOTING.md", "DECISIONS.md", "HANDOFF.md"]

const ARCHITECTURAL_SURFACES = ["src", "webview-ui", "broccolidb", "proto", "docs", ".wiki", ".agents"]

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
	"docs:check-root-readme",
	"docs:check-all",
	"doctor:ci",
]

export class WorkspaceIntelligenceEngine {
	private readonly store: WorkspaceIntelligenceStore

	constructor(private readonly config: TaskConfig) {
		this.store = new WorkspaceIntelligenceStore(config.cwd)
	}

	async learnFromFinalization(input: WorkspaceIntelligenceFinalizationInput): Promise<WorkspaceIntelligenceRunResult> {
		const previousModel = await this.store.readModel()
		const sourceSnapshot = await collectSourceSnapshot(this.config.cwd)
		const changedFiles = extractImpactFiles(input.impactSummary)
		const categories = createCategoryMap()
		const driftFindings = await detectDrift(this.config.cwd, sourceSnapshot, previousModel)

		addSignal(categories, {
			id: "permanent.package-identity",
			category: "permanent",
			title: "Workspace package identity",
			summary: sourceSnapshot.packageName
				? `The active package is ${sourceSnapshot.packageName}${sourceSnapshot.packageVersion ? ` at ${sourceSnapshot.packageVersion}` : ""}.`
				: "No package identity was detected from package.json.",
			evidence: sourceSnapshot.manifests.includes("package.json") ? ["package.json"] : [],
			confidence: sourceSnapshot.packageName ? "confirmed" : "needs_verification",
			source: "manifest",
			observedAt: input.timestamp,
			status: "active",
		})

		addSignal(categories, {
			id: "permanent.workspace-topology",
			category: "permanent",
			title: "Workspace topology",
			summary: sourceSnapshot.architecturalSurfaces.length
				? `Detected primary surfaces: ${sourceSnapshot.architecturalSurfaces.join(", ")}.`
				: "No primary architectural surfaces were detected.",
			evidence: sourceSnapshot.architecturalSurfaces,
			confidence: sourceSnapshot.architecturalSurfaces.length ? "confirmed" : "needs_verification",
			source: "repository",
			observedAt: input.timestamp,
			status: "active",
		})

		addSignal(categories, {
			id: "permanent.validation-contract",
			category: "permanent",
			title: "Validation contract",
			summary: sourceSnapshot.preferredCommands.length
				? `Preferred validation commands: ${sourceSnapshot.preferredCommands.join(", ")}.`
				: "No preferred validation scripts were detected from package.json.",
			evidence: sourceSnapshot.preferredCommands.length ? ["package.json"] : [],
			confidence: sourceSnapshot.preferredCommands.length ? "confirmed" : "needs_verification",
			source: "manifest",
			observedAt: input.timestamp,
			status: "active",
		})

		if (sourceSnapshot.providerKeys.length || sourceSnapshot.toolCount) {
			addSignal(categories, {
				id: "permanent.agent-surface-contract",
				category: "permanent",
				title: "Agent tool and provider surface",
				summary: [
					sourceSnapshot.toolCount ? `${sourceSnapshot.toolCount} default tools` : undefined,
					sourceSnapshot.readOnlyToolCount ? `${sourceSnapshot.readOnlyToolCount} read-only tools` : undefined,
					sourceSnapshot.providerKeys.length ? `${sourceSnapshot.providerKeys.length} provider keys` : undefined,
				]
					.filter(Boolean)
					.join(", "),
				evidence: ["src/shared/tools.ts", "src/core/api/index.ts"],
				confidence: "confirmed",
				source: "source_code",
				observedAt: input.timestamp,
				status: "active",
			})
		}

		addSignal(categories, {
			id: `operational.finalization.${sanitizeId(input.taskId)}`,
			category: "operational",
			title: "Current finalization pass",
			summary: `Task ${input.taskId} updated the workspace intelligence model during finalization.`,
			evidence: [".wiki/intelligence/workspace-intelligence.json", ".wiki/intelligence/workspace-intelligence.md"],
			confidence: "confirmed",
			source: "finalization",
			observedAt: input.timestamp,
			status: "active",
		})

		addSignal(categories, {
			id: `operational.changed-files.${sanitizeId(input.taskId)}`,
			category: "operational",
			title: "Changed files from current task",
			summary: changedFiles.length
				? `Current task impact touched: ${changedFiles.join(", ")}.`
				: "No structured changed-file impact was available for this task.",
			evidence: changedFiles.length ? changedFiles : ["finalization impact summary"],
			confidence: changedFiles.length ? "confirmed" : "needs_verification",
			source: "finalization",
			observedAt: input.timestamp,
			status: "active",
		})

		if (previousModel) {
			addSignal(categories, {
				id: "historical.previous-intelligence-model",
				category: "historical",
				title: "Previous intelligence model carried forward",
				summary: `Previous model was generated at ${previousModel.generatedAt} for task ${previousModel.taskId}.`,
				evidence: [".wiki/intelligence/workspace-intelligence.json"],
				confidence: "confirmed",
				source: "previous_model",
				observedAt: input.timestamp,
				status: "active",
			})
		}

		if (sourceSnapshot.documentationFiles.includes("DECISIONS.md")) {
			addSignal(categories, {
				id: "historical.decision-ledger",
				category: "historical",
				title: "Decision ledger available",
				summary: "Architectural rationale should be preserved in DECISIONS.md or ADR entries rather than buried in chat.",
				evidence: ["DECISIONS.md"],
				confidence: "confirmed",
				source: "documentation",
				observedAt: input.timestamp,
				status: "active",
			})
		}

		if (sourceSnapshot.documentationFiles.includes("TROUBLESHOOTING.md")) {
			addSignal(categories, {
				id: "failure.troubleshooting-ledger",
				category: "failure",
				title: "Failure knowledge ledger available",
				summary: "Known symptoms, failed approaches, fixes, and verification steps belong in TROUBLESHOOTING.md.",
				evidence: ["TROUBLESHOOTING.md"],
				confidence: "confirmed",
				source: "troubleshooting",
				observedAt: input.timestamp,
				status: "active",
			})
		}

		if (!changedFiles.length) {
			addSignal(categories, {
				id: "failure.missing-impact-summary",
				category: "failure",
				title: "Missing structured impact summary",
				summary: "The intelligence pass could not derive touched files from finalization impact evidence.",
				evidence: ["finalization impact summary"],
				confidence: "confirmed",
				source: "finalization",
				observedAt: input.timestamp,
				status: "needs_review",
			})
		}

		if (
			sourceSnapshot.architecturalSurfaces.includes("src/") &&
			sourceSnapshot.architecturalSurfaces.includes("webview-ui/")
		) {
			addSignal(categories, {
				id: "predictive.cross-surface-validation-risk",
				category: "predictive",
				title: "Cross-surface validation risk",
				summary: "Extension-host and webview changes can require separate validation paths.",
				evidence: ["src/", "webview-ui/"],
				confidence: "confirmed",
				source: "repository",
				observedAt: input.timestamp,
				status: "active",
			})
		}

		if (sourceSnapshot.architecturalSurfaces.includes("broccolidb/")) {
			addSignal(categories, {
				id: "predictive.substrate-boundary-risk",
				category: "predictive",
				title: "BroccoliDB boundary risk",
				summary: "Changes crossing the LUMI session layer and BroccoliDB substrate need explicit boundary checks.",
				evidence: ["broccolidb/", "src/core/context/KnowledgeGraphService.ts"],
				confidence: "confirmed",
				source: "repository",
				observedAt: input.timestamp,
				status: "active",
			})
		}

		for (const finding of driftFindings) {
			addSignal(categories, {
				id: `predictive.drift.${finding.id}`,
				category: "predictive",
				title: `Drift watch: ${finding.kind}`,
				summary: finding.summary,
				evidence: finding.evidence,
				confidence: finding.confidence,
				source: "harness",
				observedAt: input.timestamp,
				status: finding.severity === "high" ? "needs_review" : "active",
			})
		}

		carryForwardDurableSignals(previousModel, categories)

		const model: WorkspaceCognitiveModel = {
			schemaVersion: 2,
			workspaceName: sourceSnapshot.workspaceName,
			workspaceRoot: ".",
			generatedAt: input.timestamp,
			taskId: input.taskId,
			finalizationRunId: input.finalizationRunId,
			sourceSnapshot,
			categories,
			driftFindings,
			assumptions: buildAssumptions(sourceSnapshot),
			knownUnknowns: buildKnownUnknowns(sourceSnapshot, driftFindings),
			highRiskSurfaces: buildHighRiskSurfaces(sourceSnapshot, changedFiles),
			metaReflection: buildMetaReflection(sourceSnapshot, changedFiles, driftFindings),
			previousModel: previousModel
				? {
						generatedAt: previousModel.generatedAt,
						taskId: previousModel.taskId,
						categoryCounts: countCategories(previousModel.categories),
					}
				: undefined,
			facts: await buildFacts(this.config.cwd, sourceSnapshot, changedFiles, driftFindings, input, previousModel),
		}

		let records: WorkspaceIntelligenceArtifactRecord[] = []
		try {
			records = await this.store.writeModel(model)
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err)
			Logger.warn(`[Workspace Knowledge System] Failed to write model projections: ${errMsg}`)
			try {
				const { appendFile, mkdir } = await import("node:fs/promises")
				await mkdir(path.join(this.config.cwd, ".wiki/intelligence"), { recursive: true })
				const entry = {
					severity: "degraded" as const,
					code: "WRITE_ERROR",
					message: `failed to write model files: ${errMsg}`,
					timestamp: input.timestamp,
					source: "WorkspaceIntelligenceEngine.learnFromFinalization",
					recoveryHints:
						errMsg.toLowerCase().includes("permission") || errMsg.toLowerCase().includes("eacces")
							? [
									"Filesystem write permission denied. Verify directory permissions of .wiki/intelligence/",
									"Check if execution is running in a sandbox environment that restricts write access.",
								]
							: errMsg.toLowerCase().includes("disk") || errMsg.toLowerCase().includes("nospc")
								? ["Disk space is full. Free up some space or clean up directory files."]
								: [
										"Check the full diagnostic trace in .wiki/intelligence/diagnostics.jsonl",
										"Run a manual finalization attempt or check repository accessibility.",
									],
				}
				await appendFile(
					path.join(this.config.cwd, ".wiki/intelligence/diagnostics.jsonl"),
					`${JSON.stringify(entry)}\n`,
					"utf-8",
				)
			} catch {
				// Ignore write failures to stay advisory-only
			}
		}

		const memoryLayerUpdated = await this.publishToCognitiveMemory(model, input)

		return {
			model,
			records,
			categoryCounts: countCategories(model.categories),
			memoryLayerUpdated,
		}
	}

	private async publishToCognitiveMemory(
		model: WorkspaceCognitiveModel,
		input: WorkspaceIntelligenceFinalizationInput,
	): Promise<boolean> {
		const knowledgeGraphService = this.config.services?.knowledgeGraphService as KnowledgeGraphService | undefined
		if (!knowledgeGraphService) return false

		const summary = buildCognitiveMemorySummary(model)
		try {
			await knowledgeGraphService.appendMemoryLayer(input.taskId, "workspace_intelligence", summary)
			await knowledgeGraphService.addKnowledge(input.taskId, "workspace_intelligence", summary, {
				tags: ["workspace_intelligence", "finalization", "continuity"],
				confidence: 1,
				metadata: {
					finalizationRunId: input.finalizationRunId,
					generatedAt: model.generatedAt,
					categoryCounts: countCategories(model.categories),
				},
			})
			return true
		} catch {
			return false
		}
	}
}

async function collectSourceSnapshot(cwd: string): Promise<WorkspaceIntelligenceSourceSnapshot> {
	const packageJson = await readPackageJson(cwd)
	const packageScripts = getPackageScripts(packageJson)
	const providerKeys = await detectProviderKeys(cwd)

	return {
		workspaceName: path.basename(cwd) || cwd,
		packageName: typeof packageJson?.name === "string" ? packageJson.name : undefined,
		packageVersion: typeof packageJson?.version === "string" ? packageJson.version : undefined,
		packageScripts,
		preferredCommands: selectPreferredCommands(packageScripts),
		workspaces: normalizeWorkspaces(packageJson?.workspaces),
		manifests: await detectManifests(cwd),
		topLevelEntries: await listTopLevelEntries(cwd),
		documentationFiles: await detectDocumentationFiles(cwd),
		architecturalSurfaces: await detectArchitecturalSurfaces(cwd),
		providerKeys,
		toolCount: await detectToolCount(cwd),
		readOnlyToolCount: await detectReadOnlyToolCount(cwd),
		hasRoadmap: await pathExists(path.join(cwd, "ROADMAP.md")),
	}
}

async function detectDrift(
	cwd: string,
	snapshot: WorkspaceIntelligenceSourceSnapshot,
	previousModel: WorkspaceCognitiveModel | undefined,
): Promise<WorkspaceDriftFinding[]> {
	const findings: WorkspaceDriftFinding[] = []
	const missingContinuityDocs = ROOT_CONTINUITY_DOCS.filter((doc) => !snapshot.documentationFiles.includes(doc))
	if (missingContinuityDocs.length) {
		findings.push({
			id: "missing-continuity-docs",
			kind: "knowledge_gap",
			severity: "high",
			summary: `Missing continuity docs: ${missingContinuityDocs.join(", ")}.`,
			evidence: missingContinuityDocs,
			recommendation: "Create or restore the missing continuity entry points before relying on agent handoff quality.",
			confidence: "confirmed",
		})
	}

	const readme = await readFileIfExists(path.join(cwd, "README.md"))
	if (readme && snapshot.packageVersion && !readme.includes(snapshot.packageVersion)) {
		findings.push({
			id: "readme-version-drift",
			kind: "documentation_drift",
			severity: "medium",
			summary: `README.md does not mention package version ${snapshot.packageVersion}.`,
			evidence: ["package.json", "README.md"],
			recommendation: "Update README version references or remove version-specific claims from the README.",
			confidence: "inferred",
		})
	}

	if (readme && snapshot.providerKeys.length) {
		const providerCounts = extractProviderCounts(readme)
		for (const count of providerCounts) {
			if (count !== snapshot.providerKeys.length) {
				findings.push({
					id: `provider-count-drift-${count}`,
					kind: "documentation_drift",
					severity: "medium",
					summary: `README.md mentions ${count} providers while src/core/api/index.ts exposes ${snapshot.providerKeys.length}.`,
					evidence: ["README.md", "src/core/api/index.ts"],
					recommendation: "Align provider counts and provider names with the implementation switch cases.",
					confidence: "confirmed",
				})
			}
		}
	}

	if (previousModel) {
		const previousProviderCount = previousModel.sourceSnapshot.providerKeys.length
		if (previousProviderCount !== snapshot.providerKeys.length) {
			findings.push({
				id: "provider-surface-changed",
				kind: "implementation_drift",
				severity: "low",
				summary: `Provider surface changed from ${previousProviderCount} to ${snapshot.providerKeys.length} keys since the previous model.`,
				evidence: [".wiki/intelligence/workspace-intelligence.json", "src/core/api/index.ts"],
				recommendation: "Review provider docs, settings UI, and tests whenever provider count changes.",
				confidence: "confirmed",
			})
		}
	}

	if (!snapshot.preferredCommands.length) {
		findings.push({
			id: "missing-validation-contract",
			kind: "operational_drift",
			severity: "medium",
			summary: "No preferred validation scripts were detected from package.json.",
			evidence: ["package.json"],
			recommendation: "Record workspace-native validation commands before future agents infer ad hoc commands.",
			confidence: "confirmed",
		})
	}

	return findings
}

function createCategoryMap(): Record<WorkspaceKnowledgeCategory, WorkspaceKnowledgeSignal[]> {
	return {
		permanent: [],
		operational: [],
		historical: [],
		failure: [],
		predictive: [],
	}
}

function addSignal(
	categories: Record<WorkspaceKnowledgeCategory, WorkspaceKnowledgeSignal[]>,
	signal: WorkspaceKnowledgeSignal,
): void {
	const bucket = categories[signal.category]
	const existingIndex = bucket.findIndex((item) => item.id === signal.id)
	if (existingIndex >= 0) {
		bucket[existingIndex] = signal
		return
	}
	bucket.push(signal)
}

function carryForwardDurableSignals(
	previousModel: WorkspaceCognitiveModel | undefined,
	categories: Record<WorkspaceKnowledgeCategory, WorkspaceKnowledgeSignal[]>,
): void {
	if (!previousModel) return
	for (const category of WORKSPACE_KNOWLEDGE_CATEGORIES) {
		if (category === "operational") continue
		for (const signal of previousModel.categories[category] ?? []) {
			if (categories[category].some((item) => item.id === signal.id)) continue
			categories[category].push({ ...signal, status: "carried_forward" })
		}
	}
}

function countCategories(
	categories: Record<WorkspaceKnowledgeCategory, WorkspaceKnowledgeSignal[]>,
): Record<WorkspaceKnowledgeCategory, number> {
	return {
		permanent: categories.permanent.length,
		operational: categories.operational.length,
		historical: categories.historical.length,
		failure: categories.failure.length,
		predictive: categories.predictive.length,
	}
}

async function readPackageJson(cwd: string): Promise<PackageJsonShape | undefined> {
	try {
		const raw = await readFile(path.join(cwd, "package.json"), "utf-8")
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
			.slice(0, 40)
	} catch {
		return []
	}
}

async function detectDocumentationFiles(cwd: string): Promise<string[]> {
	const docs = [
		...ROOT_CONTINUITY_DOCS,
		"README.md",
		"docs/README.md",
		"docs/architecture/current.md",
		".wiki/index.md",
		".wiki/changelog.md",
	]
	const found: string[] = []
	for (const relPath of docs) {
		if (await pathExists(path.join(cwd, relPath))) {
			found.push(relPath)
		}
	}
	return found
}

async function detectArchitecturalSurfaces(cwd: string): Promise<string[]> {
	const found: string[] = []
	for (const relPath of ARCHITECTURAL_SURFACES) {
		if (await pathExists(path.join(cwd, relPath))) {
			found.push(`${relPath}/`)
		}
	}
	return found
}

async function detectProviderKeys(cwd: string): Promise<string[]> {
	const text = await readFileIfExists(path.join(cwd, "src/core/api/index.ts"))
	if (!text) return []
	const keys = new Set<string>()
	for (const match of text.matchAll(/case\s+"([^"]+)":/g)) {
		keys.add(match[1])
	}
	return Array.from(keys).sort()
}

async function detectToolCount(cwd: string): Promise<number | undefined> {
	const text = await readFileIfExists(path.join(cwd, "src/shared/tools.ts"))
	if (!text) return undefined
	const enumBody = text.match(/export enum DietCodeDefaultTool \{([\s\S]*?)\n\}/)?.[1]
	if (!enumBody) return undefined
	return Array.from(enumBody.matchAll(/=\s*"[^"]+"/g)).length
}

async function detectReadOnlyToolCount(cwd: string): Promise<number | undefined> {
	const text = await readFileIfExists(path.join(cwd, "src/shared/tools.ts"))
	if (!text) return undefined
	const readOnlyBody = text.match(/export const READ_ONLY_TOOLS = \[([\s\S]*?)\] as const/)?.[1]
	if (!readOnlyBody) return undefined
	return Array.from(readOnlyBody.matchAll(/DietCodeDefaultTool\./g)).length
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

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath)
		return true
	} catch {
		return false
	}
}

async function readFileIfExists(filePath: string): Promise<string | undefined> {
	try {
		return await readFile(filePath, "utf-8")
	} catch {
		return undefined
	}
}

function extractImpactFiles(impactSummary: string): string[] {
	const files = new Set<string>()
	for (const match of impactSummary.matchAll(/`([^`]+)`/g)) {
		const value = match[1].trim()
		if (value && !value.startsWith("npm ") && !value.includes("\n")) {
			files.add(value)
		}
	}
	return Array.from(files).sort()
}

function extractProviderCounts(readme: string): number[] {
	const words = new Map([
		["one", 1],
		["two", 2],
		["three", 3],
		["four", 4],
		["five", 5],
		["six", 6],
		["seven", 7],
		["eight", 8],
		["nine", 9],
		["ten", 10],
	])
	const counts = new Set<number>()
	for (const match of readme.matchAll(
		/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:active\s+)?providers?\b/gi,
	)) {
		const raw = match[1].toLowerCase()
		const numeric = Number.parseInt(raw, 10)
		counts.add(Number.isNaN(numeric) ? (words.get(raw) ?? 0) : numeric)
	}
	return Array.from(counts).filter((count) => count > 0)
}

function buildAssumptions(snapshot: WorkspaceIntelligenceSourceSnapshot): string[] {
	const assumptions = [
		"Implementation files remain the source of truth when documentation disagrees.",
		"Finalization is the durable learning point for completed task knowledge.",
	]
	if (snapshot.preferredCommands.length) {
		assumptions.push("Detected package scripts are preferred over invented validation commands.")
	}
	if (snapshot.hasRoadmap) {
		assumptions.push("ROADMAP.md may influence long-horizon steering and completion gates.")
	}
	return assumptions
}

function buildKnownUnknowns(snapshot: WorkspaceIntelligenceSourceSnapshot, driftFindings: WorkspaceDriftFinding[]): string[] {
	const unknowns: string[] = []
	if (!snapshot.preferredCommands.length) {
		unknowns.push("Workspace-native validation commands are not known from package.json.")
	}
	if (!snapshot.documentationFiles.includes("HANDOFF.md")) {
		unknowns.push("Current handoff state is missing from root continuity docs.")
	}
	if (driftFindings.length) {
		unknowns.push("At least one drift finding needs human or agent review.")
	}
	return unknowns
}

function buildHighRiskSurfaces(snapshot: WorkspaceIntelligenceSourceSnapshot, changedFiles: string[]): string[] {
	const highRisk = new Set<string>()
	for (const file of changedFiles) {
		if (file.startsWith("src/core/task/tools/finalization/")) highRisk.add("finalization lifecycle")
		if (file.startsWith("src/shared/completion/")) highRisk.add("completion receipt contract")
		if (file.startsWith("src/core/api/")) highRisk.add("provider dispatch")
		if (file.startsWith("webview-ui/")) highRisk.add("webview UI")
		if (file.startsWith("broccolidb/")) highRisk.add("BroccoliDB substrate")
	}
	if (snapshot.architecturalSurfaces.includes("broccolidb/")) {
		highRisk.add("LUMI/BroccoliDB boundary")
	}
	return Array.from(highRisk).sort()
}

function buildMetaReflection(
	snapshot: WorkspaceIntelligenceSourceSnapshot,
	changedFiles: string[],
	driftFindings: WorkspaceDriftFinding[],
): WorkspaceCognitiveModel["metaReflection"] {
	const repeatedFriction: string[] = []
	const rediscoveryCosts: string[] = []
	const selfImprovements: string[] = [
		"Persisted a typed workspace intelligence model during finalization.",
		"Projected the model into a scan-friendly markdown view for future agents.",
	]

	if (!snapshot.preferredCommands.length) {
		repeatedFriction.push("Validation command discovery is still manual.")
		rediscoveryCosts.push("Future agents must inspect manifests before validating changes.")
	} else {
		rediscoveryCosts.push("Validation discovery reduced by storing preferred package commands.")
	}

	if (changedFiles.length) {
		rediscoveryCosts.push("Current task impact captured from finalization evidence.")
	} else {
		repeatedFriction.push("Finalization impact summary did not expose structured changed files.")
	}

	if (driftFindings.length) {
		repeatedFriction.push("Documentation and implementation drift still require periodic reconciliation.")
		selfImprovements.push("Recorded drift findings as predictive knowledge instead of leaving them implicit.")
	}

	return {
		repeatedFriction,
		rediscoveryCosts,
		selfImprovements,
	}
}

function buildCognitiveMemorySummary(model: WorkspaceCognitiveModel): string {
	const counts = countCategories(model.categories)
	return [
		`Workspace intelligence refreshed for ${model.workspaceName} at ${model.generatedAt}.`,
		`Categories: permanent=${counts.permanent}, operational=${counts.operational}, historical=${counts.historical}, failure=${counts.failure}, predictive=${counts.predictive}.`,
		model.sourceSnapshot.preferredCommands.length
			? `Preferred validation: ${model.sourceSnapshot.preferredCommands.join(", ")}.`
			: "Preferred validation commands are unknown.",
		model.driftFindings.length
			? `Drift findings: ${model.driftFindings.map((finding) => finding.summary).join(" | ")}`
			: "No drift findings detected.",
	].join("\n")
}

function sanitizeId(value: string): string {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "unknown"
	)
}

async function buildFacts(
	cwd: string,
	snapshot: WorkspaceIntelligenceSourceSnapshot,
	changedFiles: string[],
	driftFindings: WorkspaceDriftFinding[],
	input: WorkspaceIntelligenceFinalizationInput,
	previousModel: WorkspaceCognitiveModel | undefined,
): Promise<WorkspaceFact[]> {
	const currentFacts: WorkspaceFact[] = []

	// 1. Stable Subsystems
	for (const surface of snapshot.architecturalSurfaces) {
		const isVolatile = changedFiles.some((file) => file.startsWith(surface))
		if (!isVolatile) {
			currentFacts.push({
				id: `fact-subsystem-${sanitizeId(surface)}-stability`,
				type: "subsystem_stability",
				value: { path: surface, status: "stable" },
				confidence: "confirmed",
				provenance: [
					{
						type: "finalization_evidence",
						path: surface,
						runId: input.finalizationRunId,
						description: `Subsystem ${surface} was not modified in the task impact summary for task ${input.taskId}.`,
						timestamp: input.timestamp,
					},
				],
				lifecycle: "active",
				lastUpdated: input.timestamp,
			})
		}
	}

	// 2. Volatile Subsystems
	for (const surface of snapshot.architecturalSurfaces) {
		const surfaceChangedFiles = changedFiles.filter((file) => file.startsWith(surface))
		if (surfaceChangedFiles.length > 0) {
			currentFacts.push({
				id: `fact-subsystem-${sanitizeId(surface)}-stability`,
				type: "subsystem_stability",
				value: { path: surface, status: "volatile" },
				confidence: "confirmed",
				provenance: surfaceChangedFiles.map((file) => ({
					type: "file_change",
					path: file,
					runId: input.finalizationRunId,
					description: `Subsystem ${surface} was modified due to changes in ${file} during task ${input.taskId}.`,
					timestamp: input.timestamp,
				})),
				lifecycle: "active",
				lastUpdated: input.timestamp,
			})
		}
	}

	// 3. Recent Architecture Decisions
	const decisions = await parseArchitectureDecisions(cwd)
	for (const dec of decisions) {
		currentFacts.push({
			id: `fact-adr-${sanitizeId(dec.id)}`,
			type: "architecture_decision",
			value: dec,
			confidence: "confirmed",
			provenance: [
				{
					type: "adr",
					path: "DECISIONS.md",
					ref: dec.id,
					description: `Architectural Decision Record ${dec.id} parsed from DECISIONS.md.`,
					timestamp: input.timestamp,
				},
			],
			lifecycle: "active",
			lastUpdated: input.timestamp,
		})
	}

	// 4. Stale Documentation Surfaces
	for (const finding of driftFindings) {
		if (finding.kind === "documentation_drift" || finding.kind === "knowledge_gap") {
			currentFacts.push({
				id: `fact-doc-drift-${sanitizeId(finding.id)}`,
				type: "documentation_surface",
				value: { summary: finding.summary },
				confidence: finding.confidence,
				provenance: [
					{
						type: "manifest",
						path: finding.evidence.join(", "),
						runId: input.finalizationRunId,
						ref: finding.id,
						description: `Drift finding '${finding.kind}': ${finding.summary}. Recommendation: ${finding.recommendation}`,
						timestamp: input.timestamp,
					},
				],
				lifecycle: "active",
				lastUpdated: input.timestamp,
			})
		}
	}

	// 5. Recurring Risk Areas
	if (changedFiles.some((f) => f.startsWith("src/")) && changedFiles.some((f) => f.startsWith("webview-ui/"))) {
		currentFacts.push({
			id: `fact-risk-cross-surface`,
			type: "risk_area",
			value: { risk: "Cross-surface validation risk (both src/ and webview-ui/ modified)" },
			confidence: "confirmed",
			provenance: [
				{
					type: "finalization_evidence",
					runId: input.finalizationRunId,
					description:
						"Task modified both the VS Code extension host (src/) and the webview interface (webview-ui/), requiring separate validation pipelines.",
					timestamp: input.timestamp,
				},
			],
			lifecycle: "active",
			lastUpdated: input.timestamp,
		})
	}
	if (snapshot.architecturalSurfaces.includes("broccolidb/") && changedFiles.some((f) => f.startsWith("broccolidb/"))) {
		currentFacts.push({
			id: `fact-risk-broccolidb-boundary`,
			type: "risk_area",
			value: { risk: "BroccoliDB boundary risk (substrate modified)" },
			confidence: "confirmed",
			provenance: [
				{
					type: "finalization_evidence",
					runId: input.finalizationRunId,
					description: "Task modified the BroccoliDB database engine, requiring strict boundary validations.",
					timestamp: input.timestamp,
				},
			],
			lifecycle: "active",
			lastUpdated: input.timestamp,
		})
	}
	for (const finding of driftFindings) {
		if (finding.severity === "high") {
			currentFacts.push({
				id: `fact-risk-drift-${sanitizeId(finding.id)}`,
				type: "risk_area",
				value: { risk: `High risk: ${finding.summary}` },
				confidence: finding.confidence,
				provenance: [
					{
						type: "finalization_evidence",
						runId: input.finalizationRunId,
						ref: finding.id,
						description: `High severity drift finding detected: ${finding.summary}`,
						timestamp: input.timestamp,
					},
				],
				lifecycle: "active",
				lastUpdated: input.timestamp,
			})
		}
	}

	// 6. Handoff-Relevant Facts
	const commonProvenance: WorkspaceProvenance = {
		type: "finalization_evidence",
		runId: input.finalizationRunId,
		description: `Recorded during session finalization of task ${input.taskId}.`,
		timestamp: input.timestamp,
	}

	if (snapshot.packageName) {
		currentFacts.push({
			id: `fact-handoff-package-name`,
			type: "handoff_fact",
			value: { fact: `Active package name: ${snapshot.packageName}` },
			confidence: "confirmed",
			provenance: [
				{
					...commonProvenance,
					type: "manifest",
					path: "package.json",
					description: "Parsed active package name from package.json.",
				},
			],
			lifecycle: "active",
			lastUpdated: input.timestamp,
		})
	}
	if (snapshot.packageVersion) {
		currentFacts.push({
			id: `fact-handoff-package-version`,
			type: "handoff_fact",
			value: { fact: `Active package version: ${snapshot.packageVersion}` },
			confidence: "confirmed",
			provenance: [
				{
					...commonProvenance,
					type: "manifest",
					path: "package.json",
					description: "Parsed active package version from package.json.",
				},
			],
			lifecycle: "active",
			lastUpdated: input.timestamp,
		})
	}
	if (snapshot.preferredCommands.length) {
		currentFacts.push({
			id: `fact-handoff-validation-commands`,
			type: "handoff_fact",
			value: { fact: `Preferred validation: ${snapshot.preferredCommands.join(", ")}` },
			confidence: "confirmed",
			provenance: [
				{
					...commonProvenance,
					type: "manifest",
					path: "package.json",
					description: "Identified validation scripts in package.json.",
				},
			],
			lifecycle: "active",
			lastUpdated: input.timestamp,
		})
	}
	currentFacts.push({
		id: `fact-handoff-last-task`,
		type: "handoff_fact",
		value: { fact: `Last modified by task: ${input.taskId}` },
		confidence: "confirmed",
		provenance: [commonProvenance],
		lifecycle: "active",
		lastUpdated: input.timestamp,
	})

	const previousFacts = previousModel?.facts || []
	return mergeAndLifecycleManageFacts(currentFacts, previousFacts, input)
}

export function mergeAndLifecycleManageFacts(
	currentFacts: WorkspaceFact[],
	previousFacts: WorkspaceFact[],
	input: WorkspaceIntelligenceFinalizationInput,
): WorkspaceFact[] {
	const currentFactsMap = new Map<string, WorkspaceFact>()
	for (const fact of currentFacts) {
		const existing = currentFactsMap.get(fact.id)
		if (existing) {
			existing.provenance = [...existing.provenance, ...fact.provenance]
			if (existing.confidence === "needs_verification" || fact.confidence === "needs_verification") {
				existing.confidence = "needs_verification"
			}
		} else {
			currentFactsMap.set(fact.id, fact)
		}
	}
	const deduplicatedCurrent = Array.from(currentFactsMap.values())

	const merged: WorkspaceFact[] = [...deduplicatedCurrent]

	for (const prev of previousFacts) {
		// If currentFacts already contains a fact with the same ID:
		const matchingCurrent = deduplicatedCurrent.find((f) => f.id === prev.id)
		if (matchingCurrent) {
			continue
		}

		// Decouple Subsystem Stability Conflicts
		if (prev.type === "subsystem_stability") {
			const currentConflicting = deduplicatedCurrent.find(
				(f) =>
					f.type === "subsystem_stability" &&
					(f.value as SubsystemStabilityFact)?.path === (prev.value as SubsystemStabilityFact)?.path,
			)
			if (currentConflicting) {
				// Mark old stability fact as superseded and link current runId
				merged.push({
					...prev,
					lifecycle: "superseded",
					lastUpdated: input.timestamp,
					provenance: [
						...prev.provenance,
						{
							type: "finalization_evidence",
							runId: input.finalizationRunId,
							description: `Fact superseded because subsystem stability status changed to ${(currentConflicting.value as SubsystemStabilityFact)?.status} in task ${input.taskId}.`,
							timestamp: input.timestamp,
						},
					],
				})
				continue
			}
		}

		// Decouple ADR Status changes
		if (prev.type === "architecture_decision") {
			const currentConflicting = deduplicatedCurrent.find(
				(f) =>
					f.type === "architecture_decision" &&
					(f.value as ArchitectureDecisionFact)?.id === (prev.value as ArchitectureDecisionFact)?.id &&
					(f.value as ArchitectureDecisionFact)?.status !== (prev.value as ArchitectureDecisionFact)?.status,
			)
			if (currentConflicting) {
				merged.push({
					...prev,
					lifecycle: "superseded",
					lastUpdated: input.timestamp,
					provenance: [
						...prev.provenance,
						{
							type: "finalization_evidence",
							runId: input.finalizationRunId,
							description: `Decision status changed to ${(currentConflicting.value as ArchitectureDecisionFact)?.status} in task ${input.taskId}.`,
							timestamp: input.timestamp,
						},
					],
				})
				continue
			}
		}

		merged.push(prev)
	}

	// Audit pass: mark facts with incomplete or missing provenance as needs_verification
	for (const fact of merged) {
		const hasIncompleteProvenance = fact.provenance.some((p) => {
			return !p.description || !p.type || (!p.runId && !p.path && !p.ref)
		})
		if (hasIncompleteProvenance || fact.provenance.length === 0) {
			fact.confidence = "needs_verification"
		}
	}

	return merged
}

async function parseArchitectureDecisions(cwd: string): Promise<Array<{ id: string; title: string; status: string }>> {
	const decisionsPath = path.join(cwd, "DECISIONS.md")
	const decisionsText = await readFileIfExists(decisionsPath)
	if (!decisionsText) return []

	const decisions: Array<{ id: string; title: string; status: string }> = []
	const sections = decisionsText.split(/\n##\s+/)
	for (const section of sections) {
		const match = section.match(/^(ADR-\d+):\s*([^\n]+)/)
		if (match) {
			const id = match[1].trim()
			const title = match[2].trim()
			const statusMatch = section.match(/\*\*Status:\*\*\s*([^\n]+)/i)
			const status = statusMatch ? statusMatch[1].trim() : "Unknown"
			decisions.push({ id, title, status })
		}
	}
	return decisions
}
