import type { TaskAuditMetadata } from "./types"

/** Score drop threshold vs. plan baseline — mirrors CI regression gates. */
export const PLAN_REGRESSION_SCORE_DELTA = 10

export function hasAuditScoreRegression(
	baseline: TaskAuditMetadata | undefined,
	current: TaskAuditMetadata,
	delta = PLAN_REGRESSION_SCORE_DELTA,
): boolean {
	if (!baseline || !Number.isFinite(baseline.hardening_score) || !Number.isFinite(current.hardening_score)) {
		return false
	}
	return current.hardening_score! < baseline.hardening_score! - delta
}

export function buildRegressionGateSection(baseline: TaskAuditMetadata, current: TaskAuditMetadata): string {
	const baselineScore = baseline.hardening_score ?? "N/A"
	const currentScore = current.hardening_score ?? "N/A"
	return (
		`\n\n**Plan Regression Gate:** Completion score (${currentScore}) regressed more than ${PLAN_REGRESSION_SCORE_DELTA} points ` +
		`from the last plan audit (${baselineScore}). Consider re-verifying plan commitments.`
	)
}
