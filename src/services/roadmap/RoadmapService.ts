import * as crypto from "crypto"
import { execa } from "execa"
import * as fs from "fs/promises"
import * as path from "path"
import { AUTO_GOVERNANCE, isAutoClearableGovernanceOnly, midTaskAgentNextCall } from "./RoadmapAutoGovernance"
import { invalidateRoadmapWorkspaceCache } from "./RoadmapCache"
import { isDigestContext, slimCheckpointPayload } from "./RoadmapCheckpointDigest"
import { buildCockpitPayload } from "./RoadmapCockpit"
import { getRoadmapConfig, type RoadmapConfig } from "./RoadmapConfig"
import { runDoctorChecks } from "./RoadmapDoctor"
import { formatExplainStaleReport } from "./RoadmapFreshness"
import { buildGateStateFromInputs, collectGateInputs } from "./RoadmapGateCatalog"
import {
	determinePhase,
	formatExplainGateReport,
	gateExplainParamsFromStatus,
	isBootstrapIncomplete,
	wrapClarityEnvelope as operatorWrapClarityEnvelope,
	recommendNextAction,
} from "./RoadmapOperator"
import { clearLastError, formatWatchReport, readCurrentProgress, readLastError, recordLastError } from "./RoadmapProgress"
import {
	bootstrapSkeleton,
	findBootstrapPlaceholders,
	getSectionBody,
	HEALTH_STATUSES,
	REQUIRED_SECTIONS,
	RoadmapValidation,
	SOUP_RISK_LEVELS,
	validateRoadmapContent,
} from "./RoadmapSchema"
import { BUNDLED_SKILL_REL } from "./RoadmapSkillInstall"
import { buildSnapshotKey, type EvidenceTier, getSnapshotFromCache, setSnapshotCache } from "./RoadmapSnapshot"

interface HeavyScanResult {
	workspace: string
	sourceFiles: [string, string][]
	todoMarkers: any[]
	testFileCount: number
}

const SKIP_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	".venv",
	"venv",
	"__pycache__",
	"kernel/build",
	"broccolidb/node_modules",
	".cursor",
])

const SOURCE_SUFFIXES = new Set([".py", ".ts", ".js", ".mm", ".cpp", ".go", ".rs"])
const TODO_SUFFIXES = new Set([".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs", ".md", ".yaml", ".yml"])

const SOURCE_LIMIT = 400
const SOURCE_MAX_BYTES = 300_000
const TODO_LIMIT = 40
const TODO_MAX_BYTES = 200_000
const TEST_LIMIT = 200

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}

async function isDir(dirPath: string): Promise<boolean> {
	try {
		const stat = await fs.stat(dirPath)
		return stat.isDirectory()
	} catch {
		return false
	}
}

async function readText(filePath: string, limit = 8000): Promise<string> {
	try {
		const text = await fs.readFile(filePath, "utf8")
		return text.slice(0, limit)
	} catch {
		return ""
	}
}

interface LineageEntry {
	operation_id: string
	timestamp: string
	tool: string
	action: string
	schema_valid: boolean | null
	health_status: string | null
	hash: string
	diff_summary: string
	causality_token: string
}

export interface TaskItem {
	id: string
	title: string
	body: string
}

export interface TaskList {
	intro: string
	items: TaskItem[]
}

export interface RoadmapRuntimeState {
	version: number
	project_identity: {
		core_purpose: string
		anti_goals: string
		raw_body: string
	}
	health: {
		status: string
		summary: string
		raw_body: string
	}
	strategic_narrative: string
	tasks: {
		now: TaskList
		next: TaskList
		later: TaskList
	}
	discovery: string
	maintenance_gravity: string
	code_soup_audit: {
		risk_level: string
		raw_body: string
	}
	decision_log: string
	checkpoint: {
		date: string
		summary: string
		raw_body: string
	}
	archive: string
	active_window?: {
		current_focus_ids: string[]
		locality_scope: string[]
	}
	memory?: {
		continuation_anchors: Record<string, string>
		last_completed_step?: string
	}
	locks?: Record<
		string,
		{
			owner_agent: string
			leased_at: string
			expires_at: string
		}
	>
	scheduler_state?: {
		pressure_score?: number
		queue_size?: number
		last_cooldown_timestamp?: string
	}
	version_vectors?: Record<string, number>
}

export function hydrateRuntimeState(content: string): RoadmapRuntimeState {
	const sec1 = getSectionBody(content, "1. Project Center of Gravity")
	const sec2 = getSectionBody(content, "2. Roadmap Health")
	const sec3 = getSectionBody(content, "3. Strategic Narrative")
	const sec4 = getSectionBody(content, "4. Now")
	const sec5 = getSectionBody(content, "5. Next")
	const sec6 = getSectionBody(content, "6. Later")
	const sec7 = getSectionBody(content, "7. Discovery")
	const sec8 = getSectionBody(content, "8. Maintenance Gravity")
	const sec9 = getSectionBody(content, "9. Centralization & Code Soup Audit")
	const sec10 = getSectionBody(content, "10. Decision Log")
	const sec11 = getSectionBody(content, "11. Recent Checkpoint")
	const sec12 = getSectionBody(content, "12. Archive")

	const extractField = (body: string, prefix: string): string => {
		const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
		const regex = new RegExp(`\\*\\*${escapedPrefix}:\\*\\*\\s*([\\s\\S]*?)(?=\\*\\*|##|$)`, "i")
		const match = regex.exec(body)
		return match ? match[1].trim() : ""
	}

	const parseTasks = (body: string): TaskList => {
		const items: TaskItem[] = []
		const regex = /^###\s+\d+\.\s+(.*?)\s*$/gm
		const headerMatches: Array<{ title: string; index: number; text: string }> = []
		let m
		while ((m = regex.exec(body)) !== null) {
			headerMatches.push({ title: m[1].trim(), index: m.index, text: m[0] })
		}
		let intro = ""
		if (headerMatches.length > 0) {
			intro = body.slice(0, headerMatches[0].index).trim()
			for (let i = 0; i < headerMatches.length; i++) {
				const current = headerMatches[i]
				const nextIndex = i + 1 < headerMatches.length ? headerMatches[i + 1].index : body.length
				const taskBody = body.slice(current.index + current.text.length, nextIndex).trim()
				const id = crypto.createHash("sha256").update(current.title).digest("hex").slice(0, 8)
				items.push({ id, title: current.title, body: taskBody })
			}
		} else {
			intro = body.trim()
		}
		return { intro, items }
	}

	const core_purpose = extractField(sec1, "Core Purpose")
	const anti_goals = extractField(sec1, "What This Project Must Not Become")
	const status = extractField(sec2, "Status") || "Coherent"
	const summary = extractField(sec2, "Summary")
	const risk_level = extractField(sec9, "Overall Code Soup Risk") || "Low"
	const date = extractField(sec11, "Date")
	const checkpoint_summary = extractField(sec11, "Checkpoint Summary")

	return {
		version: 1,
		project_identity: {
			core_purpose,
			anti_goals,
			raw_body: sec1,
		},
		health: {
			status,
			summary,
			raw_body: sec2,
		},
		strategic_narrative: sec3,
		tasks: {
			now: parseTasks(sec4),
			next: parseTasks(sec5),
			later: parseTasks(sec6),
		},
		discovery: sec7,
		maintenance_gravity: sec8,
		code_soup_audit: {
			risk_level,
			raw_body: sec9,
		},
		decision_log: sec10,
		checkpoint: {
			date,
			summary: checkpoint_summary,
			raw_body: sec11,
		},
		archive: sec12,
	}
}

export function projectRuntimeStateToMarkdown(state: RoadmapRuntimeState): string {
	let md = `# ROADMAP.md\n\n`
	md += `## 1. Project Center of Gravity\n\n${state.project_identity.raw_body.trim()}\n\n`
	md += `## 2. Roadmap Health\n\n${state.health.raw_body.trim()}\n\n`
	md += `## 3. Strategic Narrative\n\n${state.strategic_narrative.trim()}\n\n`

	const renderTaskList = (list: TaskList): string => {
		let res = ""
		if (list.intro) {
			res += `${list.intro.trim()}\n\n`
		}
		if (list.items.length > 0) {
			list.items.forEach((task, idx) => {
				res += `### ${idx + 1}. ${task.title.trim()}\n\n${task.body.trim()}\n\n`
			})
		}
		return res
	}

	md += `## 4. Now\n\n${renderTaskList(state.tasks.now)}`
	md += `## 5. Next\n\n${renderTaskList(state.tasks.next)}`
	md += `## 6. Later\n\n${renderTaskList(state.tasks.later)}`

	md += `## 7. Discovery\n\n${state.discovery.trim()}\n\n`
	md += `## 8. Maintenance Gravity\n\n${state.maintenance_gravity.trim()}\n\n`
	md += `## 9. Centralization & Code Soup Audit\n\n${state.code_soup_audit.raw_body.trim()}\n\n`
	md += `## 10. Decision Log\n\n${state.decision_log.trim()}\n\n`
	md += `## 11. Recent Checkpoint\n\n${state.checkpoint.raw_body.trim()}\n\n`
	md += `## 12. Archive\n\n${state.archive.trim()}\n`
	return md
}

async function writeRoadmapAtomically(workspace: string, content: string): Promise<void> {
	const roadmapPath = path.join(workspace, "ROADMAP.md")
	const tempPath = path.join(workspace, "ROADMAP.md.tmp")
	await fs.mkdir(path.dirname(tempPath), { recursive: true })
	await fs.writeFile(tempPath, content, "utf8")
	try {
		const verifiedContent = await fs.readFile(tempPath, "utf8")
		if (!verifiedContent || verifiedContent.trim().length === 0) {
			throw new Error("Written content is empty")
		}
		if (verifiedContent.length < 10) {
			throw new Error("Written content too short to be a valid ROADMAP.md")
		}
	} catch (err) {
		try {
			await fs.unlink(tempPath)
		} catch {}
		throw new Error(`Roadmap atomic write verification failed: ${err instanceof Error ? err.message : String(err)}`)
	}
	await fs.rename(tempPath, roadmapPath)
}

export async function computeDependencyManifestsHash(workspace: string): Promise<string> {
	const manifests = ["package.json", "Cargo.toml", "go.mod", "pyproject.toml"]
	let combined = ""
	for (const file of manifests) {
		const fullPath = path.join(workspace, file)
		if (await fileExists(fullPath)) {
			try {
				const content = await fs.readFile(fullPath, "utf8")
				combined += `${file}:${content}\n`
			} catch {}
		}
	}
	if (!combined) return "no_manifests"
	return crypto.createHash("sha256").update(combined).digest("hex").slice(0, 16)
}

export function slimEvidence(evidence: any): any {
	if (!evidence) return evidence
	return {
		workspace: evidence.workspace,
		gathered_at: evidence.gathered_at,
		evidence_tier: evidence.evidence_tier,
		roadmap: evidence.roadmap,
		readmes: (evidence.readmes || []).map((r: any) => ({ path: r.path, excerpt_length: r.excerpt ? r.excerpt.length : 0 })),
		architecture_docs: (evidence.architecture_docs || []).map((d: any) => ({
			path: d.path,
			excerpt_length: d.excerpt ? d.excerpt.length : 0,
		})),
		configs: (evidence.configs || []).map((c: any) => ({ path: c.path, excerpt_length: c.excerpt ? c.excerpt.length : 0 })),
		git: {
			available: evidence.git?.available,
			recent_commits: (evidence.git?.recent_commits || []).slice(0, 3),
			status_short: evidence.git?.status_short || [],
			diff_stat_recent: (evidence.git?.diff_stat_recent || []).slice(0, 5),
			changed_files_recent: (evidence.git?.changed_files_recent || []).slice(0, 5),
		},
		todo_markers: (evidence.todo_markers || []).map((t: any) => ({ file: t.file, line: t.line, marker: t.marker })),
		todo_markers_count: (evidence.todo_markers || []).length,
		test_file_count: evidence.test_file_count,
		uncertainty: evidence.uncertainty || [],
		project_fingerprint: {
			project_name: evidence.project_fingerprint?.project_name,
			package_name: evidence.project_fingerprint?.package_name,
			stack_summary: evidence.project_fingerprint?.stack_summary,
			project_archetype: evidence.project_fingerprint?.project_archetype,
			has_tests: evidence.project_fingerprint?.has_tests,
			has_ci: evidence.project_fingerprint?.has_ci,
			verification_commands: evidence.project_fingerprint?.verification_commands,
			entry_points: evidence.project_fingerprint?.entry_points,
		},
	}
}

async function recordMutationLineage(workspace: string, entry: Partial<LineageEntry>): Promise<void> {
	const roadmapPath = path.join(workspace, "ROADMAP.md")
	let fileHash = ""
	const diffSummary = entry.diff_summary || ""
	try {
		if (await fileExists(roadmapPath)) {
			const content = await fs.readFile(roadmapPath, "utf8")
			fileHash = crypto.createHash("sha256").update(content).digest("hex").slice(0, 16)
		}
	} catch {}

	const current = await RoadmapService.getInstance().readState(workspace)
	const lineage: LineageEntry[] = current.lineage || []

	const opId = crypto.randomUUID()
	const timestamp = new Date().toISOString()

	const newEntry: LineageEntry = {
		operation_id: opId,
		timestamp,
		tool: entry.tool || current.last_mutation_tool || "manual",
		action: entry.action || "mutate",
		schema_valid: entry.schema_valid ?? current.schema_valid ?? null,
		health_status: entry.health_status ?? current.health_status ?? null,
		hash: fileHash || "",
		diff_summary: diffSummary || "",
		causality_token: "",
	}

	const lastEntry = lineage.length > 0 ? lineage[lineage.length - 1] : null
	const prevToken = lastEntry?.causality_token || "genesis_root_token"
	const valStr = String(newEntry.schema_valid)
	const actionStr = String(newEntry.action)
	newEntry.causality_token = crypto
		.createHash("sha256")
		.update(prevToken + timestamp + actionStr + valStr + fileHash)
		.digest("hex")
		.slice(0, 16)

	lineage.push(newEntry)
	const trimmedLineage = lineage.slice(-5)

	await RoadmapService.getInstance().writeState(workspace, {
		lineage: trimmedLineage,
	})
}

async function scanWorkspace(root: string): Promise<HeavyScanResult> {
	const sourceFiles: [string, string][] = []
	const todoMarkers: any[] = []
	let testFileCount = 0

	const queue: string[] = [root]

	while (queue.length > 0) {
		const currentDir = queue.shift()!
		let entries: any[] = []
		try {
			entries = await fs.readdir(currentDir, { withFileTypes: true })
		} catch {
			continue
		}

		for (const entry of entries) {
			const fullPath = path.join(currentDir, entry.name)
			const relPath = path.relative(root, fullPath)

			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) {
					queue.push(fullPath)
				}
			} else if (entry.isFile()) {
				const suffix = path.extname(entry.name).toLowerCase()
				const nameLower = entry.name.toLowerCase()

				if (testFileCount < TEST_LIMIT) {
					if (
						(nameLower.startsWith("test_") && suffix === ".py") ||
						nameLower.endsWith(".test.ts") ||
						nameLower.endsWith(".test.js")
					) {
						testFileCount++
					}
				}

				let needTodo = todoMarkers.length < TODO_LIMIT && TODO_SUFFIXES.has(suffix)
				let needSource = sourceFiles.length < SOURCE_LIMIT && SOURCE_SUFFIXES.has(suffix)

				if (!needTodo && !needSource) {
					continue
				}

				let size = 0
				try {
					const stat = await fs.stat(fullPath)
					size = stat.size
				} catch {
					continue
				}

				if (needTodo && size > TODO_MAX_BYTES) needTodo = false
				if (needSource && size > SOURCE_MAX_BYTES) needSource = false

				if (!needTodo && !needSource) {
					continue
				}

				let text = ""
				try {
					text = await fs.readFile(fullPath, "utf8")
				} catch {
					continue
				}

				if (needTodo) {
					const lines = text.split(/\r?\n/)
					for (let lineno = 1; lineno <= lines.length; lineno++) {
						const line = lines[lineno - 1]
						const todoMatch = /\b(TODO|FIXME|HACK|XXX)\b[:\s]*(.*)/i.exec(line)
						if (todoMatch) {
							todoMarkers.push({
								file: relPath,
								line: String(lineno),
								marker: todoMatch[1].toUpperCase(),
								text: todoMatch[2].trim().slice(0, 120),
							})
							if (todoMarkers.length >= TODO_LIMIT) {
								needTodo = false
								break
							}
						}
					}
				}

				if (needSource) {
					sourceFiles.push([relPath, text])
				}
			}
		}
	}

	return {
		workspace: root,
		sourceFiles,
		todoMarkers,
		testFileCount,
	}
}

const FRAMEWORK_MARKERS: [string, string][] = [
	["next.config.js", "Next.js"],
	["next.config.ts", "Next.js"],
	["nuxt.config.ts", "Nuxt"],
	["vite.config.ts", "Vite"],
	["manage.py", "Django"],
	["pyproject.toml", "Python"],
	["Cargo.toml", "Rust"],
	["go.mod", "Go"],
	["plugin.yaml", "Hermes plugin"],
	["docker-compose.yml", "Docker"],
	["Dockerfile", "Docker"],
]

const LANG_EXTENSIONS: [string, string][] = [
	[".py", "Python"],
	[".ts", "TypeScript"],
	[".tsx", "TypeScript"],
	[".js", "JavaScript"],
	[".jsx", "JavaScript"],
	[".rs", "Rust"],
	[".go", "Go"],
	[".java", "Java"],
	[".rb", "Ruby"],
]

const CI_MARKERS: [string, string][] = [
	[".github/workflows", "GitHub Actions"],
	[".gitlab-ci.yml", "GitLab CI"],
	[".circleci/config.yml", "CircleCI"],
	["Jenkinsfile", "Jenkins"],
	[".travis.yml", "Travis CI"],
	["azure-pipelines.yml", "Azure Pipelines"],
	[".buildkite/pipeline.yml", "Buildkite"],
]

const TEST_MARKERS: [string, string][] = [
	["pytest.ini", "pytest"],
	["conftest.py", "pytest"],
	["jest.config.js", "Jest"],
	["jest.config.ts", "Jest"],
	["vitest.config.ts", "Vitest"],
	["playwright.config.ts", "Playwright"],
	["cypress.config.ts", "Cypress"],
	["Cargo.toml", "cargo test"],
]

const LINT_MARKERS: [string, string][] = [
	["biome.json", "Biome"],
	["eslint.config.js", "ESLint"],
	["eslint.config.mjs", "ESLint"],
	["eslint.config.ts", "ESLint"],
	[".eslintrc.json", "ESLint"],
	[".eslintrc.cjs", "ESLint"],
	["ruff.toml", "Ruff"],
	[".prettierrc", "Prettier"],
	[".prettierrc.json", "Prettier"],
	["mise.toml", "mise"],
	[".editorconfig", "EditorConfig"],
]

const MONOREPO_MARKERS: [string, string][] = [
	["turbo.json", "Turborepo"],
	["nx.json", "Nx"],
	["lerna.json", "Lerna"],
	["pnpm-workspace.yaml", "pnpm workspace"],
]

const PACKAGE_MANAGER_MARKERS: [string, string][] = [
	["pnpm-lock.yaml", "pnpm"],
	["yarn.lock", "Yarn"],
	["bun.lockb", "Bun"],
	["package-lock.json", "npm"],
	["poetry.lock", "Poetry"],
	["uv.lock", "uv"],
	["Pipfile", "Pipenv"],
	["requirements.txt", "pip"],
]

async function runGit(cwd: string, args: string[]): Promise<string | null> {
	const timeoutMs = getRoadmapConfig().git_timeout_seconds * 1000
	try {
		const { stdout } = await execa("git", args, { cwd, timeout: timeoutMs })
		return stdout.trim()
	} catch {
		return null
	}
}

async function getGitRemoteSummary(workspace: string): Promise<string | null> {
	if (!(await isDir(path.join(workspace, ".git")))) {
		return null
	}
	const url = await runGit(workspace, ["remote", "get-url", "origin"])
	if (url) {
		if (url.startsWith("git@")) {
			const hostPart = url.split("@")[1] || ""
			const host = hostPart.split(":")[0] || ""
			const repo = hostPart.split(":")[1]?.replace(/\.git$/, "") || ""
			return `${host}/${repo}`.slice(0, 120)
		}
		return url
			.replace("https://", "")
			.replace("http://", "")
			.replace(/\.git$/, "")
			.slice(0, 120)
	}
	return null
}

async function getGitRecentChanges(workspace: string, light = false): Promise<any> {
	if (!(await isDir(path.join(workspace, ".git")))) {
		return {
			available: false,
			recent_commits: [],
			status_short: [],
			diff_stat_recent: [],
			changed_files_recent: [],
		}
	}

	const commitsRaw = await runGit(workspace, ["log", "--oneline", "-12"])
	const recent_commits = commitsRaw ? commitsRaw.split(/\r?\n/).filter(Boolean) : []

	if (light) {
		return {
			available: true,
			recent_commits,
			status_short: [],
			diff_stat_recent: [],
			changed_files_recent: [],
		}
	}

	const statusRaw = await runGit(workspace, ["status", "--short"])
	const status_short = statusRaw ? statusRaw.split(/\r?\n/).filter(Boolean) : []

	let diff_stat_raw = await runGit(workspace, ["diff", "--stat", "HEAD~5..HEAD"])
	if (diff_stat_raw === null) {
		diff_stat_raw = await runGit(workspace, ["log", "--stat", "--oneline", "-5"])
	}
	const diff_stat_recent = diff_stat_raw ? diff_stat_raw.split(/\r?\n/).filter(Boolean) : []

	let changedRaw = await runGit(workspace, ["diff", "--name-only", "HEAD~3..HEAD"])
	if (changedRaw === null) {
		changedRaw = await runGit(workspace, ["diff", "--name-only"])
	}
	const changed_files_recent = changedRaw ? changedRaw.split(/\r?\n/).filter(Boolean) : []

	return {
		available: true,
		recent_commits,
		status_short,
		diff_stat_recent,
		changed_files_recent,
	}
}

async function getPackageName(root: string): Promise<string | null> {
	const pkgPath = path.join(root, "package.json")
	if (await fileExists(pkgPath)) {
		try {
			const data = JSON.parse(await readText(pkgPath))
			if (data && data.name) return String(data.name).trim()
		} catch {}
	}

	const pyproject = path.join(root, "pyproject.toml")
	if (await fileExists(pyproject)) {
		const text = await readText(pyproject)
		const match = /^\s*name\s*=\s*["']([^"']+)["']/m.exec(text)
		if (match) return match[1].trim()
	}

	const cargo = path.join(root, "Cargo.toml")
	if (await fileExists(cargo)) {
		const text = await readText(cargo)
		const match = /^\s*name\s*=\s*["']([^"']+)["']/m.exec(text)
		if (match) return match[1].trim()
	}

	const goMod = path.join(root, "go.mod")
	if (await fileExists(goMod)) {
		const text = await readText(goMod)
		const match = /^module\s+(\S+)/m.exec(text)
		if (match) {
			return path.basename(match[1]) || match[1]
		}
	}

	return path.basename(root) || null
}

async function getPackageDescription(root: string): Promise<string | null> {
	const pkgPath = path.join(root, "package.json")
	if (await fileExists(pkgPath)) {
		try {
			const data = JSON.parse(await readText(pkgPath))
			if (data && data.description) return String(data.description).trim().slice(0, 400)
		} catch {}
	}

	const pyproject = path.join(root, "pyproject.toml")
	if (await fileExists(pyproject)) {
		const text = await readText(pyproject)
		const match = /^\s*description\s*=\s*["']([^"']+)["']/m.exec(text)
		if (match) return match[1].trim().slice(0, 400)
	}

	const cargo = path.join(root, "Cargo.toml")
	if (await fileExists(cargo)) {
		const text = await readText(cargo)
		const match = /^\s*description\s*=\s*["']([^"']+)["']/m.exec(text)
		if (match) return match[1].trim().slice(0, 400)
	}

	return null
}

async function getReadmeTitle(root: string): Promise<string | null> {
	for (const name of ["README.md", "readme.md", "docs/README.md"]) {
		const filePath = path.join(root, name)
		if (!(await fileExists(filePath))) continue
		const text = await readText(filePath, 4000)
		for (const line of text.split(/\r?\n/)) {
			const stripped = line.trim()
			if (stripped.startsWith("#")) {
				const title = stripped.replace(/^#+\s*/, "").trim()
				if (title) return title.slice(0, 200)
			}
		}
	}
	return null
}

async function getReadmeTagline(root: string): Promise<string | null> {
	for (const name of ["README.md", "readme.md", "docs/README.md"]) {
		const filePath = path.join(root, name)
		if (!(await fileExists(filePath))) continue
		const text = await readText(filePath, 6000)
		let pastTitle = false
		for (const line of text.split(/\r?\n/)) {
			const stripped = line.trim()
			if (!stripped) continue
			if (stripped.startsWith("#")) {
				pastTitle = true
				continue
			}
			if (
				stripped.startsWith("![") ||
				stripped.startsWith("[!") ||
				stripped.startsWith("<") ||
				stripped.startsWith("---") ||
				stripped.startsWith("```") ||
				stripped.startsWith("|") ||
				stripped.startsWith("- ") ||
				stripped.startsWith("* ") ||
				stripped.startsWith(">")
			) {
				continue
			}
			if (pastTitle || !stripped.startsWith("#")) {
				return stripped.slice(0, 400)
			}
		}
	}
	return null
}

async function getPackageScripts(root: string): Promise<string[]> {
	const scripts: string[] = []
	const pkgPath = path.join(root, "package.json")
	if (await fileExists(pkgPath)) {
		try {
			const data = JSON.parse(await readText(pkgPath))
			const pkgScripts = data.scripts
			if (pkgScripts && typeof pkgScripts === "object") {
				for (const name of ["dev", "start", "build", "test", "lint"]) {
					if (name in pkgScripts) scripts.push(name)
				}
				for (const name of Object.keys(pkgScripts).sort()) {
					if (!scripts.includes(name) && scripts.length < 6) {
						scripts.push(name)
					}
				}
			}
		} catch {}
	}

	const pyproject = path.join(root, "pyproject.toml")
	if (await fileExists(pyproject)) {
		const text = await readText(pyproject)
		const regex = /^\s*["']([^"']+)["']\s*=/gm
		let match
		while ((match = regex.exec(text)) !== null) {
			const name = match[1]
			if (!scripts.includes(name) && scripts.length < 8) {
				scripts.push(name)
			}
		}
	}
	return scripts.slice(0, 8)
}

async function getLicenseLabel(root: string): Promise<string | null> {
	const pkgPath = path.join(root, "package.json")
	if (await fileExists(pkgPath)) {
		try {
			const data = JSON.parse(await readText(pkgPath))
			if (data && data.license) return String(data.license).slice(0, 80)
		} catch {}
	}
	for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt"]) {
		if (await fileExists(path.join(root, name))) {
			return name
		}
	}
	const pyproject = path.join(root, "pyproject.toml")
	if (await fileExists(pyproject)) {
		const text = await readText(pyproject)
		const match = /^\s*license\s*=\s*["'{]([^"'}]+)/m.exec(text)
		if (match) return match[1].trim().slice(0, 80)
	}
	return null
}

async function getDocsRoots(root: string): Promise<string[]> {
	const found: string[] = []
	for (const rel of ["docs", "doc", "documentation", "wiki"]) {
		if (await isDir(path.join(root, rel))) {
			found.push(rel)
		}
	}
	for (const name of ["CONTRIBUTING.md", "docs/architecture.md", "ARCHITECTURE.md"]) {
		if (await fileExists(path.join(root, name))) {
			found.push(name)
		}
	}
	return found.slice(0, 6)
}

async function detectMarkersAsync(root: string, markers: [string, string][], dirOk = false): Promise<string[]> {
	const found: string[] = []
	for (const [rel, label] of markers) {
		const fullPath = path.join(root, rel)
		if (dirOk && (await isDir(fullPath))) {
			if (!found.includes(label)) found.push(label)
		} else if (await fileExists(fullPath)) {
			if (!found.includes(label)) found.push(label)
		}
	}
	return found.slice(0, 6)
}

async function getRuntimeVersions(root: string): Promise<Record<string, string>> {
	const versions: Record<string, string> = {}
	const candidates: [string, string][] = [
		[".nvmrc", "node"],
		[".node-version", "node"],
		[".python-version", "python"],
		[".tool-versions", "asdf"],
	]
	for (const [rel, label] of candidates) {
		const fullPath = path.join(root, rel)
		if (await fileExists(fullPath)) {
			const text = (await readText(fullPath, 64)).trim()
			const lines = text
				.split(/\r?\n/)
				.map((l) => l.trim())
				.filter(Boolean)
			if (lines.length > 0) {
				versions[label] = lines[0].slice(0, 32)
			}
		}
	}
	return versions
}

async function getComposeServices(root: string): Promise<string[]> {
	for (const name of ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]) {
		const fullPath = path.join(root, name)
		if (!(await fileExists(fullPath))) continue
		const text = await readText(fullPath, 4000)
		const services: string[] = []
		let inServices = false
		for (const line of text.split(/\r?\n/)) {
			if (/^\s*services:\s*$/.test(line)) {
				inServices = true
				continue
			}
			if (!inServices) continue
			const match = /^\s{2}([\w-]+):\s*$/.exec(line)
			if (match) {
				services.push(match[1])
			} else if (line.trim() && !line.startsWith(" ")) {
				break
			}
		}
		return services.slice(0, 6)
	}
	return []
}

async function getCIWorkflowNames(root: string): Promise<string[]> {
	const wfDir = path.join(root, ".github", "workflows")
	if (!(await isDir(wfDir))) return []
	try {
		const entries = await fs.readdir(wfDir, { withFileTypes: true })
		const names: string[] = []
		for (const entry of entries) {
			if (entry.isFile() && (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml"))) {
				const stem = path.parse(entry.name).name
				if (!names.includes(stem)) {
					names.push(stem)
					if (names.length >= 6) break
				}
			}
		}
		return names
	} catch {
		return []
	}
}

async function getWorkspacePackages(root: string): Promise<string[]> {
	const packages: string[] = []
	const pnpmWs = path.join(root, "pnpm-workspace.yaml")
	if (await fileExists(pnpmWs)) {
		const text = await readText(pnpmWs, 2000)
		for (const line of text.split(/\r?\n/)) {
			const match = /^\s*-\s*['"]?([^'"]+)['"]?/.exec(line)
			if (match) {
				const name = match[1].trim()
				if (name && !packages.includes(name)) {
					packages.push(name.slice(0, 60))
				}
			}
		}
	}
	const pkgPath = path.join(root, "package.json")
	if (await fileExists(pkgPath)) {
		try {
			const data = JSON.parse(await readText(pkgPath))
			const workspaces = data.workspaces
			if (Array.isArray(workspaces)) {
				for (const item of workspaces) {
					if (packages.length >= 8) break
					const name = String(item).trim()
					if (name && !packages.includes(name)) {
						packages.push(name.slice(0, 60))
					}
				}
			} else if (workspaces && typeof workspaces === "object") {
				const pkgs = workspaces.packages
				if (Array.isArray(pkgs)) {
					for (const item of pkgs) {
						if (packages.length >= 8) break
						const name = String(item).trim()
						if (name && !packages.includes(name)) {
							packages.push(name.slice(0, 60))
						}
					}
				}
			}
		} catch {}
	}
	return packages.slice(0, 8)
}

async function getIssueTemplates(root: string): Promise<string[]> {
	const found: string[] = []
	const tplDir = path.join(root, ".github", "ISSUE_TEMPLATE")
	if (await isDir(tplDir)) {
		try {
			const entries = await fs.readdir(tplDir)
			for (const name of entries.sort()) {
				if (name.endsWith(".md") && found.length < 4) {
					found.push(`.github/ISSUE_TEMPLATE/${name}`)
				} else if (name.endsWith(".yaml") && found.length < 6) {
					found.push(`.github/ISSUE_TEMPLATE/${name}`)
				}
			}
		} catch {}
	}
	for (const rel of [".github/pull_request_template.md", ".github/PULL_REQUEST_TEMPLATE.md", "pull_request_template.md"]) {
		if ((await fileExists(path.join(root, rel))) && !found.includes(rel)) {
			found.push(rel)
		}
	}
	return found.slice(0, 6)
}

async function getMakefileTargets(root: string): Promise<string[]> {
	const makefile = path.join(root, "Makefile")
	if (!(await fileExists(makefile))) return []
	const text = await readText(makefile, 4000)
	const targets: string[] = []
	for (const line of text.split(/\r?\n/)) {
		const stripped = line.trim()
		if (stripped.startsWith(".PHONY:")) {
			const parts = stripped.split(":")[1] || ""
			for (const token of parts.split(/\s+/)) {
				const name = token.trim()
				if (name && !targets.includes(name)) {
					targets.push(name)
				}
			}
		}
	}
	for (const name of ["help", "test", "lint", "build", "deploy", "verify"]) {
		if (!targets.includes(name)) {
			const regex = new RegExp(`^${name}\\s*:`, "m")
			if (regex.test(text)) {
				targets.push(name)
			}
		}
	}
	return targets.slice(0, 8)
}

export async function buildProjectFingerprint(workspace: string): Promise<any> {
	const package_name = await getPackageName(workspace)
	const readme_title = await getReadmeTitle(workspace)
	const tagline = await getReadmeTagline(workspace)
	const description = await getPackageDescription(workspace)
	const frameworks = await detectMarkersAsync(workspace, FRAMEWORK_MARKERS)
	if ((await fileExists(path.join(workspace, "app", "layout.tsx"))) && !frameworks.includes("Next.js")) {
		frameworks.push("Next.js App Router")
	}
	const skipDirs = new Set([".git", "node_modules", ".venv", "venv", "dist", "build", "__pycache__"])
	const counts: Record<string, number> = {}
	let scanned = 0

	const walkAndCount = async (dir: string) => {
		if (scanned >= 400) return
		let entries: any[] = []
		try {
			entries = await fs.readdir(dir, { withFileTypes: true })
		} catch {
			return
		}
		for (const entry of entries) {
			if (scanned >= 400) return
			const fullPath = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				if (!skipDirs.has(entry.name)) {
					await walkAndCount(fullPath)
				}
			} else if (entry.isFile()) {
				const ext = path.extname(entry.name).toLowerCase()
				for (const [extCandidate, lang] of LANG_EXTENSIONS) {
					if (ext === extCandidate) {
						counts[lang] = (counts[lang] || 0) + 1
						scanned++
						break
					}
				}
			}
		}
	}
	await walkAndCount(workspace)
	let primary_language: string | null = null
	let maxVal = -1
	for (const [lang, count] of Object.entries(counts)) {
		if (count > maxVal) {
			maxVal = count
			primary_language = lang
		}
	}

	const ci_systems = await detectMarkersAsync(workspace, CI_MARKERS, true)
	const test_frameworks = await detectMarkersAsync(workspace, TEST_MARKERS)
	const quality_tools = await detectMarkersAsync(workspace, LINT_MARKERS)
	const monorepo_tools = await detectMarkersAsync(workspace, MONOREPO_MARKERS)
	const package_managers = await detectMarkersAsync(workspace, PACKAGE_MANAGER_MARKERS)

	const has_docker =
		(await fileExists(path.join(workspace, "Dockerfile"))) || (await fileExists(path.join(workspace, "docker-compose.yml")))
	const has_tests =
		test_frameworks.length > 0 || (await isDir(path.join(workspace, "tests"))) || (await isDir(path.join(workspace, "test")))

	let project_archetype = "project"
	if (await fileExists(path.join(workspace, "plugin.yaml"))) {
		project_archetype = "hermes-plugin"
	} else if (monorepo_tools.length > 0) {
		project_archetype = "monorepo"
	} else if (
		frameworks.includes("Next.js") ||
		frameworks.includes("Next.js App Router") ||
		frameworks.includes("Nuxt") ||
		frameworks.includes("Vite")
	) {
		if (
			(await isDir(path.join(workspace, "app"))) ||
			(await isDir(path.join(workspace, "pages"))) ||
			(await isDir(path.join(workspace, "src", "routes")))
		) {
			project_archetype = "web-app"
		}
	}
	if (project_archetype === "project") {
		let hasBin = false
		const pkgPath = path.join(workspace, "package.json")
		if (await fileExists(pkgPath)) {
			try {
				const data = JSON.parse(await readText(pkgPath))
				if (data.bin) hasBin = true
			} catch {}
		}
		if (hasBin || (await isDir(path.join(workspace, "cmd")))) {
			project_archetype = "cli-tool"
		} else {
			let hasPrivate = false
			if (await fileExists(pkgPath)) {
				try {
					const data = JSON.parse(await readText(pkgPath))
					if (data.private === true) hasPrivate = true
				} catch {}
			}
			if (hasPrivate && (await isDir(path.join(workspace, "src")))) {
				project_archetype = "application"
			} else {
				const pyproject = path.join(workspace, "pyproject.toml")
				let hasProjectScripts = false
				if (await fileExists(pyproject)) {
					const text = await readText(pyproject)
					if (/\[project\.scripts\]/.test(text)) {
						hasProjectScripts = true
					}
				}
				if (hasProjectScripts) {
					project_archetype = "cli-tool"
				} else {
					let hasMain = false
					if (await fileExists(pkgPath)) {
						try {
							const data = JSON.parse(await readText(pkgPath))
							if (data.main) hasMain = true
						} catch {}
					}
					if (hasMain || (await fileExists(path.join(workspace, "src", "index.ts")))) {
						project_archetype = "library"
					}
				}
			}
		}
	}

	const entry_points = await getPackageScripts(workspace)
	const license = await getLicenseLabel(workspace)
	const git_remote = await getGitRemoteSummary(workspace)
	const docs_roots = await getDocsRoots(workspace)

	const agent_rules_files: string[] = []
	for (const rel of ["AGENTS.md", "CLAUDE.md", "DIRECTIONS.md", ".cursorrules", "docs/AGENTS.md", "catalog-info.yaml"]) {
		if (await fileExists(path.join(workspace, rel))) {
			agent_rules_files.push(rel)
		}
	}
	const rulesDir = path.join(workspace, ".cursor", "rules")
	if (await isDir(rulesDir)) {
		try {
			const entries = await fs.readdir(rulesDir)
			for (const name of entries.sort()) {
				if (name.endsWith(".md") || name.endsWith(".mdc")) {
					agent_rules_files.push(`.cursor/rules/${name}`)
					if (agent_rules_files.length >= 8) break
				}
			}
		} catch {}
	}

	const makefile_targets = await getMakefileTargets(workspace)

	const verification_commands: string[] = []
	for (const target of ["verify", "test", "lint", "check", "ci"]) {
		if (makefile_targets.includes(target)) {
			verification_commands.push(`make ${target}`)
			break
		}
	}
	const pkgPath = path.join(workspace, "package.json")
	if (await fileExists(pkgPath)) {
		try {
			const data = JSON.parse(await readText(pkgPath))
			const scripts = data.scripts || {}
			for (const name of ["verify", "test", "lint", "ci", "check"]) {
				if (name in scripts) {
					verification_commands.push(`npm run ${name}`)
					break
				}
			}
		} catch {}
	}
	if (verification_commands.length === 0) {
		if (test_frameworks.includes("pytest")) {
			verification_commands.push("pytest")
		} else if (test_frameworks.includes("Jest") || test_frameworks.includes("Vitest")) {
			verification_commands.push("npm test")
		} else if (await fileExists(path.join(workspace, "go.mod"))) {
			verification_commands.push("go test ./...")
		} else if (await fileExists(path.join(workspace, "Cargo.toml"))) {
			verification_commands.push("cargo test")
		} else if (entry_points.length > 0) {
			const first = entry_points[0]
			if (["test", "verify", "lint", "check"].includes(first)) {
				verification_commands.push(`npm run ${first}`)
			}
		}
	}

	const runtime_versions = await getRuntimeVersions(workspace)

	const dependency_automation: string[] = []
	if (
		(await fileExists(path.join(workspace, "renovate.json"))) ||
		(await fileExists(path.join(workspace, ".github", "renovate.json")))
	) {
		dependency_automation.push("Renovate")
	}
	if (
		(await fileExists(path.join(workspace, ".github", "dependabot.yml"))) ||
		(await fileExists(path.join(workspace, ".github", "dependabot.yaml")))
	) {
		dependency_automation.push("Dependabot")
	}

	const has_codeowners =
		(await fileExists(path.join(workspace, ".github", "CODEOWNERS"))) ||
		(await fileExists(path.join(workspace, "CODEOWNERS")))
	const compose_services = await getComposeServices(workspace)
	const governance_files: string[] = []
	for (const rel of ["SECURITY.md", "CODE_OF_CONDUCT.md", ".editorconfig", "CHANGELOG.md"]) {
		if (await fileExists(path.join(workspace, rel))) {
			governance_files.push(rel)
		}
	}
	if (await isDir(path.join(workspace, "docs", "adr"))) {
		governance_files.push("docs/adr")
	}

	const workspace_packages = await getWorkspacePackages(workspace)
	const ci_workflow_names = await getCIWorkflowNames(workspace)
	const issue_templates = await getIssueTemplates(workspace)
	const has_pre_commit = await fileExists(path.join(workspace, ".pre-commit-config.yaml"))

	const display_name = readme_title || package_name || path.basename(workspace)
	const stack_parts: string[] = []
	if (primary_language) stack_parts.push(primary_language)
	for (const f of frameworks) {
		if (!stack_parts.includes(f)) stack_parts.push(f)
	}
	if (package_managers.length > 0 && !stack_parts.includes(package_managers[0])) {
		stack_parts.push(package_managers[0])
	}

	const summary = stack_parts.length > 0 ? `${display_name} (${stack_parts.slice(0, 4).join(", ")})` : display_name

	let steering_brief = display_name
	const parts: string[] = [display_name]
	if (tagline && !display_name.toLowerCase().includes(tagline.toLowerCase())) {
		parts.push(tagline.slice(0, 120))
	} else if (description && !display_name.toLowerCase().includes(description.toLowerCase())) {
		parts.push(description.slice(0, 120))
	} else if (stack_parts.length > 0) {
		parts.push(stack_parts.slice(0, 3).join(", "))
	}
	const meta: string[] = []
	if (project_archetype && project_archetype !== "project") {
		meta.push(project_archetype.replace("-", " "))
	}
	if (test_frameworks.length > 0) {
		meta.push(test_frameworks[0])
	}
	if (ci_systems.length > 0) {
		meta.push(ci_systems[0])
	}
	if (meta.length > 0) {
		parts.push(meta.join(" · "))
	}
	steering_brief = parts.join(" — ")

	const purpose_hint = tagline || description || ""

	let runtime_center_hint = ""
	if (project_archetype === "hermes-plugin") {
		runtime_center_hint = `Hermes plugin workspace — ROADMAP.md at ${path.basename(workspace)} root beside plugin.yaml`
	} else if (project_archetype === "web-app") {
		runtime_center_hint = `Web application root at ${path.basename(workspace)} — deploy/runtime config in repo manifests`
	} else if (has_docker) {
		if (compose_services.length > 0) {
			runtime_center_hint = `Containerized runtime — services: ${compose_services.slice(0, 4).join(", ")}`
		} else {
			runtime_center_hint = "Containerized runtime — Docker/Docker Compose manifests define operational center"
		}
	} else if (frameworks.length > 0) {
		runtime_center_hint = `Primary stack: ${frameworks.slice(0, 3).join(", ")} — operational truth in repo config and entrypoints`
	}

	let operators_hint = description || ""
	if (!operators_hint) {
		if (agent_rules_files.length > 0) {
			const ruleText = await readText(path.join(workspace, agent_rules_files[0]), 2500)
			const lines = ruleText
				.split(/\r?\n/)
				.map((l) => l.trim())
				.filter((l) => l && !l.startsWith("#"))
			for (const l of lines) {
				if (l.length >= 20) {
					operators_hint = l.slice(0, 200)
					break
				}
			}
			if (!operators_hint && lines.length > 0) {
				operators_hint = lines[0].slice(0, 200)
			}
		}
	}
	if (!operators_hint) {
		const contribPath = path.join(workspace, "CONTRIBUTING.md")
		if (await fileExists(contribPath)) {
			const contribText = await readText(contribPath, 2000)
			for (const line of contribText.split(/\r?\n/)) {
				const stripped = line.trim()
				if (stripped && !stripped.startsWith("#") && stripped.length >= 20) {
					operators_hint = stripped.slice(0, 200)
					break
				}
			}
		}
	}
	if (!operators_hint && project_archetype === "hermes-plugin") {
		operators_hint = "Hermes operators and agent-assisted developers extending the plugin surface"
	}

	const catalogPath = path.join(workspace, "catalog-info.yaml")
	const has_backstage_catalog = await fileExists(catalogPath)
	let catalog_name: string | null = null
	let catalog_description: string | null = null
	if (has_backstage_catalog) {
		try {
			const content = await fs.readFile(catalogPath, "utf8")
			const lines = content.split(/\r?\n/)
			let inMetadata = false
			for (const line of lines) {
				const trimmed = line.trim()
				if (/^metadata\s*:/i.test(trimmed)) {
					inMetadata = true
					continue
				}
				if (inMetadata) {
					if (line.length > 0 && !/^\s/.test(line)) {
						inMetadata = false
						continue
					}
					const nameMatch = /^\s*name\s*:\s*['"]?([^'"]+)['"]?/i.exec(line)
					if (nameMatch && !catalog_name) {
						catalog_name = nameMatch[1].trim()
					}
					const descMatch = /^\s*description\s*:\s*['"]?([^'"]+)['"]?/i.exec(line)
					if (descMatch && !catalog_description) {
						catalog_description = descMatch[1].trim()
					}
				}
			}
		} catch {}
	}

	return {
		project_name: display_name,
		package_name,
		readme_title,
		readme_tagline: tagline,
		package_description: description,
		primary_language,
		frameworks,
		stack_summary: stack_parts.join(", ") || null,
		steering_identity: summary,
		steering_brief,
		project_archetype,
		ci_systems,
		test_frameworks,
		quality_tools: quality_tools.length > 0 ? quality_tools : null,
		monorepo_tools,
		package_managers,
		has_ci: ci_systems.length > 0,
		has_tests,
		has_docker,
		purpose_hint: purpose_hint || null,
		runtime_center_hint: runtime_center_hint || null,
		operators_hint: operators_hint || null,
		entry_points,
		license,
		git_remote,
		docs_roots,
		agent_rules_files,
		makefile_targets,
		verification_commands,
		runtime_versions: Object.keys(runtime_versions).length > 0 ? runtime_versions : null,
		dependency_automation: dependency_automation.length > 0 ? dependency_automation : null,
		has_codeowners,
		compose_services: compose_services.length > 0 ? compose_services : null,
		governance_files: governance_files.length > 0 ? governance_files : null,
		workspace_packages: workspace_packages.length > 0 ? workspace_packages : null,
		ci_workflow_names: ci_workflow_names.length > 0 ? ci_workflow_names : null,
		issue_templates: issue_templates.length > 0 ? issue_templates : null,
		has_pre_commit,
		has_backstage_catalog,
		catalog_name,
		catalog_description,
	}
}

function stripComments(text: string): string {
	let clean = text.replace(/#.*$/gm, "")
	clean = clean.replace(/\/\/.*$/gm, "")
	clean = clean.replace(/\/\*[\s\S]*?\*\//g, "")
	return clean
}

function isTestPath(relPath: string): boolean {
	const lower = relPath.toLowerCase()
	return (
		lower.includes("/tests/") ||
		lower.includes("/__tests__/") ||
		lower.includes("/test/") ||
		lower.endsWith(".test.ts") ||
		lower.endsWith(".test.js") ||
		lower.endsWith(".spec.ts") ||
		lower.endsWith(".spec.js")
	)
}

async function assessCodeSoup(workspace: string, heavy: HeavyScanResult): Promise<any> {
	const files = heavy.sourceFiles
	const counts: Record<string, number> = {}
	const pathsByName: Record<string, string[]> = {}
	for (const [rel, _] of files) {
		const name = path.basename(rel)
		counts[name] = (counts[name] || 0) + 1
		if (!pathsByName[name]) pathsByName[name] = []
		pathsByName[name].push(rel)
	}
	const duplicate_basenames: any[] = []
	for (const [name, count] of Object.entries(counts)) {
		if (count >= 2) {
			if (["__init__.py", "index.ts", "types.ts", "config.py", "config.ts"].includes(name)) {
				continue
			}
			duplicate_basenames.push({
				basename: name,
				count,
				paths: pathsByName[name].slice(0, 6),
			})
		}
	}
	duplicate_basenames.sort((a, b) => b.count - a.count)

	const entry_surfaces: any[] = []
	for (const [rel, text] of files.slice(0, 250)) {
		if (isTestPath(rel)) continue
		const cleanText = stripComments(text)
		for (const pattern of ENTRY_PATTERNS) {
			if (pattern.test(cleanText)) {
				entry_surfaces.push({ path: rel, signal: pattern.source.slice(0, 40) })
				break
			}
		}
		if (entry_surfaces.length >= 20) break
	}

	const hook_surfaces: string[] = []
	for (const [rel, text] of files.slice(0, 200)) {
		if (isTestPath(rel)) continue
		const cleanText = stripComments(text)
		if (HOOK_MARKERS.some((m) => cleanText.includes(m))) {
			hook_surfaces.push(rel)
			if (hook_surfaces.length >= 12) break
		}
	}

	const config_sources: string[] = []
	for (const name of CONFIG_NAMES) {
		if (await fileExists(path.join(workspace, name))) {
			config_sources.push(name)
		}
	}

	const commands: string[] = []
	for (const [rel, text] of files.slice(0, 150)) {
		if (isTestPath(rel)) continue
		const cleanText = stripComments(text)
		const reg1 = /register_command\s*\(\s*["']([^"']+)["']/g
		let m
		while ((m = reg1.exec(cleanText)) !== null) {
			commands.push(m[1])
		}
		const reg2 = /ctx\.register_command\s*\(\s*["']([^"']+)["']/g
		while ((m = reg2.exec(cleanText)) !== null) {
			commands.push(m[1])
		}
	}
	const cmdCounts: Record<string, number> = {}
	for (const cmd of commands) {
		cmdCounts[cmd] = (cmdCounts[cmd] || 0) + 1
	}
	const parallel_commands: string[] = []
	for (const [cmd, count] of Object.entries(cmdCounts)) {
		if (count > 1) {
			parallel_commands.push(cmd)
		}
	}

	const signals: { code: string; detail: string }[] = []
	if (entry_surfaces.length > 12) {
		signals.push({
			code: "many_entry_surfaces",
			detail: `${entry_surfaces.length} files expose CLI/tool entry points`,
		})
	}
	if (hook_surfaces.length > 3) {
		signals.push({
			code: "multiple_hook_registrars",
			detail: `Hook registration spread across ${hook_surfaces.length} files`,
		})
	}
	if (config_sources.length > 3) {
		signals.push({
			code: "multiple_config_sources",
			detail: `Config files present: ${config_sources.join(", ")}`,
		})
	}
	if (duplicate_basenames.length > 0) {
		signals.push({
			code: "duplicate_basenames",
			detail: `${duplicate_basenames.length} duplicate source basenames`,
		})
	}
	if (parallel_commands.length > 0) {
		signals.push({
			code: "duplicate_command_registration",
			detail: `Commands registered more than once: ${parallel_commands.slice(0, 5).join(", ")}`,
		})
	}

	let risk: "Low" | "Medium" | "High" = "Low"
	if (signals.length >= 3) {
		risk = "High"
	} else if (signals.length > 0) {
		risk = "Medium"
	}

	let recommendation = "Document the canonical mutation, inspection, and command surfaces in section 1."
	if (duplicate_basenames.length > 0) {
		recommendation = `Converge duplicate modules (${duplicate_basenames[0].basename}) or document which path is canonical.`
	} else if (hook_surfaces.length > 3) {
		recommendation = "Centralize hook registration behind one composed registrar."
	} else if (entry_surfaces.length > 12) {
		recommendation = "Collapse operator entry points into one command surface where possible."
	}

	return {
		overall_risk: risk,
		signals,
		duplicate_basenames: duplicate_basenames.slice(0, 8),
		entry_surface_count: entry_surfaces.length,
		entry_surfaces_sample: entry_surfaces.slice(0, 8),
		hook_registrar_files: hook_surfaces,
		config_sources,
		parallel_command_names: parallel_commands,
		centralization_recommendation: recommendation,
	}
}

// Helpers for parsing date, counting items
function countSectionItems(content: string, sectionTitle: string): number {
	const escaped = sectionTitle.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")
	const regex = new RegExp(`^##\\s+${escaped}\\s*$[\\r\\n]([\\s\\S]*?)(?=^##\\s+|\\Z)`, "mi")
	const match = regex.exec(content)
	if (!match) return 0
	const body = match[1]
	const subMatches = body.match(/^###\s+\d+\.\s+/gm)
	return subMatches ? subMatches.length : 0
}

function parseRoadmapText(content: string, pathStr: string): any {
	const exists = content.trim().length > 0
	if (!exists) {
		return {
			exists: false,
			path: pathStr || null,
			size_bytes: 0,
			sections_present: [],
			sections_missing: [...REQUIRED_SECTIONS],
			health_status: null,
			code_soup_risk: null,
			recent_checkpoint_date: null,
			center_of_gravity_excerpt: null,
			now_item_count: 0,
			next_item_count: 0,
			discovery_item_count: 0,
		}
	}

	const sections_present: string[] = []
	const sections_missing: string[] = []
	for (const sec of REQUIRED_SECTIONS) {
		const escaped = sec.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")
		const regex = new RegExp(`^##\\s+${escaped}\\s*$`, "m")
		if (regex.test(content)) {
			sections_present.push(sec)
		} else {
			sections_missing.push(sec)
		}
	}

	let health_status: string | null = null
	const healthMatch = /##\s+2\.\s+Roadmap Health[\s\S]*?\*\*Status:\*\*\s*([A-Za-z]+)/i.exec(content)
	if (healthMatch) {
		const candidate = healthMatch[1].trim()
		for (const status of HEALTH_STATUSES) {
			if (status.toLowerCase() === candidate.toLowerCase()) {
				health_status = status
				break
			}
		}
	}

	let code_soup_risk: string | null = null
	const soupMatch = /\*\*Overall Code Soup Risk:\*\*\s*(Low|Medium|High)/i.exec(content)
	if (soupMatch) {
		const candidate = soupMatch[1].trim().charAt(0).toUpperCase() + soupMatch[1].trim().slice(1).toLowerCase()
		if (SOUP_RISK_LEVELS.has(candidate)) {
			code_soup_risk = candidate
		}
	}

	let recent_checkpoint_date: string | null = null
	const checkpointMatch = /##\s+11\.\s+Recent Checkpoint[\s\S]*?\*\*Date:\*\*\s*(\d{4}-\d{2}-\d{2})/i.exec(content)
	if (checkpointMatch) {
		recent_checkpoint_date = checkpointMatch[1]
	}

	let center_of_gravity_excerpt = ""
	const cogMatch = /##\s+1\.\s+Project Center of Gravity([\s\S]*?)(?=\n##\s+|Z)/i.exec(content)
	if (cogMatch) {
		center_of_gravity_excerpt = cogMatch[1].trim().slice(0, 800)
	}

	return {
		exists: true,
		path: pathStr,
		size_bytes: Buffer.byteLength(content, "utf8"),
		sections_present,
		sections_missing,
		health_status,
		code_soup_risk,
		recent_checkpoint_date,
		center_of_gravity_excerpt: center_of_gravity_excerpt || null,
		now_item_count: countSectionItems(content, "4. Now"),
		next_item_count: countSectionItems(content, "5. Next"),
		discovery_item_count: countSectionItems(content, "7. Discovery"),
	}
}

export class RoadmapService {
	private static instance: RoadmapService | null = null
	private lastValidationResult: Record<string, { timestamp: number; hash: string; result: any }> = {}

	public static getInstance(): RoadmapService {
		if (!RoadmapService.instance) {
			RoadmapService.instance = new RoadmapService()
		}
		return RoadmapService.instance
	}

	public isEnabled(): boolean {
		return getRoadmapConfig().enabled
	}

	public getConfig(): RoadmapConfig {
		return getRoadmapConfig()
	}

	public wrapClarityEnvelope(payload: Record<string, unknown>, phaseInfo?: Record<string, unknown>): Record<string, unknown> {
		return operatorWrapClarityEnvelope({ ...payload, enabled: this.isEnabled() }, phaseInfo)
	}

	public async runDoctor(workspace: string): Promise<Record<string, unknown>> {
		return runDoctorChecks(this, workspace)
	}

	public async buildCockpit(workspace: string): Promise<Record<string, unknown>> {
		return buildCockpitPayload(this, workspace)
	}

	public async getProgressSnapshot(workspace: string, context = ""): Promise<Record<string, unknown>> {
		const ctx = (context || "").trim().toLowerCase()
		if (ctx === "--tail") {
			const { readProgressTail } = await import("./RoadmapProgress")
			return this.wrapClarityEnvelope({
				action: "progress",
				success: true,
				ok: true,
				workspace,
				events: await readProgressTail(20),
			})
		}

		const { buildProgressSnapshot, formatProgressReport } = await import("./RoadmapProgress")
		const snapshot = await buildProgressSnapshot(workspace)
		const report = await formatProgressReport({
			workspace,
			timeline: ctx.includes("--timeline"),
			currentSnapshot: ctx === "--current",
			last: 5,
			snapshot,
		})

		return this.wrapClarityEnvelope({
			action: "progress",
			success: true,
			ok: true,
			workspace,
			...snapshot,
			report,
			context_mode: ctx || "default",
		})
	}

	public async getWatchReport(workspace: string): Promise<Record<string, unknown>> {
		const current = await readCurrentProgress()
		const lastError = await readLastError()
		const status = await this.getOperationalStatus(workspace, "", "light")
		return this.wrapClarityEnvelope({
			action: "watch",
			success: true,
			ok: true,
			workspace,
			report: formatWatchReport(current, lastError, status),
			current,
			last_error: lastError,
			project_identity_line: status.project_identity_line,
			phase: status.phase,
			agent_next_call: status.agent_next_call,
			auto_clearable_governance_only: status.auto_clearable_governance_only,
			validation_pending: status.validation_pending,
			kanban_complete_allowed: status.kanban_complete_allowed,
		})
	}

	public async getLastErrorBrief(workspace: string): Promise<Record<string, unknown>> {
		const lastError = await readLastError()
		if (!lastError) {
			return this.wrapClarityEnvelope({
				action: "last_error",
				success: true,
				ok: true,
				workspace,
				last_error: null,
				operator_summary: "No recorded roadmap errors.",
				agent_next_call: "roadmap(action='guide')",
			})
		}
		return this.wrapClarityEnvelope({
			action: "last_error",
			success: false,
			ok: false,
			workspace,
			last_error: lastError,
			operator_summary: String(lastError.message || lastError.error),
			agent_next_call: String(lastError.retry_command || "roadmap(action='guide')"),
		})
	}

	public async explainGate(workspace: string): Promise<Record<string, unknown>> {
		const status = await this.getOperationalStatus(workspace, "", "standard")
		const gate = (status.roadmap_gate || {}) as Record<string, unknown>
		const report = formatExplainGateReport(gateExplainParamsFromStatus(workspace, gate, status))
		return this.wrapClarityEnvelope({
			action: "explain_gate",
			success: true,
			ok: true,
			workspace,
			roadmap_gate: gate,
			closed_gates: gate.closed_gates || [],
			open_gates: gate.open_gates || [],
			blocking_gates: gate.blocking_gates || [],
			kanban_complete_allowed: gate.kanban_complete_allowed,
			preferred_command: gate.preferred_command,
			report,
			operator_summary: report.split("\n")[0] || "Roadmap gate explanation",
			recommended_next_action: status.recommended_next_action,
			project_steering_digest: status.project_steering_digest,
			project_identity_line: status.project_identity_line,
			steering_brief: status.steering_brief,
			agent_next_call: status.agent_next_call,
			phase: status.phase,
		})
	}

	public async explainStale(workspace: string): Promise<Record<string, unknown>> {
		const status = await this.getOperationalStatus(workspace, "", "standard")
		const gate = (status.roadmap_gate || {}) as Record<string, unknown>
		const freshness = (status.checkpoint_freshness || {
			stale: gate.checkpoint_stale,
			reason: gate.stale_reason,
			summary: gate.stale_summary,
			recommended_action: gate.checkpoint_stale
				? "Update Recent Checkpoint (section 11) in ROADMAP.md"
				: "roadmap(action='guide')",
		}) as Record<string, unknown>

		const report = formatExplainStaleReport(freshness, String(status.steering_brief || status.project_identity_line || ""))

		return this.wrapClarityEnvelope({
			action: "explain_stale",
			success: true,
			ok: true,
			workspace,
			checkpoint_freshness: freshness,
			checkpoint_stale: freshness.stale ?? gate.checkpoint_stale,
			report,
			operator_summary: String(freshness.summary || report.split("\n")[0]),
			agent_next_call: String(freshness.recommended_action || "Update Recent Checkpoint (section 11) in ROADMAP.md"),
			project_steering_digest: status.project_steering_digest,
			project_identity_line: status.project_identity_line,
			steering_brief: status.steering_brief,
			phase: status.phase,
			roadmap_gate: gate,
		})
	}

	public async autoBootstrapIfNeeded(workspace: string): Promise<Record<string, unknown> | null> {
		const cfg = getRoadmapConfig()
		if (!cfg.enabled || !cfg.auto_bootstrap) {
			return null
		}

		const roadmapPath = path.join(workspace, "ROADMAP.md")
		if (await fileExists(roadmapPath)) {
			if (cfg.auto_bootstrap_fill) {
				const status = await this.getOperationalStatus(workspace, "", "light")
				if (status.bootstrap_complete === false) {
					return this.applyBootstrapFillBrief(workspace, "write")
				}
			}
			return null
		}

		const evidence = await this.gatherEvidence(workspace, null, "full")
		const skeleton = bootstrapSkeletonFromEvidenceAutofilled(evidence)
		await writeRoadmapAtomically(workspace, skeleton)
		await this.recordFileMutation(workspace, "roadmap", "ROADMAP.md")

		let result: Record<string, unknown> = {
			action: "auto_bootstrap",
			success: true,
			ok: true,
			workspace,
			roadmap_path: roadmapPath,
			written: true,
			operator_summary: "Created ROADMAP.md from workspace evidence.",
			agent_next_call: AUTO_GOVERNANCE.continueTaskMidPass,
		}

		if (cfg.auto_bootstrap_fill) {
			const filled = await this.applyBootstrapFillBrief(workspace, "write")
			result = { ...result, bootstrap_autofill_applied: filled }
			if ((filled as Record<string, unknown>).written) {
				result.operator_summary = filled.operator_summary
				result.agent_next_call = AUTO_GOVERNANCE.continueTaskMidPass
			}
		}

		return this.wrapClarityEnvelope(result)
	}

	// State Operations
	public getStatePath(workspace: string): string {
		return path.join(workspace, ".dietcode", "roadmap-state.json")
	}

	public async recordMutationLineage(workspace: string, entry: any): Promise<void> {
		await recordMutationLineage(workspace, entry)
	}

	public async getOrHydrateRuntimeState(workspace: string, text?: string): Promise<RoadmapRuntimeState> {
		const state = await this.readState(workspace)
		const roadmapPath = path.join(workspace, "ROADMAP.md")

		let mdText = text
		if (mdText === undefined) {
			mdText = (await fileExists(roadmapPath)) ? await fs.readFile(roadmapPath, "utf8") : ""
		}

		const currentHash = crypto.createHash("sha256").update(mdText).digest("hex").slice(0, 16)

		if (state.runtime_state && state.roadmap_md_hash === currentHash) {
			return state.runtime_state as RoadmapRuntimeState
		}

		const runtimeState = hydrateRuntimeState(mdText)

		if (state.runtime_state) {
			if (state.runtime_state.memory) runtimeState.memory = state.runtime_state.memory
			if (state.runtime_state.active_window) runtimeState.active_window = state.runtime_state.active_window
			if (state.runtime_state.locks) runtimeState.locks = state.runtime_state.locks
			if (state.runtime_state.scheduler_state) runtimeState.scheduler_state = state.runtime_state.scheduler_state
			if (state.runtime_state.version_vectors) runtimeState.version_vectors = state.runtime_state.version_vectors
		}

		await this.writeState(workspace, {
			runtime_state: runtimeState,
			roadmap_md_hash: currentHash,
		})

		return runtimeState
	}

	public async recordContinuationAnchor(workspace: string, key: string, value: string): Promise<void> {
		const runtimeState = await this.getOrHydrateRuntimeState(workspace)

		if (!runtimeState.memory) {
			runtimeState.memory = { continuation_anchors: {} }
		}
		if (!runtimeState.memory.continuation_anchors) {
			runtimeState.memory.continuation_anchors = {}
		}

		runtimeState.memory.continuation_anchors[key] = value

		if (!runtimeState.version_vectors) {
			runtimeState.version_vectors = {}
		}
		const currentVer = runtimeState.version_vectors[key] || 0
		runtimeState.version_vectors[key] = currentVer + 1

		await this.writeState(workspace, {
			runtime_state: runtimeState,
		})
	}

	public async getContinuationAnchors(workspace: string): Promise<Record<string, string>> {
		const runtimeState = await this.getOrHydrateRuntimeState(workspace)
		return runtimeState.memory?.continuation_anchors || {}
	}

	public async acquireOrchestrationLease(
		workspace: string,
		agentId: string,
		taskId: string,
		durationSeconds = 300,
	): Promise<{ success: boolean; expires_at?: string }> {
		const runtimeState = await this.getOrHydrateRuntimeState(workspace)
		if (!runtimeState.locks) {
			runtimeState.locks = {}
		}

		const existing = runtimeState.locks[taskId]
		const now = new Date()

		if (existing) {
			const expiresAt = new Date(existing.expires_at)
			if (expiresAt.getTime() > now.getTime() && existing.owner_agent !== agentId) {
				return { success: false }
			}
		}

		const expires = new Date(now.getTime() + durationSeconds * 1000)
		runtimeState.locks[taskId] = {
			owner_agent: agentId,
			leased_at: now.toISOString(),
			expires_at: expires.toISOString(),
		}

		if (!runtimeState.version_vectors) {
			runtimeState.version_vectors = {}
		}
		const currentVer = runtimeState.version_vectors[taskId] || 0
		runtimeState.version_vectors[taskId] = currentVer + 1

		await this.writeState(workspace, {
			runtime_state: runtimeState,
		})

		return { success: true, expires_at: expires.toISOString() }
	}

	public async releaseOrchestrationLease(workspace: string, agentId: string, taskId: string): Promise<void> {
		const runtimeState = await this.getOrHydrateRuntimeState(workspace)
		if (!runtimeState.locks || !runtimeState.locks[taskId]) {
			return
		}

		if (runtimeState.locks[taskId].owner_agent === agentId) {
			delete runtimeState.locks[taskId]
			await this.writeState(workspace, {
				runtime_state: runtimeState,
			})
		}
	}

	public async verifyAnchorFreshness(
		workspace: string,
		key: string,
		expectedVersion: number,
	): Promise<{ fresh: boolean; current_version: number }> {
		const runtimeState = await this.getOrHydrateRuntimeState(workspace)
		const current_version = runtimeState.version_vectors?.[key] || 0
		return {
			fresh: current_version === expectedVersion,
			current_version,
		}
	}

	public async getVersionVector(workspace: string, key: string): Promise<number> {
		const runtimeState = await this.getOrHydrateRuntimeState(workspace)
		return runtimeState.version_vectors?.[key] || 0
	}

	public async scheduleAdmission(
		workspace: string,
		agentId: string,
		operation: string,
	): Promise<{ admitted: boolean; backoff_ms: number; pressure_score?: number }> {
		const runtimeState = await this.getOrHydrateRuntimeState(workspace)
		const now = Date.now()

		let activeLocksCount = 0
		if (runtimeState.locks) {
			for (const lock of Object.values(runtimeState.locks)) {
				if (new Date(lock.expires_at).getTime() > now) {
					activeLocksCount++
				}
			}
		}

		const nowTaskCount = runtimeState.tasks?.now?.items?.length || 0

		const state = await this.readState(workspace)
		let recentMutationsCount = 0
		if (state.lineage && Array.isArray(state.lineage)) {
			for (const entry of state.lineage) {
				const entryTime = new Date(entry.timestamp).getTime()
				if (now - entryTime < 5 * 60 * 1000) {
					recentMutationsCount++
				}
			}
		}

		const locksScore = Math.min(0.6, activeLocksCount * 0.2)
		const tasksScore = Math.min(0.2, nowTaskCount * 0.05)
		const mutationsScore = Math.min(0.4, recentMutationsCount * 0.1)
		const pressureScore = Math.min(1.0, locksScore + tasksScore + mutationsScore)

		if (runtimeState.scheduler_state?.last_cooldown_timestamp) {
			const cooldownExpires = new Date(runtimeState.scheduler_state.last_cooldown_timestamp).getTime()
			if (cooldownExpires > now) {
				const remaining = cooldownExpires - now
				return { admitted: false, backoff_ms: Math.max(1000, remaining), pressure_score: pressureScore }
			}
		}

		if (pressureScore >= 0.8) {
			const backoff_ms = Math.round(1000 * 2 ** ((runtimeState.scheduler_state?.queue_size || 1) * pressureScore))
			const finalBackoff = Math.min(10000, Math.max(1000, backoff_ms))

			if (!runtimeState.scheduler_state) {
				runtimeState.scheduler_state = {}
			}
			runtimeState.scheduler_state.last_cooldown_timestamp = new Date(now + finalBackoff).toISOString()
			runtimeState.scheduler_state.pressure_score = pressureScore
			runtimeState.scheduler_state.queue_size = nowTaskCount

			await this.writeState(workspace, {
				runtime_state: runtimeState,
			})

			return { admitted: false, backoff_ms: finalBackoff, pressure_score: pressureScore }
		}

		if (!runtimeState.scheduler_state) {
			runtimeState.scheduler_state = {}
		}
		runtimeState.scheduler_state.pressure_score = pressureScore
		runtimeState.scheduler_state.queue_size = nowTaskCount

		await this.writeState(workspace, {
			runtime_state: runtimeState,
		})

		return { admitted: true, backoff_ms: 0, pressure_score: pressureScore }
	}

	public async readState(workspace: string): Promise<any> {
		const stateFile = this.getStatePath(workspace)
		if (!(await fileExists(stateFile))) {
			return {}
		}
		try {
			const content = await fs.readFile(stateFile, "utf8")
			return JSON.parse(content) || {}
		} catch {
			return {}
		}
	}

	public async writeState(workspace: string, patch: any): Promise<any> {
		const stateFile = this.getStatePath(workspace)
		const tempStateFile = `${stateFile}.tmp`
		const current = await this.readState(workspace)
		const merged = {
			...current,
			...patch,
			updated_at: new Date().toISOString(),
		}
		try {
			await fs.mkdir(path.dirname(stateFile), { recursive: true })
			await fs.writeFile(tempStateFile, JSON.stringify(merged, null, 2), "utf8")
			await fs.rename(tempStateFile, stateFile)
		} catch (error) {
			try {
				await fs.unlink(tempStateFile)
			} catch {}
			await recordLastError({
				string_code: "roadmap_state_write_failed",
				message: error instanceof Error ? error.message : String(error),
				retry_command: "roadmap(action='guide')",
				safe_to_retry: true,
			})
			return { ...merged, _write_failed: true }
		}
		invalidateRoadmapWorkspaceCache(workspace)
		return merged
	}

	public async recordFileMutation(workspace: string, tool: string, filePath: string): Promise<any> {
		invalidateRoadmapWorkspaceCache(workspace)
		const res = await this.writeState(workspace, {
			validation_pending: true,
			schema_valid: null,
			last_mutated_at: new Date().toISOString(),
			last_mutation_tool: tool,
			last_mutation_path: filePath,
		})
		try {
			await recordMutationLineage(workspace, { tool, action: "file_mutated" })
		} catch {}
		return res
	}

	public async recordValidation(
		workspace: string,
		valid: boolean,
		health_status: string | null,
		recent_checkpoint_date: string | null,
		phase: string,
		issue_count: number,
		bootstrap_placeholder_count: number,
	): Promise<any> {
		const currentManifestHash = await computeDependencyManifestsHash(workspace)
		const patch: any = {
			last_validated_at: new Date().toISOString(),
			schema_valid: valid,
			health_status,
			recent_checkpoint_date,
			phase,
			validation_issue_count: issue_count,
			bootstrap_placeholder_count,
			bootstrap_complete: bootstrap_placeholder_count === 0,
			validation_pending: false,
		}
		if (valid) {
			patch.dependency_manifests_hash = currentManifestHash
		}
		const res = await this.writeState(workspace, patch)
		try {
			await recordMutationLineage(workspace, {
				action: "validated",
				schema_valid: valid,
				health_status,
				diff_summary: `Validation issues: ${issue_count}, Bootstrap placeholders: ${bootstrap_placeholder_count}`,
			})
		} catch {}
		return res
	}

	// Evidence Gathering
	public async gatherEvidence(
		workspace: string,
		roadmapText: string | null,
		tier: "light" | "standard" | "full",
	): Promise<any> {
		const root = workspace
		const roadmapPath = path.join(root, "ROADMAP.md")
		let text = roadmapText
		if (text === null && (await fileExists(roadmapPath))) {
			text = await readText(roadmapPath, 500000)
		} else if (text === null) {
			text = ""
		}

		const parsed = parseRoadmapText(text, roadmapPath)
		const git = await getGitRecentChanges(root, tier === "light")

		const readmes: any[] = []
		const architecture_docs: any[] = []
		const configs: any[] = []

		if (tier !== "light") {
			for (const name of ["README.md", "docs/README.md", "readme.md"]) {
				const fullPath = path.join(root, name)
				if (await fileExists(fullPath)) {
					readmes.push({ path: name, excerpt: await readText(fullPath, 2500) })
					break
				}
			}
			for (const name of [
				"docs/architecture.md",
				"ARCHITECTURE.md",
				"docs/design.md",
				"docs/overview.md",
				"CONTRIBUTING.md",
			]) {
				const fullPath = path.join(root, name)
				if (await fileExists(fullPath)) {
					architecture_docs.push({ path: name, excerpt: await readText(fullPath, 2500) })
				}
			}
			for (const name of ["package.json", "plugin.yaml", "pyproject.toml", "Cargo.toml", "go.mod", "CHANGELOG.md"]) {
				const fullPath = path.join(root, name)
				if (await fileExists(fullPath)) {
					configs.push({ path: name, excerpt: await readText(fullPath, 2500) })
				}
			}
		}

		const fingerprint = await buildProjectFingerprint(root)

		const parsedPlaceholderCount = lenPlaceholders(text)
		parsed.bootstrap_complete = parsedPlaceholderCount === 0
		parsed.bootstrap_placeholder_count = parsedPlaceholderCount

		const evidence: any = {
			workspace: root,
			gathered_at: new Date().toISOString(),
			evidence_tier: tier,
			roadmap: parsed,
			readmes,
			architecture_docs,
			configs,
			git,
			todo_markers: [],
			test_file_count: 0,
			uncertainty: [],
			_roadmap_text: text || null,
			project_fingerprint: fingerprint,
		}

		if (tier === "full") {
			const heavy = await scanWorkspace(root)
			evidence.todo_markers = heavy.todoMarkers
			evidence.test_file_count = heavy.testFileCount
			evidence.code_soup_audit = await assessCodeSoup(root, heavy)
		}

		// uncertainty
		const notes: string[] = []
		if (!parsed.exists) {
			notes.push("ROADMAP.md not found — first pass will create it from evidence.")
		} else if (parsed.sections_missing && parsed.sections_missing.length > 0) {
			notes.push(`ROADMAP.md missing sections: ${parsed.sections_missing.slice(0, 4).join(", ")}`)
		}
		if (readmes.length === 0) {
			notes.push("No README found — center of gravity may need explicit user input.")
		}
		if (!git.available) {
			notes.push("Git history unavailable — recent change signals limited.")
		}
		if (parsed.exists && !parsed.health_status) {
			notes.push("Roadmap health status not parsed — verify section 2 format.")
		}
		if (parsed.now_item_count > 5) {
			notes.push(`Now section overloaded (${parsed.now_item_count} items) — demote to Next or Archive.`)
		}
		evidence.uncertainty = notes

		const digest = buildProjectSteeringDigest(fingerprint)
		evidence.project_steering_digest = digest
		evidence.project_identity_line = digest.identity_line

		return evidence
	}

	// Freshness evaluation
	public assessFreshness(
		recentCheckpointDate: string | null,
		gitCommits: string[],
		schemaValid: boolean | null,
		staleDays = 7,
		gitCommitsSinceCheckpoint: string[],
		driftDetected = false,
	): any {
		if (!recentCheckpointDate) {
			return {
				stale: true,
				reason: "no_recent_checkpoint_date",
				summary: "ROADMAP.md has no parsed Recent Checkpoint date — steering may be outdated.",
				days_since_checkpoint: null,
				git_commits_since_checkpoint: gitCommitsSinceCheckpoint.length,
				git_commits_in_window: gitCommits.length,
				recommended_action: "Update Recent Checkpoint (section 11) in ROADMAP.md",
			}
		}

		const parts = recentCheckpointDate.split("-")
		if (parts.length !== 3) {
			return { stale: true, reason: "invalid_date", summary: "ROADMAP.md recent checkpoint date format is invalid." }
		}
		const checkpointDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
		const today = new Date()
		today.setHours(0, 0, 0, 0)
		checkpointDate.setHours(0, 0, 0, 0)

		const diffTime = Math.abs(today.getTime() - checkpointDate.getTime())
		const daysSince = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

		let stale = false
		let reason = "fresh"
		let summary = `Last checkpoint ${recentCheckpointDate} (${daysSince}d ago).`

		if (schemaValid === false) {
			stale = true
			reason = "schema_invalid"
			summary = "ROADMAP.md failed schema validation — checkpoint pass incomplete."
		} else if (driftDetected) {
			stale = true
			reason = "dependency_drift"
			summary =
				"Dependency drift detected: workspace package manifests modified since last checkpoint — update Recent Checkpoint."
		} else if (daysSince > staleDays && gitCommitsSinceCheckpoint.length >= 3) {
			stale = true
			reason = "checkpoint_older_than_git_activity"
			summary = `Checkpoint is ${daysSince}d old with ${gitCommitsSinceCheckpoint.length} git commit(s) since that date — roadmap may not reflect current direction.`
		} else if (daysSince > staleDays * 2) {
			stale = true
			reason = "checkpoint_expired"
			summary = `Checkpoint is ${daysSince}d old — schedule a roadmap refresh.`
		}

		const staleDaysLimit = staleDays
		const daysRemaining = Math.max(0, staleDaysLimit - daysSince)
		let checkpointDateObj = checkpointDate
		if (Number.isNaN(checkpointDateObj.getTime())) {
			checkpointDateObj = new Date()
		}
		const windowEnds = new Date(checkpointDateObj.getTime() + staleDaysLimit * 24 * 60 * 60 * 1000)

		let score = 100
		if (recentCheckpointDate) {
			score -= Math.min(50, daysSince * 10)
			score -= Math.min(45, gitCommitsSinceCheckpoint.length * 15)
		} else {
			score = 0
		}
		if (driftDetected) {
			score -= 40
		}
		if (schemaValid === false) {
			score -= 50
		}
		score = Math.max(0, score)

		const temporalValidity = {
			freshness_score: score,
			window_start: checkpointDateObj.toISOString().slice(0, 10),
			window_ends: windowEnds.toISOString().slice(0, 10),
			expired: daysSince > staleDaysLimit,
			days_remaining: daysRemaining,
			dependency_drift_detected: driftDetected,
		}

		return {
			stale,
			reason,
			summary,
			days_since_checkpoint: daysSince,
			git_commits_since_checkpoint: gitCommitsSinceCheckpoint.length,
			git_commits_in_window: gitCommits.length,
			recommended_action: stale ? "Update Recent Checkpoint (section 11) in ROADMAP.md" : "roadmap(action='guide')",
			checkpoint_date: recentCheckpointDate,
			temporal_validity: temporalValidity,
		}
	}

	// Gate State
	public async buildRoadmapGateState(workspace: string, evidence: any, validation: RoadmapValidation | null): Promise<any> {
		const pathStr = path.join(workspace, "ROADMAP.md")
		const present = await fileExists(pathStr)
		const wsState = await this.readState(workspace)

		const roadmap = evidence.roadmap || {}
		const checkpoint_date = roadmap.recent_checkpoint_date
		const git_commits = (evidence.git || {}).recent_commits || []

		let since_commits: string[] = []
		if (checkpoint_date && present) {
			const resCommits = await runGit(workspace, ["log", "--oneline", `--since=${checkpoint_date.trim()}`])
			since_commits = resCommits ? resCommits.split(/\r?\n/).filter(Boolean) : []
		}

		const currentManifestHash = await computeDependencyManifestsHash(workspace)
		const cachedHash = wsState.dependency_manifests_hash || ""
		const driftDetected =
			cachedHash &&
			cachedHash !== "no_manifests" &&
			currentManifestHash !== "no_manifests" &&
			cachedHash !== currentManifestHash

		const freshness = this.assessFreshness(
			checkpoint_date,
			git_commits,
			validation ? validation.valid : (wsState.schema_valid ?? null),
			getRoadmapConfig().stale_checkpoint_days,
			since_commits,
			!!driftDetected,
		)

		const inputs = await collectGateInputs({
			workspace,
			evidence,
			validation,
			freshness,
			workspaceState: wsState,
			roadmapPresent: present,
		})

		return buildGateStateFromInputs(inputs)
	}

	// Bootstrap Fill Planning & Writing
	public buildBootstrapFillPlan(roadmapText: string, evidence: any): any {
		const fp = evidence.project_fingerprint || {}
		const placeholders = findBootstrapPlaceholders(roadmapText)
		const tasks: any[] = []
		for (const issue of placeholders) {
			const phrase = phraseFromIssue(issue.message)
			const [replacement, source] = suggestReplacement(phrase, fp, evidence)
			tasks.push({
				template_phrase: phrase,
				suggested_replacement: replacement,
				evidence_source: source,
				severity: issue.severity,
			})
		}

		const now_suggestions = suggestNowItems(evidence)
		return {
			remaining_count: tasks.length,
			bootstrap_complete: tasks.length === 0,
			tasks,
			now_suggestions,
			project_brief: fp.steering_brief || fp.steering_identity || "",
			operator_summary:
				tasks.length > 0
					? `${tasks.length} template phrase(s) remain — autofill runs at attempt_completion. Optional preview: ${AUTO_GOVERNANCE.previewBootstrapAutofill}`
					: "Bootstrap fill complete — no template phrases detected.",
			agent_next_call: AUTO_GOVERNANCE.continueTaskMidPass,
		}
	}

	public applyBootstrapFillDraft(roadmapText: string, evidence: any): any {
		const plan = this.buildBootstrapFillPlan(roadmapText, evidence)
		let text = roadmapText
		const applied: any[] = []
		for (const task of plan.tasks) {
			const phrase = task.template_phrase
			const repl = (task.suggested_replacement || "").trim()
			const source = task.evidence_source || ""
			if (phrase && text.includes(phrase) && repl && repl !== phrase && !source.startsWith("manual")) {
				text = text.replace(phrase, repl)
				applied.push(task)
			}
		}

		const remaining = findBootstrapPlaceholders(text)
		return {
			applied_count: applied.length,
			applied_tasks: applied,
			remaining_count: remaining.length,
			bootstrap_complete: remaining.length === 0,
			preview_text: text,
			operator_summary:
				applied.length > 0
					? `Applied ${applied.length} evidence-backed replacement(s); ${remaining.length} template phrase(s) remain.`
					: `${remaining.length} template phrase(s) remain — ${AUTO_GOVERNANCE.bootstrapAtCompletion}`,
		}
	}

	public async writeBootstrapAutofill(workspace: string, dryRun: boolean): Promise<any> {
		const roadmapPath = path.join(workspace, "ROADMAP.md")
		if (!(await fileExists(roadmapPath))) {
			return {
				ok: false,
				success: false,
				error: "ROADMAP.md not found — run roadmap(action='template') or checkpoint first.",
				workspace,
			}
		}

		const text = await fs.readFile(roadmapPath, "utf8")
		const evidence = await this.gatherEvidence(workspace, text, "standard")
		const draft = this.applyBootstrapFillDraft(text, evidence)
		const fill_plan = this.buildBootstrapFillPlan(text, evidence)

		const result: any = {
			ok: true,
			success: true,
			workspace,
			roadmap_path: roadmapPath,
			dry_run: dryRun,
			bootstrap_fill_plan: fill_plan,
			project_steering_digest: buildProjectSteeringDigest(evidence.project_fingerprint || {}, fill_plan),
			bootstrap_autofill_preview: draft,
			operator_summary: draft.operator_summary,
			agent_next_call: AUTO_GOVERNANCE.continueTaskMidPass,
		}

		if (dryRun || draft.applied_count === 0) {
			return result
		}

		await writeRoadmapAtomically(workspace, draft.preview_text)

		const newRuntimeState = hydrateRuntimeState(draft.preview_text)
		const newHash = crypto.createHash("sha256").update(draft.preview_text).digest("hex").slice(0, 16)
		await this.writeState(workspace, {
			runtime_state: newRuntimeState,
			roadmap_md_hash: newHash,
		})

		await this.recordFileMutation(workspace, "roadmap", "ROADMAP.md")

		result.written = true
		result.applied_count = draft.applied_count
		result.validation_pending = true
		return result
	}

	// Cached workspace context for gate/evidence operations
	private async resolveWorkspaceContext(
		workspace: string,
		tier: EvidenceTier = "standard",
		roadmapText?: string | null,
		options?: { validatePendingOnRead?: boolean },
	): Promise<{
		workspace: string
		text: string
		roadmapPath: string
		evidence: any
		validation: RoadmapValidation
		gateState: any
		state: any
	}> {
		const { key, roadmapPath } = await buildSnapshotKey(workspace, tier)
		let state = await this.readState(workspace)

		if (state.validation_pending && roadmapText === undefined && options?.validatePendingOnRead) {
			await this.validateRoadmap(workspace)
			state = await this.readState(workspace)
		}

		const cached = getSnapshotFromCache(key)
		if (cached) {
			return {
				workspace,
				text: String((cached.evidence as any)._roadmap_text || ""),
				roadmapPath,
				evidence: cached.evidence,
				validation: cached.validation as RoadmapValidation,
				gateState: cached.gateState,
				state,
			}
		}

		let text = roadmapText
		if (text === undefined) {
			text = (await fileExists(roadmapPath)) ? await readText(roadmapPath, 500000) : ""
		} else if (text === null) {
			text = ""
		}

		if (text) {
			const currentHash = crypto.createHash("sha256").update(text).digest("hex").slice(0, 16)
			if (!state.runtime_state || state.roadmap_md_hash !== currentHash) {
				const runtimeState = hydrateRuntimeState(text)
				if (state.runtime_state) {
					if (state.runtime_state.memory) runtimeState.memory = state.runtime_state.memory
					if (state.runtime_state.active_window) runtimeState.active_window = state.runtime_state.active_window
					if (state.runtime_state.locks) runtimeState.locks = state.runtime_state.locks
					if (state.runtime_state.scheduler_state) runtimeState.scheduler_state = state.runtime_state.scheduler_state
					if (state.runtime_state.version_vectors) runtimeState.version_vectors = state.runtime_state.version_vectors
				}
				state = await this.writeState(workspace, {
					runtime_state: runtimeState,
					roadmap_md_hash: currentHash,
				})
			}
		}

		const evidence = await this.gatherEvidence(workspace, text, tier)
		const validation = validateRoadmapContent(text)
		const gateState = await this.buildRoadmapGateState(workspace, evidence, validation)

		setSnapshotCache(key, {
			workspace,
			roadmapPath,
			roadmapMtimeMs: null,
			tier,
			evidence,
			validation,
			gateState,
			cachedAt: Date.now(),
		})

		return { workspace, text, roadmapPath, evidence, validation, gateState, state }
	}

	private buildOperationalPayload(
		action: string,
		ctx: Awaited<ReturnType<RoadmapService["resolveWorkspaceContext"]>>,
		userRequest = "",
	): any {
		const { workspace, text, evidence, validation, gateState, state } = ctx

		const nowMs = Date.now()
		let activeLocksCount = 0
		if (state.runtime_state?.locks) {
			for (const lock of Object.values(state.runtime_state.locks)) {
				if (new Date((lock as any).expires_at).getTime() > nowMs) {
					activeLocksCount++
				}
			}
		}
		const nowTaskCount = state.runtime_state?.tasks?.now?.items?.length || 0
		let recentMutationsCount = 0
		if (state.lineage && Array.isArray(state.lineage)) {
			for (const entry of state.lineage) {
				const entryTime = new Date((entry as any).timestamp).getTime()
				if (nowMs - entryTime < 5 * 60 * 1000) {
					recentMutationsCount++
				}
			}
		}
		const locksScore = Math.min(0.6, activeLocksCount * 0.2)
		const tasksScore = Math.min(0.2, nowTaskCount * 0.05)
		const mutationsScore = Math.min(0.4, recentMutationsCount * 0.1)
		const pressureScore = Math.min(1.0, locksScore + tasksScore + mutationsScore)

		const bootstrap_inc = isBootstrapIncomplete({
			roadmap_exists: gateState.roadmap_present,
			bootstrap_complete: gateState.bootstrap_complete,
			bootstrap_placeholder_count: gateState.bootstrap_placeholder_count,
		})
		const phase = determinePhase({
			roadmap_exists: gateState.roadmap_present,
			sections_missing: evidence.roadmap.sections_missing || [],
			health_status: evidence.roadmap.health_status,
			validation_valid: validation.valid,
			bootstrap_incomplete: bootstrap_inc,
		})
		const next_rec = recommendNextAction({
			phase: phase.phase,
			roadmap_exists: gateState.roadmap_present,
			schema_valid: validation.valid,
			stale: gateState.checkpoint_stale,
			validation_pending: !!state.validation_pending,
			bootstrap_incomplete: bootstrap_inc,
		})

		const tv = gateState.temporal_validity || (gateState.checkpoint_freshness as any)?.temporal_validity

		let confidence = 1.0
		if (!gateState.roadmap_present) {
			confidence = 0.0
		} else {
			if (validation.valid === false) {
				confidence -= 0.5
			}
			if (state.validation_pending) {
				confidence -= 0.2
			}
			if (gateState.checkpoint_stale) {
				confidence -= 0.3
			}
			const remainingCount = gateState.bootstrap_placeholder_count || 0
			if (remainingCount > 0) {
				confidence -= Math.min(0.4, remainingCount * 0.1)
			}
			const risk = evidence.roadmap?.code_soup_risk || (evidence.code_soup_audit || {}).overall_risk || "Low"
			if (risk === "High") {
				confidence -= 0.3
			} else if (risk === "Medium") {
				confidence -= 0.1
			}
		}
		confidence = Math.max(0.0, Math.min(1.0, confidence))

		let intentClass = "CONTINUE_NORMAL"
		if (!gateState.roadmap_present) {
			intentClass = "BOOTSTRAP_PROJECT"
		} else if (validation.valid === false) {
			intentClass = "REMEDIATE_SCHEMA"
		} else if (gateState.checkpoint_stale) {
			intentClass = "STAMP_CHECKPOINT"
		} else if (bootstrap_inc) {
			intentClass = "BOOTSTRAP_FILL"
		}

		const continuationSemantics = {
			intent_class: intentClass,
			can_continue: confidence >= 0.5,
			confidence_score: Number(confidence.toFixed(2)),
			validation_token: state.updated_at
				? crypto.createHash("sha256").update(state.updated_at).digest("hex").slice(0, 16)
				: "none",
			gates_to_clear: (gateState.blocking_gates || []).map((g: any) => g.id),
		}

		const payload: any = {
			action,
			success: true,
			ok: true,
			enabled: getRoadmapConfig().enabled,
			phase: phase.phase,
			skill: "auto-rolling-roadmap",
			skill_path: BUNDLED_SKILL_REL,
			workspace,
			roadmap_path: ctx.roadmapPath,
			roadmap_exists: gateState.roadmap_present,
			health_status: evidence.roadmap.health_status,
			code_soup_risk: evidence.roadmap.code_soup_risk || (evidence.code_soup_audit || {}).overall_risk || "Low",
			sections_missing: evidence.roadmap.sections_missing || [],
			sections_present_count: (evidence.roadmap.sections_present || []).length,
			now_item_count: evidence.roadmap.now_item_count || 0,
			recent_checkpoint_date: evidence.roadmap.recent_checkpoint_date,
			operator_summary: state.validation_pending
				? AUTO_GOVERNANCE.continueTaskMidPass
				: gateState.checkpoint_stale
					? gateState.stale_summary
					: phase.operator_summary,
			agent_next_call: midTaskAgentNextCall({
				validationPending: !!state.validation_pending,
				bootstrapIncomplete: bootstrap_inc,
				roadmapMissing: !gateState.roadmap_present,
				fallback: next_rec.command,
			}),
			recommended_next_action: next_rec,
			schema_valid: validation.valid,
			prime_directive: "Did the latest work strengthen or weaken the project's center of gravity?",
			uncertainty: evidence.uncertainty || [],
			checkpoint_freshness: gateState.checkpoint_fresh ? { stale: false, summary: gateState.stale_summary } : gateState,
			roadmap_gate: gateState,
			kanban_complete_allowed: gateState.kanban_complete_allowed,
			workspace_state: gateState.workspace_state,
			project_fingerprint: evidence.project_fingerprint,
			steering_brief: (evidence.project_fingerprint || {}).steering_brief,
			stack_summary: (evidence.project_fingerprint || {}).stack_summary,
			project_archetype: (evidence.project_fingerprint || {}).project_archetype,
			bootstrap_complete: gateState.bootstrap_complete,
			bootstrap_placeholder_count: gateState.bootstrap_placeholder_count,
			auto_clearable_governance_only: isAutoClearableGovernanceOnly({
				kanbanCompleteAllowed: gateState.kanban_complete_allowed,
				validationPending: !!state.validation_pending,
				schemaValid: validation.valid,
				blockingGates: (gateState.blocking_gates || []) as Array<{ id?: string }>,
			}),
			governance_policy: AUTO_GOVERNANCE.governancePolicy,
			execution_confidence_score: Number(confidence.toFixed(2)),
			continuation_semantics: continuationSemantics,
			temporal_validity: tv,
			runtime_state: state.runtime_state,
			orchestration_pressure_score: Number(pressureScore.toFixed(2)),
		}

		if (userRequest.trim()) {
			payload.user_request = userRequest.trim()
		}
		if (state.validation_pending) {
			payload.validation_pending = true
		}

		enrichWithBootstrapFill(payload, text, evidence, bootstrap_inc)
		payload.steering_line = formatAgentSteeringLine(payload.project_steering_digest || {})
		return this.wrapClarityEnvelope(payload, phase)
	}

	// Tool actions implementations
	public async getOperationalStatus(
		workspace: string,
		contextHint = "",
		tier: EvidenceTier = "standard",
		options?: { validatePendingOnRead?: boolean },
	): Promise<any> {
		const ctx = await this.resolveWorkspaceContext(workspace, tier, undefined, options)
		const action = contextHint.trim().toLowerCase() === "status" ? "status" : "guide"
		return this.buildOperationalPayload(action, ctx)
	}

	public async checkpointBrief(workspace: string, context = "", userRequest = ""): Promise<any> {
		const ctx = await this.resolveWorkspaceContext(workspace, "full")
		const status = this.buildOperationalPayload("checkpoint", ctx, userRequest)
		const { evidence, gateState } = ctx
		const text = ctx.text

		const isVerbose = (context || "").toLowerCase().includes("verbose")
		const evidencePayload = isVerbose ? evidence : slimEvidence(evidence)

		const payload: any = {
			...status,
			action: "checkpoint",
			algorithm_steps: algorithmSteps(),
			required_sections: [...REQUIRED_SECTIONS],
			evidence: evidencePayload,
			existing_roadmap_summary: evidence.roadmap,
			code_soup_pre_audit: evidence.code_soup_audit,
			agent_instructions: agentInstructions(status.phase, evidence),
			response_format: responseFormatTemplate(),
			bootstrap_template_available: !evidence.roadmap.exists,
			open_todo_marker_count: (evidence.todo_markers || []).length,
			semantic_snapshot: !isVerbose,
		}

		if (!evidence.roadmap.exists) {
			payload.suggested_bootstrap = bootstrapSkeletonFromEvidenceAutofilled(evidence)
			payload.bootstrap_evidence_driven = true
		}

		const bootstrap_inc = isBootstrapIncomplete({
			roadmap_exists: gateState.roadmap_present,
			bootstrap_complete: gateState.bootstrap_complete,
			bootstrap_placeholder_count: gateState.bootstrap_placeholder_count,
		})
		if (status.phase === "bootstrap_fill" || bootstrap_inc) {
			enrichWithBootstrapFill(payload, text, evidence, true)
		}

		const ctx_lower = (context || "").toLowerCase()
		const autofill_write =
			(ctx_lower.includes("apply autofill write") ||
				ctx_lower.includes("apply bootstrap write") ||
				ctx_lower.includes("autofill write") ||
				ctx_lower.includes("write autofill") ||
				ctx_lower.trim() === "apply autofill" ||
				ctx_lower.trim() === "apply bootstrap" ||
				ctx_lower.trim() === "autofill") &&
			!ctx_lower.includes("preview")

		if (autofill_write) {
			const applied = await this.writeBootstrapAutofill(workspace, false)
			payload.bootstrap_autofill_applied = applied
			if (applied.written) {
				payload.operator_summary = `${applied.operator_summary || "Bootstrap autofill applied."} ${AUTO_GOVERNANCE.validationAtCompletion}`
				payload.agent_next_call = AUTO_GOVERNANCE.continueTaskMidPass
				invalidateRoadmapWorkspaceCache(workspace)
				const refreshed = await this.resolveWorkspaceContext(workspace, "full")
				payload.phase = this.buildOperationalPayload("checkpoint", refreshed).phase
			}
		}

		if (isDigestContext(context)) {
			return slimCheckpointPayload(payload)
		}

		return payload
	}

	/**
	 * Mechanical checkpoint date repair — stamps **Date:** in section 11 when missing or unparsable.
	 * Used by completion-gate auto-remediation only; does not rewrite checkpoint narrative.
	 */
	public async touchRecentCheckpointDate(workspace: string): Promise<{ written: boolean; reason?: string }> {
		const roadmapPath = path.join(workspace, "ROADMAP.md")
		if (!(await fileExists(roadmapPath))) {
			return { written: false, reason: "missing_file" }
		}

		const runtimeState = await this.getOrHydrateRuntimeState(workspace)

		const today = new Date().toISOString().slice(0, 10)
		const current = runtimeState.checkpoint.date.trim()
		if (/^\d{4}-\d{2}-\d{2}$/.test(current) && current === today) {
			return { written: false, reason: "date_already_valid" }
		}

		runtimeState.checkpoint.date = today

		const secBody = runtimeState.checkpoint.raw_body
		const dateLineMatch = /\*\*Date:\*\*\s*(\S*)/i.exec(secBody)
		let updatedBody = secBody
		if (dateLineMatch) {
			updatedBody = secBody.replace(/(\*\*Date:\*\*\s*)(\S*)/i, `$1${today}`)
		} else {
			const firstLineEnd = secBody.indexOf("\n")
			if (firstLineEnd !== -1) {
				updatedBody = `${secBody.slice(0, firstLineEnd + 1)}**Date:** ${today}\n${secBody.slice(firstLineEnd + 1)}`
			} else {
				updatedBody = `${secBody}\n**Date:** ${today}\n`
			}
		}
		runtimeState.checkpoint.raw_body = updatedBody

		const newText = projectRuntimeStateToMarkdown(runtimeState)
		await writeRoadmapAtomically(workspace, newText)

		const newHash = crypto.createHash("sha256").update(newText).digest("hex").slice(0, 16)
		await this.writeState(workspace, {
			runtime_state: runtimeState,
			roadmap_md_hash: newHash,
		})

		await this.recordFileMutation(workspace, "roadmap_auto_touch", roadmapPath)
		invalidateRoadmapWorkspaceCache(workspace)
		return { written: true }
	}

	public async validateRoadmap(workspace: string): Promise<any> {
		const roadmapPath = path.join(workspace, "ROADMAP.md")
		let text = ""
		if (await fileExists(roadmapPath)) {
			text = await fs.readFile(roadmapPath, "utf8")
		}

		const currentHash = crypto.createHash("sha256").update(text).digest("hex").slice(0, 16)
		const nowTime = Date.now()
		const cached = this.lastValidationResult[workspace]
		if (cached && nowTime - cached.timestamp < 5000 && cached.hash === currentHash) {
			return cached.result
		}

		const cfg = getRoadmapConfig()
		if (cfg.auto_bootstrap_fill && text) {
			const placeholders = findBootstrapPlaceholders(text)
			if (placeholders.length > 0) {
				try {
					const filled = await this.writeBootstrapAutofill(workspace, false)
					if (filled && filled.written && filled.applied_count > 0) {
						text = await fs.readFile(roadmapPath, "utf8")
					}
				} catch (_err) {
					// non-fatal
				}
			}
		}

		const validation = validateRoadmapContent(text)
		const placeholders = findBootstrapPlaceholders(text)
		const bootstrap_placeholder_count = placeholders.length
		const bootstrap_complete = bootstrap_placeholder_count === 0

		const validation_dict: any = {
			valid: validation.valid,
			schema_complete: validation.schema_complete,
			health_status: validation.health_status,
			code_soup_risk: validation.code_soup_risk,
			now_item_count: validation.now_item_count,
			issues: validation.issues,
		}

		const completeness = {
			bootstrap_complete,
			bootstrap_placeholder_count,
		}

		const parsed = text ? parseRoadmapText(text, roadmapPath) : null

		let phase = "validate_pending"
		if (validation.valid) {
			phase = bootstrap_complete ? "checkpoint" : "bootstrap_fill"
		}

		await this.recordValidation(
			workspace,
			validation.valid,
			validation.health_status || null,
			parsed ? parsed.recent_checkpoint_date : null,
			phase,
			validation.issues.length,
			bootstrap_placeholder_count,
		)
		if (validation.valid) {
			await clearLastError()
		}
		invalidateRoadmapWorkspaceCache(workspace)

		const ctx = await this.resolveWorkspaceContext(workspace, "standard", text)
		const evidence = ctx.evidence
		const gateState = ctx.gateState

		const bootstrap_inc = isBootstrapIncomplete({
			roadmap_exists: gateState.roadmap_present,
			bootstrap_complete: gateState.bootstrap_complete,
			bootstrap_placeholder_count: gateState.bootstrap_placeholder_count,
		})

		const phaseInfo = determinePhase({
			roadmap_exists: !!text.trim(),
			sections_missing: evidence.roadmap.sections_missing || [],
			health_status: validation.health_status || null,
			validation_valid: validation.valid,
			bootstrap_incomplete: bootstrap_inc,
		})

		const next_rec = recommendNextAction({
			phase: phaseInfo.phase,
			roadmap_exists: !!text.trim(),
			schema_valid: validation.valid,
			stale: gateState.checkpoint_stale,
			validation_pending: false,
			bootstrap_incomplete: bootstrap_inc,
		})

		const payload: any = {
			action: "validate",
			success: validation.valid,
			ok: validation.valid,
			phase: phaseInfo.phase,
			workspace,
			roadmap_path: roadmapPath,
			validation: validation_dict,
			bootstrap_completeness: completeness,
			recommended_next_action: next_rec,
			operator_summary:
				validation.valid && bootstrap_complete
					? "ROADMAP.md passes schema validation."
					: validation.valid
						? `ROADMAP.md passes schema but unfilled bootstrap template text remains — ${AUTO_GOVERNANCE.bootstrapAtCompletion} Optional preview: ${AUTO_GOVERNANCE.previewBootstrapAutofill}`
						: "ROADMAP.md has schema errors — fix before treating checkpoint as complete.",
			agent_next_call:
				validation.valid && bootstrap_complete
					? AUTO_GOVERNANCE.continueTaskMidPass
					: validation.valid
						? AUTO_GOVERNANCE.continueTaskMidPass
						: "Fix validation issues in ROADMAP.md.",
			governance_diagnostic: true,
			diagnostic_note: AUTO_GOVERNANCE.validateDiagnosticOnly,
		}

		if (bootstrap_inc && validation.valid) {
			enrichWithBootstrapFill(payload, text, evidence, true)
		} else if (validation.valid) {
			payload.project_steering_digest = buildProjectSteeringDigest(evidence.project_fingerprint || {})
			payload.project_identity_line = payload.project_steering_digest.identity_line
		}

		const wrappedPayload = this.wrapClarityEnvelope(payload)
		this.lastValidationResult[workspace] = {
			timestamp: nowTime,
			hash: currentHash,
			result: wrappedPayload,
		}
		return wrappedPayload
	}

	public async getTemplateBrief(workspace: string): Promise<any> {
		const evidence = await this.gatherEvidence(workspace, null, "standard")
		const skeleton = bootstrapSkeletonFromEvidenceAutofilled(evidence)
		const payload: any = {
			action: "template",
			success: true,
			ok: true,
			workspace,
			roadmap_path: path.join(workspace, "ROADMAP.md"),
			skeleton,
			project_fingerprint: evidence.project_fingerprint,
			evidence_summary: {
				readmes: (evidence.readmes || []).length,
				git_commits: ((evidence.git || {}).recent_commits || []).length,
				code_soup_risk: (evidence.code_soup_audit || {}).overall_risk || "Low",
				steering_brief: (evidence.project_fingerprint || {}).steering_brief,
			},
			operator_summary:
				"Evidence-driven skeleton — write to ROADMAP.md; autofill and validation run at attempt_completion.",
			agent_next_call: AUTO_GOVERNANCE.continueTaskMidPass,
		}

		const fill_plan = this.buildBootstrapFillPlan(skeleton, evidence)
		payload.bootstrap_fill_plan = fill_plan
		payload.project_steering_digest = buildProjectSteeringDigest(evidence.project_fingerprint || {}, fill_plan)
		payload.bootstrap_autofill_preview = this.applyBootstrapFillDraft(skeleton, evidence)

		if (fill_plan.tasks && fill_plan.tasks.length > 0) {
			payload.operator_summary = fill_plan.operator_summary
			payload.agent_next_call = fill_plan.agent_next_call
		}

		return this.wrapClarityEnvelope(payload)
	}

	public async applyBootstrapFillBrief(workspace: string, context = ""): Promise<any> {
		const dryRun = !["write", "apply", "commit"].includes((context || "").trim().toLowerCase())
		const result = await this.writeBootstrapAutofill(workspace, dryRun)
		const payload: any = {
			action: "apply_bootstrap_fill",
			...result,
		}

		if (result.written) {
			const validated = await this.validateRoadmap(workspace)
			payload.validation = validated.validation
			payload.phase = validated.phase
			payload.recommended_next_action = validated.recommended_next_action
			payload.bootstrap_fill_plan = validated.bootstrap_fill_plan
			payload.project_steering_digest = validated.project_steering_digest || payload.project_steering_digest
			payload.bootstrap_completeness = validated.bootstrap_completeness

			const valid = (validated.validation || {}).valid
			const remaining = (validated.bootstrap_completeness || {}).bootstrap_placeholder_count
			payload.operator_summary =
				`Applied ${result.applied_count} evidence replacement(s); schema ${valid ? "valid" : "invalid"}.` +
				(remaining ? ` ${remaining} bootstrap phrase(s) remain.` : " Bootstrap fill complete.")
			payload.agent_next_call = (validated.recommended_next_action || {}).command || AUTO_GOVERNANCE.continueTaskMidPass
		} else if (dryRun) {
			payload.operator_summary = result.operator_summary || "Autofill preview — writes run at attempt_completion."
			payload.agent_next_call = AUTO_GOVERNANCE.continueTaskMidPass
			payload.preview_command = AUTO_GOVERNANCE.previewBootstrapAutofill
		}

		const evidence = await this.gatherEvidence(workspace, null, "light")
		payload.steering_brief = (evidence.project_fingerprint || {}).steering_brief
		payload.project_archetype = (evidence.project_fingerprint || {}).project_archetype
		return this.wrapClarityEnvelope(payload)
	}
}

// Helpers for Bootstrap fill mappings
function phraseFromIssue(message: string): string {
	const match = /[“"](.+?)[”"]/.exec(message || "")
	return match ? match[1] : message || ""
}

function lenPlaceholders(text: string): number {
	return findBootstrapPlaceholders(text).length
}

function buildProjectSteeringDigest(fp: any, fillPlan?: any): any {
	const digest: any = {
		steering_brief: fp.steering_brief || fp.steering_identity || "",
		project_archetype: fp.project_archetype,
		stack_summary: fp.stack_summary,
		purpose_hint: fp.purpose_hint,
		has_ci: fp.has_ci,
		has_tests: fp.has_tests,
		entry_points: fp.entry_points || [],
		verification_commands: fp.verification_commands || [],
		git_remote: fp.git_remote,
		agent_rules_files: fp.agent_rules_files || [],
		makefile_targets: fp.makefile_targets || [],
		docs_roots: fp.docs_roots || [],
		license: fp.license,
		runtime_versions: fp.runtime_versions,
		compose_services: fp.compose_services,
		governance_files: fp.governance_files || [],
		workspace_packages: fp.workspace_packages || [],
		has_codeowners: fp.has_codeowners,
		dependency_automation: fp.dependency_automation,
		has_backstage_catalog: fp.has_backstage_catalog,
		catalog_name: fp.catalog_name,
		ci_workflow_names: fp.ci_workflow_names || [],
		ci_systems: fp.ci_systems || [],
		monorepo_tools: fp.monorepo_tools || [],
		quality_tools: fp.quality_tools || [],
		package_managers: fp.package_managers || [],
		issue_templates: fp.issue_templates || [],
		has_pre_commit: fp.has_pre_commit,
	}

	if (fillPlan) {
		digest.bootstrap_remaining = fillPlan.remaining_count
		digest.bootstrap_complete = fillPlan.bootstrap_complete
		if (fillPlan.tasks && fillPlan.tasks.length > 0) {
			const first = fillPlan.tasks[0]
			digest.sample_fill_task = {
				template_phrase: first.template_phrase,
				suggested_replacement: first.suggested_replacement,
				evidence_source: first.evidence_source,
			}
		}
		digest.agent_next_call = fillPlan.agent_next_call
	}

	digest.identity_line = formatAgentSteeringLine(digest)
	return digest
}

function formatAgentSteeringLine(digest: any): string {
	const parts: string[] = []
	const brief = digest.steering_brief || digest.steering_identity
	if (brief) parts.push(brief)
	if (digest.stack_summary && !brief.toLowerCase().includes(digest.stack_summary.toLowerCase())) {
		parts.push(digest.stack_summary)
	}
	const verify = digest.verification_commands || []
	if (verify.length > 0) {
		parts.push(`verify \`${verify[0]}\``)
	}
	const runtime = digest.runtime_versions || {}
	const keys = Object.keys(runtime)
	if (keys.length > 0) {
		parts.push(`${keys[0]} ${runtime[keys[0]]}`)
	}
	if (parts.length === 0 && digest.project_archetype) {
		parts.push(digest.project_archetype.replace("-", " "))
	}
	return parts.join(" · ")
}

function enrichWithBootstrapFill(payload: any, roadmapText: string, evidence: any, bootstrap_inc: boolean): void {
	if (bootstrap_inc) {
		const plan = RoadmapService.getInstance().buildBootstrapFillPlan(roadmapText, evidence)
		const digest = buildProjectSteeringDigest(evidence.project_fingerprint || {}, plan)
		payload.bootstrap_fill_plan = plan
		payload.project_steering_digest = digest
		payload.project_identity_line = digest.identity_line
		payload.bootstrap_autofill_preview = RoadmapService.getInstance().applyBootstrapFillDraft(roadmapText, evidence)
		payload.operator_summary = plan.operator_summary
		payload.agent_next_call = plan.agent_next_call
	} else {
		payload.project_steering_digest = buildProjectSteeringDigest(evidence.project_fingerprint || {})
		payload.project_identity_line = payload.project_steering_digest.identity_line
	}
}

function suggestReplacement(phrase: string, fp: any, evidence: any): [string, string] {
	const git = evidence.git || {}
	const soup = evidence.code_soup_audit || {}
	const commits = git.recent_commits || []
	const changed = git.changed_files_recent || []
	const centralize = (soup.centralization_recommendation || "").trim()
	const signals = soup.signals || []
	const signal_text = signals
		.slice(0, 3)
		.map((s: any) => `${s.code}: ${s.detail}`)
		.join("; ")

	const purpose = fp.purpose_hint || fp.readme_tagline || ""
	const operators = fp.operators_hint || fp.package_description || ""
	const runtime = fp.runtime_center_hint || ""
	const stack = fp.stack_summary || fp.primary_language || ""
	const brief = fp.steering_brief || fp.steering_identity || ""
	const archetype = fp.project_archetype || "project"
	const tests = fp.test_frameworks || []
	const ci = fp.ci_systems || []
	const scripts = fp.entry_points || []

	const mapping: Record<string, [string, string]> = {
		"Describe from README and project evidence": [
			purpose || brief || "State the project's core purpose in plain language.",
			"README tagline / package description",
		],
		"Define from README and project evidence": [
			purpose || brief || "State the project's core purpose in plain language.",
			"README tagline / package description",
		],
		"Derived from README and config evidence during bootstrap.": [
			operators || `Developers and operators working on ${brief || "this codebase"}.`,
			"package.json/pyproject description",
		],
		"Document from architecture docs and repo layout.": [
			architectureHint(fp, evidence, purpose, stack),
			"architecture_docs + project_fingerprint",
		],
		"Describe the main architectural shape from docs and code layout.": [
			architectureHint(fp, evidence, purpose, stack),
			"architecture_docs + project_fingerprint",
		],
		"List the primary flows agents and humans must preserve.": [
			workflowHint(fp, scripts, tests, ci),
			"entry_points + CI/test markers",
		],
		"Preserve primary agent and operator flows identified in README and recent commits.": [
			workflowHint(fp, scripts, tests, ci),
			"README + npm/pyproject scripts + CI/test markers",
		],
		"Hermes workspace project root — ROADMAP.md lives beside source, not in plugin install trees.": [
			runtime || "Project workspace root — ROADMAP.md beside source at repo root.",
			"project_fingerprint.runtime_center_hint",
		],
		"A fragmented patch surface without a documented center of gravity.": [
			antiGoal(archetype, brief),
			"project_fingerprint.project_archetype",
		],
		"Initial roadmap bootstrap.": [
			brief ? `Bootstrap steering surface for ${brief}.` : "Initial roadmap bootstrap from evidence.",
			"project_fingerprint.steering_brief",
		],
		"Insufficient evidence during first pass.": [primaryRisk(evidence, fp), "evidence.uncertainty + git/readme availability"],
		"Clear center of gravity before feature sprawl.": [
			brief
				? `Document ${brief} center of gravity before expanding scope.`
				: "Document center of gravity before feature sprawl.",
			"project_fingerprint.steering_brief",
		],
		"Evidence-backed initial audit — see code_soup_pre_audit in checkpoint payload.": [
			centralize || signal_text || `Code soup risk: ${soup.overall_risk || "Low"} — see code_soup_pre_audit.`,
			"code_soup_pre_audit",
		],
		"Runtime and mutation authority documented in project docs; plugin/kernel trees are not project roots.": [
			runtime || "Runtime authority in repo manifests; ROADMAP.md stays in project workspace only.",
			"project_fingerprint.runtime_center_hint",
		],
		"Run code_soup_pre_audit and document canonical paths.": [
			centralize || signal_text || "Document canonical paths from code_soup_pre_audit signals.",
			"code_soup_pre_audit.centralization_recommendation",
		],
		"Document canonical paths from code_soup_pre_audit.": [
			centralize || signal_text || "List canonical modules and entrypoints from code_soup_pre_audit.",
			"code_soup_pre_audit",
		],
		"No recent git activity in evidence.": [
			commits.length > 0 ? String(commits[0]).slice(0, 160) : "No recent git commits — note limited change signals.",
			"git.recent_commits",
		],
		"No recent git commits captured in evidence.": [
			commits.length > 0 ? String(commits[0]).slice(0, 160) : "No recent git commits captured.",
			"git.recent_commits",
		],
		"Populate Now with 1–3 evidence-backed items connected to center of gravity.": [
			"Now populated from git and fingerprint — review, refine, or demote items.",
			"bootstrap_fill.now_suggestions",
		],
		"Populated from code_soup_pre_audit during bootstrap.": [
			`Code soup risk ${soup.overall_risk || "Low"} from pre-audit.` + (centralize ? ` ${centralize.slice(0, 120)}` : ""),
			"code_soup_pre_audit",
		],
		"Identify from README and config evidence.": [
			operators || purpose || brief || "Identify primary users from README and package manifests.",
			"project_fingerprint.operators_hint",
		],
		"State where operational truth lives.": [
			runtime ||
				(brief
					? `Operational truth at workspace root (${brief}).`
					: "Document where runtime and config authority lives."),
			"project_fingerprint.runtime_center_hint",
		],
		"List anti-goals that protect coherence.": [antiGoal(archetype, brief), "project_fingerprint.project_archetype"],
		"Describe what the project is becoming using README, architecture docs, and recent commits.": [
			narrativeHint(fp, evidence, commits),
			"README + git.recent_commits",
		],
		"Initial audit from evidence bundle.": [
			centralize || signal_text || `Initial code soup audit — risk ${soup.overall_risk || "Low"}.`,
			"code_soup_pre_audit",
		],
		"Document runtime, state, mutation, and diagnostic authority.": [
			runtime || runtimeAuthorityHint(fp, archetype),
			"project_fingerprint + archetype",
		],
		"Review recent git changes for isolated patterns.": [gitDriftHint(commits, changed), "git.changed_files_recent"],
		"Confirm canonical patch and inspection paths are obvious.": [
			centralize || canonicalPathsHint(fp, soup),
			"code_soup_pre_audit + entry_points",
		],
		"One recommendation to strengthen project gravity.": [
			centralize ||
				(brief
					? `Strengthen ${brief} center of gravity via documented Now items and section 9 audit.`
					: "One concrete step to strengthen documented center of gravity."),
			"code_soup_pre_audit.centralization_recommendation",
		],
		"Initial structure only — audit pending deeper pass.": [
			brief
				? `Schema established for ${brief}; deepen section 9 and Now from ongoing checkpoints.`
				: "Schema established — deepen audits on next checkpoint.",
			"project_fingerprint.steering_brief",
		],
		"Created initial ROADMAP.md from evidence.": [
			brief
				? `Created ROADMAP.md for ${brief} from README, git, and code_soup_pre_audit.`
				: "Created initial ROADMAP.md from gathered evidence.",
			"checkpoint evidence bundle",
		],
		"Review Now items — refine goals and demote anything not truly in motion.": [
			"Now seeded from git and fingerprint — refine titles and demote stale items.",
			"bootstrap_fill.now_suggestions",
		],
		"Enable long-horizon coherence under agent-assisted development.": [
			brief
				? `Adopt ROADMAP.md as the long-horizon steering surface for ${brief}.`
				: "Enable long-horizon coherence under agent-assisted development.",
			"project decision",
		],
		"Strategic work routes through Now/Next/Later instead of ad-hoc task dumps.": [
			brief
				? `Route ${brief} strategic work through Now/Next/Later — max 5 Now items.`
				: "Route strategic work through Now/Next/Later instead of ad-hoc task dumps.",
			"roadmap schema contract",
		],
		"Adopt ROADMAP.md as the project steering surface.": [
			brief
				? `Adopt ROADMAP.md at workspace root as the steering surface for ${brief}.`
				: "Adopt ROADMAP.md as the project steering surface.",
			"checkpoint bootstrap decision",
		],
	}

	if (phrase in mapping) {
		return mapping[phrase]
	}

	if (phrase.includes("README")) {
		return [purpose || brief || phrase, "README / fingerprint"]
	}
	if (phrase.toLowerCase().includes("git")) {
		return [commits.length > 0 ? String(commits[0]).slice(0, 160) : phrase, "git.recent_commits"]
	}
	if (phrase.toLowerCase().includes("code_soup")) {
		return [centralize || signal_text || phrase, "code_soup_pre_audit"]
	}

	// Fallback
	if (purpose) return [purpose, "project_fingerprint.purpose_hint"]
	if (operators) return [operators.slice(0, 240), "project_fingerprint.operators_hint"]
	if (runtime) return [runtime.slice(0, 240), "project_fingerprint.runtime_center_hint"]
	if (stack && brief) return [`Document project-specific detail for ${brief} (${stack}).`, "project_fingerprint.stack_summary"]
	if (brief) return [`Document project-specific detail for ${brief}.`, "project_fingerprint.steering_brief"]
	return [
		`Replace template guidance with ${archetype}-specific steering from README and repo evidence.`,
		"project_fingerprint.project_archetype",
	]
}

function architectureHint(fp: any, evidence: any, purpose: string, stack: string): string {
	const arch = evidence.architecture_docs || []
	if (arch.length > 0) {
		const excerpt = (arch[0].excerpt || "").trim().split(/\r?\n/)
		for (const line of excerpt) {
			const stripped = line.trim()
			if (stripped && !stripped.startsWith("#")) {
				return stripped.slice(0, 400)
			}
		}
	}
	const frameworks = fp.frameworks || []
	if (purpose && frameworks.length > 0) {
		return `${purpose} Built with ${frameworks.slice(0, 3).join(", ")}.`
	}
	if (stack) {
		return `Primary stack: ${stack} — canonical layout from repo root and docs.`
	}
	return purpose || "Summarize canonical modules and entrypoints from architecture docs."
}

function workflowHint(fp: any, scripts: string[], tests: string[], ci: string[]): string {
	const parts: string[] = []
	const verify_cmds = fp.verification_commands || []
	if (verify_cmds.length > 0) {
		parts.push(`verify via ${verify_cmds[0]}`)
	} else if (scripts.length > 0) {
		parts.push(`dev/build via ${scripts.slice(0, 3).join(", ")}`)
	}
	if (tests.length > 0 && verify_cmds.length === 0) {
		parts.push(`verify with ${tests[0]}`)
	} else if (tests.length > 0) {
		parts.push(`tests: ${tests[0]}`)
	}
	if (ci.length > 0) {
		parts.push(`CI: ${ci[0]}`)
	}
	if (fp.project_archetype === "hermes-plugin") {
		parts.push("Hermes hook/tool registration and plugin.yaml manifest")
	}
	const agent_rules = fp.agent_rules_files || []
	if (agent_rules.length > 0) {
		parts.push(`agent rules at ${agent_rules[0]}`)
	}
	if (parts.length > 0) {
		return `Preserve flows — ${parts.join("; ")}.`
	}
	return "Document primary dev, deploy, and agent-assisted workflows from README and scripts."
}

function antiGoal(archetype: string, brief: string): string {
	const goals: Record<string, string> = {
		"hermes-plugin":
			"A Hermes plugin that stores ROADMAP.md outside the project workspace or drifts from kernel hook conventions.",
		monorepo: "A monorepo without documented package boundaries and shared center of gravity.",
		"web-app": "A web app whose UI, API, and deploy surfaces diverge without documented authority boundaries.",
		"cli-tool": "A CLI whose entrypoints multiply without a documented operational center.",
		library: "A library whose public API surface drifts without documented stability boundaries.",
	}
	if (archetype in goals) return goals[archetype]
	if (brief) return `Uncontrolled scope changes to ${brief} without a documented center of gravity.`
	return "Uncontrolled scope sprawl without a documented center of gravity."
}

function primaryRisk(evidence: any, fp: any): string {
	const uncertainty = evidence.uncertainty || []
	if (uncertainty.length > 0) {
		return uncertainty[0].slice(0, 200)
	}
	if (!fp.readme_tagline) {
		return "No README tagline — center of gravity may need explicit operator input."
	}
	return "Limited cross-session steering until Now/Next items connect to center of gravity."
}

function narrativeHint(fp: any, _evidence: any, commits: string[]): string {
	const brief = fp.steering_brief || fp.steering_identity || ""
	if (brief) {
		return `Architecting ${brief} with clear separation of concerns, stable domain interfaces, and automated mutation validation.`
	}
	const tagline = fp.readme_tagline || ""
	if (tagline) {
		return `Steering the project for '${tagline}' by establishing canonical workflows and stabilizing core logic.`
	}
	if (commits && commits.length > 0) {
		return `Evolving the workspace through recent changes: ${String(commits[0]).slice(0, 100)}.`
	}
	return "Define the strategic trajectory and narrative using recent commits and project evidence."
}

function runtimeAuthorityHint(fp: any, archetype: string): string {
	const runtime = fp.runtime_center_hint || ""
	if (runtime) return runtime
	if (archetype === "hermes-plugin") {
		return "Hermes plugin.yaml and hooks define runtime authority; kernel trees are not project roots."
	}
	return "Document runtime, state, mutation, and diagnostic authority in repo manifests and docs."
}

function gitDriftHint(commits: string[], changed: string[]): string {
	if (changed.length > 0) {
		return `Recent files: ${changed.slice(0, 5).join(", ")}. Review for isolated duplication or drift.`
	}
	if (commits.length > 0) {
		return `Recent commit activity: ${String(commits[0]).slice(0, 120)}. Review for structural drift.`
	}
	return "No recent git changes captured — limited drift signals."
}

function canonicalPathsHint(fp: any, soup: any): string {
	const rec = (soup.centralization_recommendation || "").trim()
	if (rec) return rec.slice(0, 240)
	const scripts = fp.entry_points || []
	if (scripts.length > 0) {
		return `Canonical dev/test entrypoints: ${scripts.slice(0, 4).join(", ")}.`
	}
	return "Document canonical patch and inspection paths from code_soup_pre_audit."
}

function suggestNowItems(evidence: any, limit = 3): any[] {
	const fp = evidence.project_fingerprint || {}
	const git = evidence.git || {}
	const commits = git.recent_commits || []
	const brief = fp.steering_brief || fp.project_name || "this project"
	const items: any[] = []

	items.push({
		title: "Complete ROADMAP bootstrap fill",
		goal: `Replace remaining template phrases with project-specific facts for ${brief}.`,
		evidence: "bootstrap_fill_plan + project_fingerprint",
		impact: "Strengthens",
	})

	for (const commit of commits.slice(0, Math.max(0, limit - 1))) {
		const subject = commit.split(/\s+/).slice(1).join(" ").slice(0, 100) || "Recent change"
		items.push({
			title: subject,
			goal: `Verify or continue work tied to recent commit: ${commit.slice(0, 120)}.`,
			evidence: "git.recent_commits",
			impact: "Neutral",
		})
	}

	const soup = evidence.code_soup_audit || {}
	const rec = (soup.centralization_recommendation || "").trim()
	if (rec && items.length < limit) {
		items.push({
			title: "Address centralization recommendation",
			goal: rec.slice(0, 240),
			evidence: "code_soup_pre_audit",
			impact: "Strengthens",
		})
	}

	return items.slice(0, limit)
}

export function formatNowSection(items: any[]): string {
	if (!items || items.length === 0) return ""
	const blocks: string[] = []
	for (let i = 0; i < items.length; i++) {
		const item = items[i]
		blocks.push(`### ${i + 1}. ${item.title}

**Goal:**  
${item.goal}

**Evidence:**  
${item.evidence}

**Center-of-Gravity Impact:**  
${item.impact}
`)
	}
	return blocks.join("\n")
}

function bootstrapSkeletonFromEvidenceAutofilled(evidence: any): string {
	const fp = evidence.project_fingerprint || {}
	const nowItems = suggestNowItems(evidence)
	const nowSection = formatNowSection(nowItems)

	const hint = (fp.purpose_hint || fp.readme_tagline || "Define from README and project evidence").trim()
	const operators = (fp.operators_hint || "Derived from README and config evidence during bootstrap.").trim()
	const architecture = architectureHint(fp, evidence, hint, fp.stack_summary || "").trim()
	const workflows = workflowHint(fp, fp.entry_points || [], fp.test_frameworks || [], fp.ci_systems || []).trim()
	const runtime = (
		fp.runtime_center_hint || "Workspace project root — ROADMAP.md lives beside source, not in plugin install trees."
	).trim()
	const must_not = antiGoal(fp.project_archetype || "project", fp.steering_brief || "").trim()
	const health = "Initial roadmap bootstrap."
	const risk = (evidence.code_soup_audit || {}).overall_risk || "Low"
	const centralize = (
		(evidence.code_soup_audit || {}).centralization_recommendation || "Document canonical paths from code_soup_pre_audit."
	).trim()
	const git_summary =
		(evidence.git || {}).recent_commits?.length > 0
			? `Recent commits: ${evidence.git.recent_commits.slice(0, 3).join("; ")}`
			: "No recent git activity in evidence."
	const recent_files = (evidence.git || {}).changed_files_recent || []

	const skeletonText = bootstrapSkeleton({
		project_hint: hint,
		strategic_narrative: hint,
		operators_hint: operators,
		canonical_architecture: architecture,
		canonical_workflows: workflows,
		runtime_center: runtime,
		anti_goals: must_not,
		health_summary: health,
		now_section: nowSection,
		checkpoint_next_move: "Complete ROADMAP.md bootstrap fill; governance runs automatically at attempt_completion.",
		code_soup_risk: risk,
		centralization_recommendation: centralize,
		recent_git_summary: git_summary,
		changed_files: recent_files,
	})

	return skeletonText
}

function algorithmSteps(): string[] {
	return [
		"1. Gather workspace evidence (README, package configs, git log).",
		"2. Construct Project Center of Gravity based on fingerprint evidence.",
		"3. Identify Now, Next, and Later items connected to gravity goals.",
		"4. Assess maintenance hotspots, repeated friction, and agent confusion.",
		"5. Run code soup pre-audit for centralization risks.",
		"6. Document decisions, recent checkpoint, and next moves.",
		"7. Run schema validation on the final ROADMAP.md.",
	]
}

function agentInstructions(phase: string, evidence: any): string[] {
	const fp = evidence.project_fingerprint || {}
	const instructions = [
		"Create or evolve ROADMAP.md at the workspace root only.",
		"Keep Now to 1–5 actionable items; archive stale work instead of appending endlessly.",
		"Section 9 (Centralization & Code Soup Audit) is mandatory on every pass.",
		"Use code_soup_pre_audit signals when writing section 9.",
		"Mark uncertainty explicitly when evidence is missing.",
		"Schema validation and bootstrap autofill run automatically at attempt_completion.",
	]
	if (fp.steering_brief) {
		instructions.push(`Project identity: ${fp.steering_brief}`)
	}
	if (fp.project_archetype) {
		instructions.push(`Archetype: ${fp.project_archetype} — tailor center of gravity and anti-goals to this shape.`)
	}
	if (fp.test_frameworks) {
		instructions.push(
			`Verification surface: ${fp.test_frameworks.slice(0, 3).join(", ")} — reference in Maintenance Gravity when relevant.`,
		)
	}
	const uncertainty = evidence.uncertainty || []
	if (uncertainty.length > 0) {
		instructions.push(`Uncertainty to surface: ${uncertainty.slice(0, 3).join("; ")}`)
	}

	if (phase === "bootstrap") {
		instructions.push(
			"First pass: draft all 12 sections from README, architecture docs, configs, git history, and code_soup_pre_audit.",
		)
	} else if (phase === "structure_repair") {
		instructions.push("Repair missing sections while preserving Decision Log and Archive strategic memory.")
	} else if (phase === "coherence_recovery") {
		instructions.push("Demote overloaded Now items, strengthen Maintenance Gravity, and recommend convergence.")
	} else if (phase === "validate_pending") {
		instructions.push("Repair ROADMAP.md schema issues — validation runs automatically at attempt_completion.")
	} else if (phase === "bootstrap_fill") {
		instructions.push(AUTO_GOVERNANCE.bootstrapAtCompletion)
		instructions.push(
			`Optional preview: ${AUTO_GOVERNANCE.previewBootstrapAutofill}. Use bootstrap_fill_plan.tasks for evidence-backed replacements.`,
		)
	} else {
		instructions.push("Update Recent Checkpoint (section 11) — replace the previous checkpoint with today's pass only.")
	}
	return instructions
}

function responseFormatTemplate(): any {
	return {
		title: "Roadmap Checkpoint Updated",
		fields: "Health, Center of Gravity (one sentence), Moved, Added, Updated, Archived, Code Soup Risk (with brief reason), Recommended Next Move",
		note: "Do not include the full ROADMAP.md in the final response unless the user asks.",
	}
}

const CONFIG_NAMES = ["package.json", "plugin.yaml", "pyproject.toml", "Cargo.toml", "go.mod", "config.yaml", "tsconfig.json"]

const ENTRY_PATTERNS = [
	/if\s+__name__\s*==\s*['"]__main__['"]/m,
	/def\s+main\s*\(/m,
	/register_command\s*\(/m,
	/registry\.register\s*\(/m,
]

const HOOK_MARKERS = ["register_hook(", "ctx.register_hook(", "register_all_hooks"]
