import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import { TaskState } from "../../../TaskState"
import { AutonomousDocumentationFinalizer } from "../../finalization/AutonomousDocumentationFinalizer"
import { FinalizationRunner } from "../../finalization/FinalizationRunner"
import type { TaskConfig } from "../../types/TaskConfig"

describe("FinalizationRunner", () => {
	let tmpDir: string
	let config: TaskConfig

	beforeEach(async () => {
		tmpDir = path.join("/tmp", `finalization-test-${Date.now()}`)
		await mkdir(tmpDir, { recursive: true })
		const taskState = new TaskState()
		taskState.engineeringVerifiedAt = Date.now()
		config = {
			taskId: "task-finalize",
			ulid: "ulid-finalize",
			cwd: tmpDir,
			taskState,
			finalizationMode: false,
			isSubagentExecution: false,
			universalGuard: {
				getSessionImpactSummary: () => "- `src/foo.ts` (1 writes, +10/-0 lines)",
				checkForensicCompliance: async () => ({ compliant: true }),
			},
			callbacks: {
				say: async () => undefined,
			},
		} as unknown as TaskConfig
	})

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true })
	})

	it("same-session finalization updates changelog", async () => {
		const runner = new FinalizationRunner(config)
		const result = await runner.run()
		result.success.should.be.true()
		const changelog = await readFile(path.join(tmpDir, ".wiki/changelog.md"), "utf-8")
		changelog.should.containEql("Session Finalization")
	})

	it("same-session finalization creates workspace-specific agent playbook artifacts", async () => {
		await mkdir(path.join(tmpDir, "src"), { recursive: true })
		await writeFile(
			path.join(tmpDir, "package.json"),
			JSON.stringify({
				name: "playbook-workspace",
				scripts: {
					"check-types": "tsc --noEmit",
					"test:unit": "mocha",
				},
				workspaces: ["packages/*"],
			}),
			"utf-8",
		)

		const runner = new FinalizationRunner(config)
		const result = await runner.run()
		result.success.should.be.true()

		result.evidenceJson?.should.be.a.String()
		const evidence = JSON.parse(result.evidenceJson ?? "{}")
		evidence.docsUpdated.should.containEql(".wiki/index.md")
		evidence.docsUpdated.should.containEql(".wiki/agent/playbook.md")
		evidence.docsUpdated.should.containEql(".wiki/agent/key-findings.md")
		evidence.docsUpdated.should.containEql(".wiki/agent/troubleshooting.md")
		evidence.docsUpdated.should.containEql(".wiki/agent/common-pitfalls.md")

		const playbook = await readFile(path.join(tmpDir, ".wiki/agent/playbook.md"), "utf-8")
		playbook.should.containEql("Agent Playbook Method")
		playbook.should.containEql("playbook-workspace")
		playbook.should.containEql("npm run check-types")
		playbook.should.containEql("packages/*")

		const index = await readFile(path.join(tmpDir, ".wiki/index.md"), "utf-8")
		index.should.containEql("agent/playbook.md")
		index.should.containEql("agent/common-pitfalls.md")
	})

	it("same-session finalization persists workspace intelligence model", async () => {
		await mkdir(path.join(tmpDir, "src/core/api"), { recursive: true })
		await mkdir(path.join(tmpDir, "src/shared"), { recursive: true })
		await mkdir(path.join(tmpDir, "webview-ui"), { recursive: true })
		await mkdir(path.join(tmpDir, "broccolidb"), { recursive: true })
		await writeFile(
			path.join(tmpDir, "package.json"),
			JSON.stringify({
				name: "intelligence-workspace",
				version: "1.2.3",
				scripts: {
					"check-types": "tsc --noEmit",
					lint: "biome check",
					"test:unit": "mocha",
				},
				workspaces: [".", "broccolidb"],
			}),
			"utf-8",
		)
		await writeFile(
			path.join(tmpDir, "src/core/api/index.ts"),
			`switch (provider) {
case "openrouter":
case "cline-pass":
	return provider
default:
	return "openrouter"
}`,
			"utf-8",
		)
		await writeFile(
			path.join(tmpDir, "src/shared/tools.ts"),
			`export enum DietCodeDefaultTool {
	FILE_READ = "read_file",
	RUN_FINALIZATION = "run_finalization",
}

export const READ_ONLY_TOOLS = [
	DietCodeDefaultTool.FILE_READ,
] as const
`,
			"utf-8",
		)
		for (const docName of ["AGENT_PLAYBOOK.md", "WIKI.md", "TROUBLESHOOTING.md", "DECISIONS.md", "HANDOFF.md"]) {
			await writeFile(path.join(tmpDir, docName), `# ${docName}\n`, "utf-8")
		}

		// Write a seed diagnostic warning entry to verify NDJSON parsing and markdown rendering
		const seedEntry = {
			severity: "warning" as const,
			code: "TEST_SEED",
			message: "Pre-existing test warning",
			timestamp: new Date().toISOString(),
			source: "TestFramework",
			recoveryHints: ["Verify system operation"],
		}
		await mkdir(path.join(tmpDir, ".wiki/intelligence"), { recursive: true })
		await writeFile(path.join(tmpDir, ".wiki/intelligence/diagnostics.jsonl"), `${JSON.stringify(seedEntry)}\n`, "utf-8")

		const runner = new FinalizationRunner(config)
		const result = await runner.run()
		result.success.should.be.true()

		result.evidenceJson?.should.be.a.String()
		const evidence = JSON.parse(result.evidenceJson ?? "{}")
		evidence.workspaceIntelligenceUpdated.should.be.true()
		evidence.workspaceIntelligenceArtifacts.should.containEql(".wiki/intelligence/workspace-intelligence.json")
		evidence.workspaceKnowledgeCategories.permanent.should.be.above(0)
		evidence.docsUpdated.should.containEql(".wiki/intelligence/workspace-intelligence.md")

		const model = JSON.parse(await readFile(path.join(tmpDir, ".wiki/intelligence/workspace-intelligence.json"), "utf-8"))
		model.schemaVersion.should.equal(2)
		model.sourceSnapshot.packageName.should.equal("intelligence-workspace")
		model.sourceSnapshot.providerKeys.should.containEql("cline-pass")
		model.categories.permanent
			.map((signal: { title: string }) => signal.title)
			.should.containEql("Workspace package identity")
		model.categories.predictive
			.map((signal: { title: string }) => signal.title)
			.should.containEql("Cross-surface validation risk")

		const markdown = await readFile(path.join(tmpDir, ".wiki/intelligence/workspace-intelligence.md"), "utf-8")
		markdown.should.containEql("Workspace Intelligence:")
		markdown.should.containEql("intelligence-workspace")
		markdown.should.containEql("Workspace Knowledge Health: healthy")
		markdown.should.containEql("📋 Recent Knowledge System Diagnostics")
	})

	it("finalization is idempotent on replay", async () => {
		const runner = new FinalizationRunner(config)
		await runner.run()
		const second = await runner.run()
		second.success.should.be.true()
		second.message.should.match(/idempotent/i)
	})

	it("sealed receipt emitted without attempt_completion", async () => {
		const runner = new FinalizationRunner(config)
		await runner.run()
		const sealed = await runner.sealSession("done")
		sealed.success.should.be.true()
		sealed.receiptJson?.should.containEql("completed_without_retry_completion")
		sealed.receiptJson?.should.containEql("continuityMarker")
		sealed.receiptJson?.should.containEql("lifecycleTransitionHistory")
		config.taskState.completionLifecycleState?.should.equal("completed_without_retry_completion")
	})

	it("rejects seal without finalization evidence", async () => {
		const runner = new FinalizationRunner(config)
		const sealed = await runner.sealSession("done")
		sealed.success.should.be.false()
		sealed.message.should.match(/finalization/i)
	})

	it("validate rejects success without artifacts", async () => {
		const finalizer = new AutonomousDocumentationFinalizer(config)
		const validation = await finalizer.validate({
			finalizationRunId: "x",
			status: "passed",
			docsUpdated: [],
			ledgerStamped: false,
			roadmapValidated: false,
			schemaValidationPassed: false,
			artifactPaths: [],
		})
		validation.valid.should.be.false()
	})

	it("finalized task updates intelligence and a later task can read it", async () => {
		await mkdir(path.join(tmpDir, "src"), { recursive: true })
		await writeFile(
			path.join(tmpDir, "package.json"),
			JSON.stringify({
				name: "test-workspace-continuity",
				version: "3.4.5",
				scripts: {
					"check-types": "tsc --noEmit",
				},
			}),
			"utf-8",
		)
		await writeFile(
			path.join(tmpDir, "DECISIONS.md"),
			`# Decisions\n\n## ADR-001: Standard decision\n**Status:** Approved\n`,
			"utf-8",
		)

		const firstRunner = new FinalizationRunner(config)
		const firstResult = await firstRunner.run()
		firstResult.success.should.be.true()

		const intelligenceFile = path.join(tmpDir, ".wiki/intelligence/workspace-intelligence.json")
		const model = JSON.parse(await readFile(intelligenceFile, "utf-8"))
		model.schemaVersion.should.equal(2)
		model.facts.should.be.an.Array()

		const stabilityFacts = model.facts.filter((f: { type: string }) => f.type === "subsystem_stability")
		stabilityFacts.map((f: { value: { path: string } }) => f.value.path).should.containEql("src/")
		stabilityFacts.map((f: { value: { path: string } }) => f.value.path).should.containEql(".wiki/")

		const adrFacts = model.facts.filter((f: { type: string }) => f.type === "architecture_decision")
		adrFacts
			.map((f: { value: unknown }) => f.value)
			.should.deepEqual([{ id: "ADR-001", title: "Standard decision", status: "Approved" }])

		// Verify provenance trail
		const srcVolatileFact = stabilityFacts.find((f: { value: { path: string } }) => f.value.path === "src/")
		srcVolatileFact.should.not.be.undefined()
		srcVolatileFact.provenance[0].type.should.equal("file_change")
		srcVolatileFact.provenance[0].path.should.equal("src/foo.ts")
		srcVolatileFact.provenance[0].runId.should.be.a.String()

		const { WorkspaceIntelligenceStore } = await import("@core/workspace-intelligence")
		const { WorkspaceIntelligenceReader } = await import("@core/workspace-intelligence")

		const store = new WorkspaceIntelligenceStore(tmpDir)
		const loadedModel = await store.readModel()
		if (!loadedModel) {
			throw new Error("loadedModel is undefined")
		}

		const reader = new WorkspaceIntelligenceReader(loadedModel, tmpDir)
		reader.getVolatileSubsystems().should.containEql("src/")
		reader.getStableSubsystems().should.containEql(".wiki/")
		reader
			.getRecentArchitectureDecisions()
			.should.deepEqual([{ id: "ADR-001", title: "Standard decision", status: "Approved" }])

		// Verify Health Diagnostics
		const health = reader.getKnowledgeHealth()
		health.status.should.equal("healthy")
		health.recentDiagnostics.length.should.be.greaterThan(0)
		health.recentDiagnostics[0].severity.should.equal("info")

		// Verify Query APIs
		reader.getSubsystemHealth("src/").status.should.equal("volatile")
		reader.getSubsystemHealth(".wiki/").status.should.equal("stable")
		reader.getSubsystemHealth("invalid-surface/").status.should.equal("unknown")
		reader.getMostVolatileAreas()[0].path.should.equal("src/")
		reader.getRecentArchitectureChanges()[0].id.should.equal("ADR-001")
		reader.getHandoffSummary().facts.should.containEql("Active package version: 3.4.5")

		// Verify new Query API lifecycle/provenance filters
		const factId = `fact-subsystem-src-stability`
		const explained = reader.explainFact(factId)
		if (!explained) {
			throw new Error("explained fact is undefined")
		}
		explained.type.should.equal("subsystem_stability")
		explained.lifecycle.should.equal("active")

		const runIdFacts = reader.getFactsByProvenance(model.finalizationRunId)
		runIdFacts.length.should.be.greaterThan(0)

		// Verify Compact Summary discoverability
		const summary = reader.getCompactSummary()
		summary.should.containEql("Volatile Subsystems: src/")
		summary.should.containEql("Stable Subsystems: .wiki/")
		summary.should.containEql("Recent Decisions: ADR-001 (Approved)")
		summary.should.containEql("Handoff-Relevant Facts: Active package name: test-workspace-continuity")
		summary.should.containEql("explainFact(factId)")

		// Test lifecycle transitions: manually push a conflicting status and resolve
		const modifiedFacts = [...loadedModel.facts]
		// Simulating superseding
		const prevStability = modifiedFacts.find((f) => f.id === "fact-subsystem-src-stability")
		if (prevStability) {
			prevStability.lifecycle = "superseded"
		}
		modifiedFacts.push({
			id: "fact-subsystem-src-stability",
			type: "subsystem_stability",
			value: { path: "src/", status: "stable" },
			confidence: "confirmed",
			provenance: [{ type: "test_run", description: "Resolved volatile state", timestamp: "2026" }],
			lifecycle: "active",
			lastUpdated: "2026",
		})

		const updatedReader = new WorkspaceIntelligenceReader({
			...loadedModel,
			facts: modifiedFacts,
		})
		updatedReader.getStableSubsystems().should.containEql("src/")
		updatedReader.getVolatileSubsystems().should.not.containEql("src/")

		// Test schema migration path (Version 1 -> Version 2)
		const v1Model = {
			schemaVersion: 1,
			workspaceName: "v1-migration-test",
			workspaceRoot: ".",
			generatedAt: "2026-07-09T00:00:00Z",
			taskId: "task-v1",
			finalizationRunId: "run-v1",
			sourceSnapshot: loadedModel.sourceSnapshot,
			categories: loadedModel.categories,
			driftFindings: [],
			assumptions: [],
			knownUnknowns: [],
			highRiskSurfaces: [],
			metaReflection: loadedModel.metaReflection,
			stableSubsystems: [".wiki/"],
			volatileSubsystems: ["src/"],
			recentArchitectureDecisions: [{ id: "ADR-002", title: "Legacy ADR", status: "Accepted" }],
		}

		const v1StorePath = path.join(tmpDir, ".wiki/intelligence/workspace-intelligence.json")
		await writeFile(v1StorePath, JSON.stringify(v1Model, null, 2), "utf-8")
		const migratedModel = await store.readModel()
		if (!migratedModel) {
			throw new Error("migratedModel is undefined")
		}
		migratedModel.schemaVersion.should.equal(2)
		migratedModel.facts.should.be.an.Array()

		const migratedReader = new WorkspaceIntelligenceReader(migratedModel)
		migratedReader.getStableSubsystems().should.containEql(".wiki/")
		migratedReader.getVolatileSubsystems().should.containEql("src/")
		migratedReader
			.getRecentArchitectureDecisions()
			.should.deepEqual([{ id: "ADR-002", title: "Legacy ADR", status: "Accepted" }])
	})

	it("recovers gracefully from corrupted intelligence JSON files and logs diagnostics", async () => {
		const store = new (await import("@core/workspace-intelligence")).WorkspaceIntelligenceStore(tmpDir)
		await mkdir(path.join(tmpDir, ".wiki/intelligence"), { recursive: true })
		await writeFile(
			path.join(tmpDir, ".wiki/intelligence/workspace-intelligence.json"),
			"{ corrupted json ... this is invalid }",
			"utf-8",
		)
		const model = await store.readModel()
		// Should parse as undefined without throwing
		;(model === undefined).should.be.true()

		// Check that the error was logged in diagnostics.jsonl
		const logs = await readFile(path.join(tmpDir, ".wiki/intelligence/diagnostics.jsonl"), "utf-8")
		const parsed = JSON.parse(logs.trim())
		parsed.severity.should.equal("warning")
		parsed.code.should.equal("PARSE_ERROR")
		parsed.source.should.equal("WorkspaceIntelligenceStore.readModel")
	})

	it("merges and deduplicates facts with the same ID and audits incomplete provenance", async () => {
		const { mergeAndLifecycleManageFacts } = await import("@core/workspace-intelligence/WorkspaceIntelligenceEngine")

		const currentFacts = [
			{
				id: "fact-dup",
				type: "handoff_fact" as const,
				value: { fact: "Duplicate fact version 1" },
				confidence: "confirmed" as const,
				provenance: [{ type: "test_run" as const, description: "First occurrence", timestamp: "2026" }],
				lifecycle: "active" as const,
				lastUpdated: "2026",
			},
			{
				id: "fact-dup",
				type: "handoff_fact" as const,
				value: { fact: "Duplicate fact version 2" },
				confidence: "confirmed" as const,
				provenance: [{ type: "test_run" as const, description: "Second occurrence", timestamp: "2026" }],
				lifecycle: "active" as const,
				lastUpdated: "2026",
			},
			{
				id: "fact-incomplete",
				type: "handoff_fact" as const,
				value: { fact: "Incomplete provenance fact" },
				confidence: "confirmed" as const,
				provenance: [{ type: "test_run" as const, description: "", timestamp: "2026" }], // missing description!
				lifecycle: "active" as const,
				lastUpdated: "2026",
			},
		]

		const previousFacts = [
			{
				id: "fact-dup",
				type: "handoff_fact" as const,
				value: { fact: "Historical duplicate" },
				confidence: "confirmed" as const,
				provenance: [{ type: "test_run" as const, description: "Historical version", timestamp: "2026" }],
				lifecycle: "active" as const,
				lastUpdated: "2026",
			},
		]

		const merged = mergeAndLifecycleManageFacts(currentFacts, previousFacts, {
			taskId: "task-test",
			finalizationRunId: "run-test",
			timestamp: "2026-07-09T00:00:00Z",
			impactSummary: "",
		})

		merged.filter((f) => f.id === "fact-dup").length.should.equal(1)
		const dupFact = merged.find((f) => f.id === "fact-dup")
		if (!dupFact) throw new Error("dupFact is undefined")
		dupFact.provenance.length.should.equal(2)
		dupFact.provenance[0].description.should.equal("First occurrence")
		dupFact.provenance[1].description.should.equal("Second occurrence")

		const incompleteFact = merged.find((f) => f.id === "fact-incomplete")
		if (!incompleteFact) throw new Error("incompleteFact is undefined")
		incompleteFact.confidence.should.equal("needs_verification")
	})

	it("finalizer succeeds even if the WorkspaceIntelligenceEngine throws a file-write error", async () => {
		const { WorkspaceIntelligenceStore } = await import("@core/workspace-intelligence")
		const originalWriteModel = WorkspaceIntelligenceStore.prototype.writeModel
		WorkspaceIntelligenceStore.prototype.writeModel = async () => {
			throw new Error("Disk is full / read-only filesystem")
		}

		try {
			await mkdir(path.join(tmpDir, "src"), { recursive: true })
			await writeFile(
				path.join(tmpDir, "package.json"),
				JSON.stringify({
					name: "disk-full-workspace",
					version: "1.0.0",
					scripts: { "check-types": "tsc --noEmit" },
				}),
				"utf-8",
			)
			for (const docName of ["AGENT_PLAYBOOK.md", "WIKI.md", "TROUBLESHOOTING.md", "DECISIONS.md", "HANDOFF.md"]) {
				await writeFile(path.join(tmpDir, docName), `# ${docName}\n`, "utf-8")
			}

			const runner = new FinalizationRunner(config)
			const result = await runner.run()

			result.success.should.be.true()
			const evidence = JSON.parse(result.evidenceJson ?? "{}")
			evidence.workspaceIntelligenceUpdated.should.be.false()

			const { WorkspaceIntelligenceReader } = await import("@core/workspace-intelligence")
			const failedReader = new WorkspaceIntelligenceReader({} as any, tmpDir)
			const healthStatus = failedReader.getKnowledgeHealth()
			healthStatus.status.should.equal("degraded")
			healthStatus.lastDegradedReason!.should.containEql("Disk is full")
			healthStatus.recoveryHints.should.containEql("Disk space is full. Free up some space or clean up directory files.")

			const logs = await readFile(path.join(tmpDir, ".wiki/intelligence/diagnostics.jsonl"), "utf-8")
			logs.should.containEql("failed to write model files")
			logs.should.containEql("WRITE_ERROR")
		} finally {
			WorkspaceIntelligenceStore.prototype.writeModel = originalWriteModel
		}
	})
})
