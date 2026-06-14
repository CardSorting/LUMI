#!/usr/bin/env npx tsx
/**
 * Production audit for roadmap checkpoint — wiring, workspace boundaries, and ergonomics.
 * Port of dietcode-plugin/scripts/roadmap_audit.py
 */
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { buildProjectContextLines } from "../src/services/roadmap/RoadmapAgentSteering"
import { isDigestContext, slimCheckpointPayload } from "../src/services/roadmap/RoadmapCheckpointDigest"
import { requireFreshCheckpointBeforeComplete } from "../src/services/roadmap/RoadmapCompletionGate"
import { getRoadmapConfig, invalidateRoadmapConfigCache } from "../src/services/roadmap/RoadmapConfig"
import { gateClosedEnvelope, validationPendingEnvelope } from "../src/services/roadmap/RoadmapErrors"
import { blockingClosedGates, evaluateGateChecks } from "../src/services/roadmap/RoadmapGateCatalog"
import { finalizeRoadmapSession, initRoadmapSession } from "../src/services/roadmap/RoadmapLifecycle"
import {
	isRoadmapFilename,
	parseRoadmapToolAction,
	resolveRoadmapWritePath,
	targetsRoadmapFile,
	validateRoadmapWriteTarget,
} from "../src/services/roadmap/RoadmapNativeBridge"
import {
	buildAgentOperatorHints,
	determinePhase,
	recommendNextAction,
	roadmapToolCommandToSlash,
} from "../src/services/roadmap/RoadmapOperator"
import { formatProgressReport } from "../src/services/roadmap/RoadmapProgress"
import { validateRoadmapContent } from "../src/services/roadmap/RoadmapSchema"
import { RoadmapService } from "../src/services/roadmap/RoadmapService"
import { sessionBrief } from "../src/services/roadmap/RoadmapSession"
import { executeRoadmapSlashCommand } from "../src/services/roadmap/RoadmapSlashCommand"
import { buildSteeringContext } from "../src/services/roadmap/RoadmapSteeringContext"
import { DietCodeDefaultTool } from "../src/shared/tools"

const ROOT = path.resolve(__dirname, "..")

const REQUIRED_FILES = [
	"src/services/roadmap/RoadmapConfig.ts",
	"src/services/roadmap/RoadmapNativeBridge.ts",
	"src/services/roadmap/RoadmapSession.ts",
	"src/services/roadmap/RoadmapOperator.ts",
	"src/services/roadmap/RoadmapSnapshot.ts",
	"src/services/roadmap/RoadmapService.ts",
	"src/services/roadmap/RoadmapProgress.ts",
	"src/services/roadmap/RoadmapErrors.ts",
	"src/services/roadmap/RoadmapDoctor.ts",
	"src/services/roadmap/RoadmapCockpit.ts",
	"src/services/roadmap/RoadmapGateCatalog.ts",
	"src/services/roadmap/RoadmapAgentSteering.ts",
	"src/services/roadmap/RoadmapCompletionGate.ts",
	"src/services/roadmap/RoadmapLifecycle.ts",
	"src/services/roadmap/RoadmapToolJournal.ts",
	"src/services/roadmap/RoadmapFreshness.ts",
	"src/services/roadmap/RoadmapCache.ts",
	"src/services/roadmap/RoadmapSkillInstall.ts",
	"src/services/roadmap/RoadmapSlashCommand.ts",
	"src/services/roadmap/RoadmapFileWatcher.ts",
	"src/services/roadmap/RoadmapSteeringContext.ts",
	"src/services/roadmap/RoadmapSchema.ts",
	"src/core/task/tools/handlers/RoadmapToolHandler.ts",
	"src/core/prompts/system-prompt/components/roadmap_steering.ts",
	"src/core/prompts/system-prompt/tools/roadmap.ts",
	"optional-skills/dietcode/auto-rolling-roadmap/SKILL.md",
]

const FORBIDDEN = /\b(mock|stub|placeholder|simulated|not implemented|TODO implement)\b/i

async function scanProductionSources(): Promise<string[]> {
	const issues: string[] = []
	const dir = path.join(ROOT, "src/services/roadmap")
	const entries = await fs.readdir(dir)
	for (const name of entries) {
		if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue
		const filePath = path.join(dir, name)
		const text = await fs.readFile(filePath, "utf8")
		for (const [i, line] of text.split("\n").entries()) {
			const stripped = line.trim()
			if (stripped.startsWith("//") || stripped.startsWith("*")) continue
			if (line.includes("bootstrap_placeholder") || line.includes("findBootstrapPlaceholders")) continue
			if (/unfilled bootstrap/i.test(line)) continue
			if (line.includes("bootstrap_complete") || /placeholder guidance/i.test(line)) continue
			if (line.includes("TODO|FIXME")) continue
			if (FORBIDDEN.test(line)) {
				issues.push(`${path.relative(ROOT, filePath)}:${i + 1}: ${stripped.slice(0, 100)}`)
			}
		}
	}
	return issues
}

async function runIntegrationChecks(failures: string[]): Promise<void> {
	const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "roadmap-audit-"))
	try {
		await fs.writeFile(path.join(tmp, "README.md"), "# Audit Project\n\nPurpose line.\n", "utf8")
		await fs.writeFile(path.join(tmp, "AGENTS.md"), "# Agents\n\nRun make verify before roadmap checkpoint closes.\n", "utf8")
		await fs.writeFile(path.join(tmp, "Makefile"), ".PHONY: verify test\nverify:\n\ttrue\n", "utf8")

		const service = RoadmapService.getInstance()
		const gate = await service.buildRoadmapGateState(tmp, await service.gatherEvidence(tmp, null, "light"), null)
		if (!("blocking_gates" in gate)) {
			failures.push("gate state missing blocking_gates")
		}

		const hints = buildAgentOperatorHints({ gate, workspace: tmp })
		for (const key of ["slash_commands", "preferred_tool", "next_action", "write_guard", "roadmap_path"]) {
			if (!(key in hints)) failures.push(`operator hints missing ${key}`)
		}

		const doctor = await service.runDoctor(tmp)
		if (!doctor.recommended_next_action) failures.push("doctor missing recommended_next_action")
		if (!doctor.checks || !Array.isArray(doctor.checks)) failures.push("doctor missing checks array")

		const cockpit = await service.buildCockpit(tmp)
		if (!cockpit.project_identity_line && !cockpit.steering_brief) {
			failures.push("cockpit missing project identity")
		}

		const checkpointDigest = await service.checkpointBrief(tmp, "digest")
		if (checkpointDigest.context_mode !== "digest") failures.push("checkpoint digest mode not applied")

		const ctxLines = buildProjectContextLines((await sessionBrief(tmp, true)) || {})
		if (ctxLines.length < 2) failures.push("agent steering context lines too sparse")

		const invalidSchemaClosed = evaluateGateChecks({
			config: getRoadmapConfig(),
			workspace: tmp,
			roadmap_path: `${tmp}/ROADMAP.md`,
			roadmap_present: true,
			validation: { valid: false, schema_complete: false, code_soup_risk: "Low", now_item_count: 0, issues: [] },
			freshness: { stale: false },
			workspace_state: {},
			bootstrap_complete: true,
			bootstrap_placeholder_count: 0,
			project_fingerprint: {},
			evidence_roadmap: {},
			workspace_skill_installed: false,
		}).closed
		const schemaBlocking = blockingClosedGates(invalidSchemaClosed, getRoadmapConfig())
		if (!schemaBlocking.some((g) => g.id === "schema_valid")) {
			failures.push("invalid schema should block completion when block_kanban_on_invalid_schema=true")
		}

		const evidence = await service.gatherEvidence(tmp, null, "standard")
		const template = await service.getTemplateBrief(tmp)
		const skeleton = String(template.skeleton || "")
		if (!skeleton.includes("Audit Project")) failures.push("evidence bootstrap missing README title")
		if (skeleton.includes("Describe from README"))
			failures.push("evidence bootstrap still contains generic placeholder phrase")
		if (!skeleton.includes("Purpose line")) failures.push("evidence bootstrap should include README tagline in purpose")

		const validated = validateRoadmapContent(skeleton)
		if (!validated.schema_complete) failures.push("bootstrap skeleton not schema-complete")

		const reject = await validateRoadmapWriteTarget("/Users/bozoegg/.hermes/plugins/dietcode/ROADMAP.md", tmp)
		if (reject.allowed) failures.push("should reject ROADMAP write outside workspace")

		const okWrite = await validateRoadmapWriteTarget("ROADMAP.md", tmp)
		if (!okWrite.allowed) failures.push(`should allow ROADMAP.md at workspace root: ${okWrite.error}`)

		const brief = await sessionBrief(tmp, true)
		if (!brief?.roadmap_path) failures.push("session_brief missing roadmap_path")
		if (!brief?._roadmap_operator_hints) failures.push("session_brief missing _roadmap_operator_hints")
		if (!brief?.project_identity_line && !brief?.steering_line) failures.push("session_brief missing steering identity")

		const phase = determinePhase({
			roadmap_exists: false,
			sections_missing: [],
			health_status: null,
			validation_valid: undefined,
			bootstrap_incomplete: false,
		})
		if (phase.phase !== "bootstrap") failures.push(`expected bootstrap phase, got ${phase.phase}`)

		const rec = recommendNextAction({ validation_pending: true, roadmap_exists: true })
		if (rec.action !== "run_validate") failures.push("recommendNextAction should prioritize validation_pending")

		const staleRec = recommendNextAction({ stale: true, roadmap_exists: true, schema_valid: true })
		if (staleRec.action !== "explain_stale") failures.push("recommendNextAction should route stale to explain_stale")

		const slashHelp = await executeRoadmapSlashCommand("help", tmp)
		if (!slashHelp.includes("cockpit")) failures.push("roadmap slash help missing cockpit subcommand")

		const slashCockpit = await executeRoadmapSlashCommand("cockpit", tmp)
		if (!slashCockpit.includes("Roadmap cockpit")) failures.push("roadmap slash cockpit should return cockpit report")

		if (roadmapToolCommandToSlash("roadmap(action='explain_stale')") !== "/roadmap explain-stale") {
			failures.push("roadmapToolCommandToSlash should map explain_stale")
		}

		const steering = await buildSteeringContext(tmp)
		if (!steering.roadmap_path) failures.push("buildSteeringContext missing roadmap_path")

		const pendingEnv = validationPendingEnvelope(tmp)
		if (!pendingEnv.suggested_slash_command.includes("validate")) {
			failures.push("validationPendingEnvelope should suggest /roadmap validate")
		}
		const gateEnv = gateClosedEnvelope("test")
		if (!gateEnv.diagnostic_command.includes("explain-gate")) {
			failures.push("gateClosedEnvelope should use /roadmap explain-gate diagnostic")
		}

		const progressReport = await formatProgressReport({ workspace: tmp, timeline: true, snapshot: steering })
		if (!progressReport.includes("explain-gate")) failures.push("formatProgressReport missing live footer")

		const digestPayload = slimCheckpointPayload({
			action: "checkpoint",
			evidence: { roadmap: { exists: true }, source_files: ["heavy"] },
			existing_roadmap_summary: "long text",
			suggested_bootstrap: "skeleton",
		})
		if (digestPayload.context_mode !== "digest") failures.push("slimCheckpointPayload missing context_mode")
		if ((digestPayload as Record<string, unknown>).existing_roadmap_summary) {
			failures.push("slimCheckpointPayload should omit existing_roadmap_summary")
		}

		if (!isDigestContext("digest") || !isDigestContext("compact checkpoint")) {
			failures.push("isDigestContext should recognize digest/compact")
		}

		if (!isRoadmapFilename("ROADMAP.md")) failures.push("isRoadmapFilename failed for ROADMAP.md")
		const resolved = resolveRoadmapWritePath("ROADMAP.md", tmp)
		if (resolved.error) failures.push(`resolveRoadmapWritePath failed: ${resolved.error}`)

		if (!targetsRoadmapFile(DietCodeDefaultTool.FILE_NEW, { path: "ROADMAP.md" })) {
			failures.push("targetsRoadmapFile should match write_to_file ROADMAP.md")
		}

		await fs.mkdir(path.join(tmp, ".dietcode"), { recursive: true })
		await fs.writeFile(
			path.join(tmp, ".dietcode", "roadmap-state.json"),
			JSON.stringify({ validation_pending: true }),
			"utf8",
		)
		await fs.writeFile(path.join(tmp, "ROADMAP.md"), "# Audit\n", "utf8")
		const blockMsg = await requireFreshCheckpointBeforeComplete(tmp)
		if (!blockMsg) failures.push("requireFreshCheckpointBeforeComplete should block when validation_pending")

		const lifecycle = await initRoadmapSession(tmp, "audit-session")
		if (!lifecycle?.brief) failures.push("initRoadmapSession should return brief")

		const stale = await service.explainStale(tmp)
		if (stale.action !== "explain_stale") failures.push("explain_stale action missing")
		if (!stale.report) failures.push("explain_stale missing report")

		if (parseRoadmapToolAction({ action: "validate" }) !== "validate") {
			failures.push("parseRoadmapToolAction failed")
		}

		await finalizeRoadmapSession(tmp, "audit-session-finalize")
	} finally {
		await fs.rm(tmp, { recursive: true, force: true })
	}
}

async function main(): Promise<number> {
	invalidateRoadmapConfigCache()
	const failures: string[] = []

	for (const rel of REQUIRED_FILES) {
		try {
			await fs.access(path.join(ROOT, rel))
		} catch {
			failures.push(`missing required file: ${rel}`)
		}
	}

	for (const hit of await scanProductionSources()) {
		failures.push(`production language audit: ${hit}`)
	}

	const slashCommandsSrc = await fs.readFile(path.join(ROOT, "src/core/slash-commands/index.ts"), "utf8")
	if (!slashCommandsSrc.includes("executeRoadmapSlashCommand")) {
		failures.push("parseSlashCommands missing executeRoadmapSlashCommand wiring")
	}
	const slashRegistry = await fs.readFile(path.join(ROOT, "src/shared/slashCommands.ts"), "utf8")
	if (!slashRegistry.includes('name: "roadmap"')) {
		failures.push("BASE_SLASH_COMMANDS missing /roadmap entry")
	}
	const extensionSrc = await fs.readFile(path.join(ROOT, "src/extension.ts"), "utf8")
	if (!extensionSrc.includes("setupRoadmapFileWatcher")) {
		failures.push("extension.ts missing ROADMAP.md file watcher")
	}

	const cfg = getRoadmapConfig()
	if (!cfg.fail_closed_completion_gates) {
		failures.push("fail_closed_completion_gates should default to true")
	}
	if (cfg.session_brief_cache_ttl_seconds <= 0) {
		failures.push("session_brief_cache_ttl_seconds should be positive")
	}

	await runIntegrationChecks(failures)

	if (failures.length > 0) {
		console.error("Roadmap audit FAILED:")
		for (const f of failures) console.error(`  - ${f}`)
		return 1
	}

	console.log("Roadmap audit passed.")
	return 0
}

main().then((code) => process.exit(code))
