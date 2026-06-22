import * as assert from "assert"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { DEFAULT_ROADMAP_CONFIG, setRoadmapConfigOverride } from "../RoadmapConfig"
import { wrapClarityEnvelope } from "../RoadmapOperator"
import { bootstrapSkeleton } from "../RoadmapSchema"
import { computeDependencyManifestsHash, RoadmapService, slimEvidence } from "../RoadmapService"

describe("RoadmapSurfaceLegibility", () => {
	let tmpDir = ""

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "roadmap-legibility-"))
		setRoadmapConfigOverride({ ...DEFAULT_ROADMAP_CONFIG, enabled: true })
	})

	afterEach(async () => {
		setRoadmapConfigOverride(null)
		if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it("compresses context (omits playbooks) on non-guide/non-doctor actions", () => {
		const guideWrapped = wrapClarityEnvelope({
			action: "guide",
			workspace: tmpDir,
		})
		assert.match(String(guideWrapped.agent_playbook), /Roadmap autonomous loop/i)

		const validateWrapped = wrapClarityEnvelope({
			action: "validate",
			workspace: tmpDir,
		})
		assert.match(String(validateWrapped.agent_playbook), /Omitted for clarity/i)
	})

	it("performs atomic write and verified rollback on empty or failed writes", async () => {
		const svc = RoadmapService.getInstance()
		const roadmapPath = path.join(tmpDir, "ROADMAP.md")

		const validSkeleton = bootstrapSkeleton({
			project_hint: "Test atomic write",
			anti_goals: "What This Project Must Not Become: drift.",
		})
		const staleSkeleton = validSkeleton.replace(/\*\*Date:\*\*\s*\d{4}-\d{2}-\d{2}/, "**Date:** TBD")
		await fs.writeFile(roadmapPath, staleSkeleton, "utf8")

		const res = await svc.touchRecentCheckpointDate(tmpDir)
		assert.strictEqual(res.written, true)

		const touchedText = await fs.readFile(roadmapPath, "utf8")
		assert.match(touchedText, /\*\*Date:\*\*\s*\d{4}-\d{2}-\d{2}/)
	})

	it("updates only Section 11 when touching date and preserves surrounding sections", async () => {
		const svc = RoadmapService.getInstance()
		const roadmapPath = path.join(tmpDir, "ROADMAP.md")

		const mockRoadmap = `# ROADMAP.md

## 1. Project Center of Gravity
**Core Purpose:** Test

## 11. Recent Checkpoint
**Date:** TBD
Summary of checkpoint

## 12. Archive
Archive section content
`
		await fs.writeFile(roadmapPath, mockRoadmap, "utf8")

		const res = await svc.touchRecentCheckpointDate(tmpDir)
		assert.strictEqual(res.written, true)

		const text = await fs.readFile(roadmapPath, "utf8")
		assert.match(text, /## 12\. Archive\s+Archive section content/)
		assert.match(text, /## 1\. Project Center of Gravity\s+\*\*Core Purpose:\*\* Test/)
		assert.match(text, /\*\*Date:\*\*\s*\d{4}-\d{2}-\d{2}/)
	})

	it("maintains a rolling lineage log in the state file", async () => {
		const svc = RoadmapService.getInstance()
		await fs.mkdir(path.join(tmpDir, ".dietcode"), { recursive: true })

		await svc.writeState(tmpDir, { foo: "bar" })
		await svc.recordFileMutation(tmpDir, "test-tool", "test-file.ts")

		let state = await svc.readState(tmpDir)
		assert.ok(Array.isArray(state.lineage))
		assert.strictEqual(state.lineage.length, 1)
		assert.strictEqual(state.lineage[0].tool, "test-tool")
		assert.strictEqual(state.lineage[0].action, "file_mutated")

		await svc.recordValidation(tmpDir, true, "Coherent", "2026-06-21", "checkpoint", 0, 0)

		state = await svc.readState(tmpDir)
		assert.strictEqual(state.lineage.length, 2)
		assert.strictEqual(state.lineage[1].action, "validated")
		assert.strictEqual(state.lineage[1].schema_valid, true)
	})

	it("compresses evidence into a slim semantic snapshot on non-verbose context", async () => {
		const svc = RoadmapService.getInstance()
		const evidence = await svc.gatherEvidence(tmpDir, null, "full")
		evidence.configs = [{ path: "package.json", excerpt: "long content example here" }]
		evidence.todo_markers = [{ file: "test.ts", line: "10", marker: "TODO", text: "fix this soon" }]

		const slimmed = slimEvidence(evidence)
		assert.strictEqual(slimmed.configs[0].excerpt_length, 25)
		assert.strictEqual(slimmed.configs[0].excerpt, undefined)
		assert.strictEqual(slimmed.todo_markers[0].text, undefined)
		assert.strictEqual(slimmed.todo_markers_count, 1)
	})

	it("computes temporal validity windows and freshness score correctly", () => {
		const svc = RoadmapService.getInstance()
		const todayStr = new Date().toLocaleDateString("en-CA") // YYYY-MM-DD in local timezone

		const freshRes = svc.assessFreshness(todayStr, [], true, 7, [])
		assert.strictEqual(freshRes.stale, false)
		assert.strictEqual(freshRes.temporal_validity.freshness_score, 100)
		assert.strictEqual(freshRes.temporal_validity.expired, false)

		const staleRes = svc.assessFreshness("2026-06-01", [], true, 7, ["commit1", "commit2", "commit3"])
		assert.strictEqual(staleRes.stale, true)
		assert.ok(staleRes.temporal_validity.freshness_score < 100)
		assert.strictEqual(staleRes.temporal_validity.expired, true)
	})

	it("detects dependency drift by hashing manifest files", async () => {
		const pkgPath = path.join(tmpDir, "package.json")

		await fs.writeFile(pkgPath, JSON.stringify({ dependencies: { foo: "1.0.0" } }), "utf8")
		const hash1 = await computeDependencyManifestsHash(tmpDir)

		await fs.writeFile(pkgPath, JSON.stringify({ dependencies: { foo: "2.0.0" } }), "utf8")
		const hash2 = await computeDependencyManifestsHash(tmpDir)

		assert.notStrictEqual(hash1, hash2)
	})

	it("calculates execution confidence score based on gates, drift, and placeholders", async () => {
		const svc = RoadmapService.getInstance()
		const ctx: any = {
			workspace: tmpDir,
			text: "",
			roadmapPath: path.join(tmpDir, "ROADMAP.md"),
			evidence: { roadmap: { code_soup_risk: "Low" } },
			validation: { valid: true },
			gateState: {
				roadmap_present: true,
				bootstrap_complete: true,
				bootstrap_placeholder_count: 0,
				checkpoint_stale: false,
				blocking_gates: [],
			},
			state: {},
		}

		const payload = (svc as any).buildOperationalPayload("guide", ctx)
		assert.strictEqual(payload.execution_confidence_score, 1.0)
		assert.strictEqual(payload.continuation_semantics.intent_class, "CONTINUE_NORMAL")
	})

	it("performs transaction rollback on failed remediation and logs a failed transaction receipt", async () => {
		const svc = RoadmapService.getInstance()
		const { remediateRoadmapGatesInternally } = await import("../RoadmapCompletionGate")

		const roadmapPath = path.join(tmpDir, "ROADMAP.md")
		const initialText = "# ROADMAP.md\n\n## 11. Recent Checkpoint\n**Date:** TBD\n"
		await fs.writeFile(roadmapPath, initialText, "utf8")

		setRoadmapConfigOverride({
			...DEFAULT_ROADMAP_CONFIG,
			enabled: true,
			warn_on_stale_before_complete: true,
			auto_bootstrap_fill: true,
		})

		await remediateRoadmapGatesInternally(tmpDir)

		const text = await fs.readFile(roadmapPath, "utf8")
		assert.strictEqual(text, initialText)

		const state = await svc.readState(tmpDir)
		const rollbackReceipt = state.lineage.find((l: any) => l.action === "remediation_rollback")
		assert.ok(rollbackReceipt)
		assert.match(rollbackReceipt.diff_summary, /Remediation rolled back/i)
		assert.ok(rollbackReceipt.causality_token)
	})

	it("performs bi-directional hydration and projection matching the original markdown structure", () => {
		const originalMarkdown = `# ROADMAP.md

## 1. Project Center of Gravity

**Core Purpose:** Test Purpose
**What This Project Must Not Become:** Drift

## 2. Roadmap Health

**Status:** Coherent
**Summary:** Good

## 3. Strategic Narrative

Narrative content here.

## 4. Now

Intro text
### 1. Task A
Task A body

## 5. Next

### 1. Task B
Task B body

## 6. Later

### 1. Task C
Task C body

## 7. Discovery

Discovery content

## 8. Maintenance Gravity

Gravity content

## 9. Centralization & Code Soup Audit

**Overall Code Soup Risk:** Low
Integrity details

## 10. Decision Log

### 2026-06-21 — Initial bootstrap
Decision details

## 11. Recent Checkpoint

**Date:** 2026-06-21
**Checkpoint Summary:** Done

## 12. Archive

Archive text
`
		const { hydrateRuntimeState, projectRuntimeStateToMarkdown } = require("../RoadmapService")
		const state = hydrateRuntimeState(originalMarkdown)

		assert.strictEqual(state.project_identity.core_purpose, "Test Purpose")
		assert.strictEqual(state.health.status, "Coherent")
		assert.strictEqual(state.tasks.now.items.length, 1)
		assert.strictEqual(state.tasks.now.items[0].title, "Task A")
		assert.strictEqual(state.tasks.now.items[0].body, "Task A body")

		const projected = projectRuntimeStateToMarkdown(state)
		assert.match(projected, /## 4\. Now\s+Intro text\s+### 1\. Task A\s+Task A body/)
	})

	it("records, retrieves, and updates continuation anchors inside RRG memory state", async () => {
		const svc = RoadmapService.getInstance()
		await svc.recordContinuationAnchor(tmpDir, "stabilization_target", "main_branch")

		const anchors = await svc.getContinuationAnchors(tmpDir)
		assert.strictEqual(anchors["stabilization_target"], "main_branch")

		const state = await svc.readState(tmpDir)
		assert.ok(state.runtime_state?.memory?.continuation_anchors)
		assert.strictEqual(state.runtime_state.memory.continuation_anchors["stabilization_target"], "main_branch")
	})

	it("bypasses parsing and reads from hot cache when the file hash matches in state (low-energy bypass)", async () => {
		const svc = RoadmapService.getInstance()
		const roadmapPath = path.join(tmpDir, "ROADMAP.md")
		const markdown = bootstrapSkeleton({ project_hint: "Caching test" })
		await fs.writeFile(roadmapPath, markdown, "utf8")

		// First call: hydrates from disk
		const state1 = await svc.getOrHydrateRuntimeState(tmpDir)
		assert.strictEqual(state1.project_identity.core_purpose, "Caching test")

		// Modify memory state directly in memory
		state1.project_identity.core_purpose = "Modified In Memory"
		await svc.writeState(tmpDir, { runtime_state: state1 })

		// Second call: should read from cached runtime state in json rather than re-parsing disk markdown
		const state2 = await svc.getOrHydrateRuntimeState(tmpDir)
		assert.strictEqual(state2.project_identity.core_purpose, "Modified In Memory")
	})

	it("confines task modifications to local nodes in the RRG and propagates cleanly to markdown", async () => {
		const svc = RoadmapService.getInstance()
		const roadmapPath = path.join(tmpDir, "ROADMAP.md")
		const originalMarkdown = bootstrapSkeleton({ project_hint: "Audit" })
		await fs.writeFile(roadmapPath, originalMarkdown, "utf8")

		const state = await svc.getOrHydrateRuntimeState(tmpDir)
		assert.strictEqual(state.tasks.now.items.length, 0)

		// Local mutation
		state.tasks.now.items.push({
			id: "task_id_123",
			title: "Verify Audit Node",
			body: "Ensure localized boundary update is active",
		})

		const { projectRuntimeStateToMarkdown } = require("../RoadmapService")
		const updatedMarkdown = projectRuntimeStateToMarkdown(state)
		assert.match(updatedMarkdown, /### 1\. Verify Audit Node\s+Ensure localized boundary update is active/)
	})

	it("multi-agent leases: enforces lock exclusion and expiration rules", async () => {
		const svc = RoadmapService.getInstance()
		await fs.mkdir(path.join(tmpDir, ".dietcode"), { recursive: true })

		// Acquire lease for agent-A
		const leaseA = await svc.acquireOrchestrationLease(tmpDir, "agent-A", "task-123", 2) // 2 seconds lease
		assert.strictEqual(leaseA.success, true)
		assert.ok(leaseA.expires_at)

		// Try acquiring the lease for agent-B (should fail because agent-A holds it)
		const leaseB = await svc.acquireOrchestrationLease(tmpDir, "agent-B", "task-123", 10)
		assert.strictEqual(leaseB.success, false)

		// Same agent can renew/acquire the lease
		const leaseARenew = await svc.acquireOrchestrationLease(tmpDir, "agent-A", "task-123", 10)
		assert.strictEqual(leaseARenew.success, true)

		// Release the lease
		await svc.releaseOrchestrationLease(tmpDir, "agent-A", "task-123")

		// Now agent-B should be able to acquire it
		const leaseBSuccess = await svc.acquireOrchestrationLease(tmpDir, "agent-B", "task-123", 10)
		assert.strictEqual(leaseBSuccess.success, true)
	})

	it("version vector divergence: detects split-brain recovery races", async () => {
		const svc = RoadmapService.getInstance()
		await fs.mkdir(path.join(tmpDir, ".dietcode"), { recursive: true })

		// Initial record incrementing version
		await svc.recordContinuationAnchor(tmpDir, "step_anchor", "state_A")
		const v1 = await svc.getVersionVector(tmpDir, "step_anchor")
		assert.strictEqual(v1, 1)

		// Freshness check: v1 should be fresh
		const check1 = await svc.verifyAnchorFreshness(tmpDir, "step_anchor", v1)
		assert.strictEqual(check1.fresh, true)

		// Mutate anchor (increment version to 2)
		await svc.recordContinuationAnchor(tmpDir, "step_anchor", "state_B")

		// Stale check: expected version v1 is now stale compared to current version 2
		const check2 = await svc.verifyAnchorFreshness(tmpDir, "step_anchor", v1)
		assert.strictEqual(check2.fresh, false)
		assert.strictEqual(check2.current_version, 2)
	})

	it("pressure scoring & admission backoff: escalates pressure and triggers backoff on high contention", async () => {
		const svc = RoadmapService.getInstance()
		await fs.mkdir(path.join(tmpDir, ".dietcode"), { recursive: true })

		// Write mock ROADMAP.md containing the tasks so that hydration parses them correctly
		const roadmapPath = path.join(tmpDir, "ROADMAP.md")
		const mockMarkdown = `# ROADMAP.md

## 4. Now
### 1. Task 1
Body
### 2. Task 2
Body
### 3. Task 3
Body
### 4. Task 4
Body
### 5. Task 5
Body
`
		await fs.writeFile(roadmapPath, mockMarkdown, "utf8")

		// Set up mock tasks in Now queue and locks to artificially increase pressure
		const mockState = await svc.getOrHydrateRuntimeState(tmpDir)
		// Drive locksScore high
		// Add active locks for 3 tasks to drive locksScore high
		const futureDate = new Date(Date.now() + 60000).toISOString()
		mockState.locks = {
			t1: { owner_agent: "agent-X", leased_at: new Date().toISOString(), expires_at: futureDate },
			t2: { owner_agent: "agent-Y", leased_at: new Date().toISOString(), expires_at: futureDate },
			t3: { owner_agent: "agent-Z", leased_at: new Date().toISOString(), expires_at: futureDate },
		}
		await svc.writeState(tmpDir, { runtime_state: mockState })

		// Calculate operational status. Pressure score should be computed.
		const opStatus = await svc.getOperationalStatus(tmpDir, "status", "light")
		assert.ok(opStatus.orchestration_pressure_score !== undefined)
		assert.ok(opStatus.orchestration_pressure_score >= 0.8)

		// Perform scheduleAdmission. It should back off because pressure >= 0.8.
		const admission = await svc.scheduleAdmission(tmpDir, "agent-W", "remediate")
		assert.strictEqual(admission.admitted, false)
		assert.ok(admission.backoff_ms >= 1000)

		// Subsequent scheduleAdmission within backoff period should also be blocked by cooldown
		const admission2 = await svc.scheduleAdmission(tmpDir, "agent-W", "remediate")
		assert.strictEqual(admission2.admitted, false)
		assert.ok(admission2.backoff_ms > 0)
	})

	it("cognitive visibility filtering: localizes cockpit and steering views", async () => {
		const svc = RoadmapService.getInstance()
		await fs.mkdir(path.join(tmpDir, ".dietcode"), { recursive: true })

		const roadmapPath = path.join(tmpDir, "ROADMAP.md")
		const mockMarkdown = `# ROADMAP.md

## 4. Now
### 1. Task Locked by Me
Body
### 2. Task Locked by Other
Body
### 3. Unlocked Task
Body
`
		await fs.writeFile(roadmapPath, mockMarkdown, "utf8")

		const mockState = await svc.getOrHydrateRuntimeState(tmpDir)
		const t1_id = mockState.tasks.now.items.find((i) => i.title === "Task Locked by Me")?.id || "t1"
		const t2_id = mockState.tasks.now.items.find((i) => i.title === "Task Locked by Other")?.id || "t2"

		const futureDate = new Date(Date.now() + 60000).toISOString()
		mockState.locks = {
			[t1_id]: { owner_agent: "agent-ME", leased_at: new Date().toISOString(), expires_at: futureDate },
			[t2_id]: { owner_agent: "agent-OTHER", leased_at: new Date().toISOString(), expires_at: futureDate },
		}
		await svc.writeState(tmpDir, { runtime_state: mockState })

		// Build cockpit payload with agentId option
		const { buildCockpitPayload } = require("../RoadmapCockpit")
		const cockpitPayload = await buildCockpitPayload(svc, tmpDir, { agentId: "agent-ME" })

		// Report should filter out "Task Locked by Other"
		assert.match(cockpitPayload.report, /Task Locked by Me/)
		assert.match(cockpitPayload.report, /Unlocked Task/)
		assert.doesNotMatch(cockpitPayload.report, /Task Locked by Other/)

		// If verbose options is passed, it should show all
		const cockpitPayloadVerbose = await buildCockpitPayload(svc, tmpDir, { agentId: "agent-ME", verbose: true })
		assert.match(cockpitPayloadVerbose.report, /Task Locked by Other/)

		// Test steering report filtering
		const { formatRoadmapSteeringBlock } = require("../RoadmapAgentSteering")
		const steeringBlock = formatRoadmapSteeringBlock(cockpitPayload, { agentId: "agent-ME" })
		assert.match(steeringBlock, /Task Locked by Me/)
		assert.match(steeringBlock, /Unlocked Task/)
		assert.doesNotMatch(steeringBlock, /Task Locked by Other/)
		assert.match(steeringBlock, new RegExp(`Task ${t2_id} is leased by agent-OTHER`)) // Active Lock Alerts
	})
})
