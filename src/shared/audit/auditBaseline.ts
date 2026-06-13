import fs from "fs/promises"
import path from "path"
import type { HardeningGrade, TaskAuditMetadata } from "./types"

export const WORKSPACE_BASELINE_FILE = "baseline.json"
const AUDIT_ARTIFACT_DIR = ".audit"

export interface WorkspaceAuditBaseline {
	schemaVersion: 1
	updatedAt: number
	taskId?: string
	hardeningScore?: number
	hardeningGrade?: HardeningGrade
	violations?: string[]
	suppressedViolationCount?: number
}

function baselinePath(cwd: string): string {
	return path.join(cwd, AUDIT_ARTIFACT_DIR, WORKSPACE_BASELINE_FILE)
}

/** Loads workspace `.audit/baseline.json` — last passing audit for new-violations-only gates. */
export async function loadWorkspaceAuditBaseline(cwd: string): Promise<WorkspaceAuditBaseline | undefined> {
	if (!cwd?.trim()) return undefined
	try {
		const raw = await fs.readFile(baselinePath(cwd), "utf8")
		const parsed = JSON.parse(raw) as WorkspaceAuditBaseline
		if (parsed?.schemaVersion !== 1) return undefined
		return parsed
	} catch {
		return undefined
	}
}

export function baselineToAuditMetadata(baseline: WorkspaceAuditBaseline): TaskAuditMetadata {
	return {
		violations: baseline.violations ?? [],
		hardening_score: baseline.hardeningScore,
		hardening_grade: baseline.hardeningGrade,
	}
}

/** Filters violations to those not present in the workspace baseline — SonarQube "new code" pattern. */
export function filterNewViolationsSinceBaseline(
	violations: string[] | undefined,
	baseline: TaskAuditMetadata | undefined,
): string[] {
	if (!violations?.length) return []
	if (!baseline?.violations?.length) return violations
	const baselineSet = new Set(baseline.violations)
	return violations.filter((v) => !baselineSet.has(v))
}

/** Persists baseline on successful completion — used by new-violations-only quality gates. */
export async function persistWorkspaceAuditBaseline(cwd: string, metadata: TaskAuditMetadata, taskId?: string): Promise<void> {
	if (!cwd?.trim()) return
	const rootDir = path.resolve(cwd, AUDIT_ARTIFACT_DIR)
	await fs.mkdir(rootDir, { recursive: true })
	const baseline: WorkspaceAuditBaseline = {
		schemaVersion: 1,
		updatedAt: metadata.audited_at ?? Date.now(),
		taskId,
		hardeningScore: metadata.hardening_score,
		hardeningGrade: metadata.hardening_grade,
		violations: metadata.violations ?? [],
		suppressedViolationCount: metadata.suppressed_violations?.length ?? 0,
	}
	await fs.writeFile(baselinePath(cwd), `${JSON.stringify(baseline, null, 2)}\n`, "utf8")
}
