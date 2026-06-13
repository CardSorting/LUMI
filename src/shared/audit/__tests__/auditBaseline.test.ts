import {
	filterNewViolationsSinceBaseline,
	loadWorkspaceAuditBaseline,
	persistWorkspaceAuditBaseline,
	WORKSPACE_BASELINE_FILE,
} from "@shared/audit/auditBaseline"
import { DEFAULT_AUDIT_ARTIFACT_DIR } from "@shared/audit/auditWorkspaceArtifacts"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import { expect } from "chai"
import fs from "fs/promises"
import os from "os"
import path from "path"

describe("auditBaseline", () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "audit-baseline-"))
		await fs.mkdir(path.join(tempDir, DEFAULT_AUDIT_ARTIFACT_DIR), { recursive: true })
	})

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("filters violations to those not in baseline", () => {
		const baseline = enrichAuditMetadata({ violations: ["result_empty"] })
		const filtered = filterNewViolationsSinceBaseline(["result_empty", "missing_validation_evidence"], baseline)
		expect(filtered).to.deep.equal(["missing_validation_evidence"])
	})

	it("persists and loads workspace audit baseline", async () => {
		const metadata = enrichAuditMetadata({ violations: [] })
		await persistWorkspaceAuditBaseline(tempDir, metadata, "task-1")
		const baseline = await loadWorkspaceAuditBaseline(tempDir)
		expect(baseline?.taskId).to.equal("task-1")
		expect(baseline?.hardeningScore).to.equal(100)
		expect(await fs.stat(path.join(tempDir, DEFAULT_AUDIT_ARTIFACT_DIR, WORKSPACE_BASELINE_FILE))).to.exist
	})
})
