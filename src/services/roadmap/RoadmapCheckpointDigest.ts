/** Compact checkpoint payload for agent context — omits heavy evidence blobs. */
export function isDigestContext(context: string): boolean {
	const ctx = (context || "").trim().toLowerCase()
	return ctx === "digest" || ctx === "compact" || ctx.includes("digest") || ctx.includes("compact")
}

export function slimCheckpointPayload(payload: Record<string, unknown>): Record<string, unknown> {
	const evidence = payload.evidence as Record<string, unknown> | undefined
	const roadmap = (evidence?.roadmap || {}) as Record<string, unknown>
	const codeSoup = (evidence?.code_soup_audit || {}) as Record<string, unknown>
	const git = (evidence?.git || {}) as Record<string, unknown>

	const slimEvidence = evidence
		? {
				project_fingerprint: evidence.project_fingerprint,
				project_steering_digest: evidence.project_steering_digest,
				project_identity_line: evidence.project_identity_line,
				uncertainty: evidence.uncertainty,
				roadmap: {
					exists: roadmap.exists,
					health_status: roadmap.health_status,
					code_soup_risk: roadmap.code_soup_risk,
					sections_missing: roadmap.sections_missing,
					sections_present_count: (roadmap.sections_present as unknown[] | undefined)?.length,
					now_item_count: roadmap.now_item_count,
					recent_checkpoint_date: roadmap.recent_checkpoint_date,
				},
				git: {
					recent_commits_count: ((git.recent_commits as unknown[]) || []).length,
					branch: git.branch,
				},
				code_soup_audit: {
					overall_risk: codeSoup.overall_risk,
					issue_count: ((codeSoup.issues as unknown[]) || []).length,
				},
			}
		: undefined

	const fillPlan = payload.bootstrap_fill_plan as Record<string, unknown> | undefined
	const slimFillPlan = fillPlan
		? {
				remaining_count: fillPlan.remaining_count,
				bootstrap_complete: fillPlan.bootstrap_complete,
				agent_next_call: fillPlan.agent_next_call,
				task_count: ((fillPlan.tasks as unknown[]) || []).length,
				sample_task: ((fillPlan.tasks as Array<Record<string, unknown>>) || [])[0],
			}
		: undefined

	const {
		evidence: _fullEvidence,
		existing_roadmap_summary: _summary,
		code_soup_pre_audit: _audit,
		suggested_bootstrap: _bootstrap,
		...rest
	} = payload

	return {
		...rest,
		context_mode: "digest",
		evidence: slimEvidence,
		bootstrap_fill_plan: slimFillPlan ?? payload.bootstrap_fill_plan,
		evidence_digest_note:
			"Heavy evidence omitted in digest mode — use roadmap(action='evidence') or checkpoint without context='digest'.",
	}
}
