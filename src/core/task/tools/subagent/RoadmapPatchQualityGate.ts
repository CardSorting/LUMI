import type { ProposedWorkspacePatch, WorkspacePatchType } from "@shared/subagent/roadmapProjection"

const COMPLETION_PATCH_TYPES = new Set<WorkspacePatchType>(["mark_complete", "reopen_item"])
const VAGUE_RATIONALE = /^(done|ok|yes|complete|finished|n\/?a|none)$/i

export interface PatchQualityContext {
	knownItemIds: Set<string>
	projectedItemIds?: string[]
	evidenceCount?: number
	transcriptArtifactPath?: string
}

export interface PatchQualityResult {
	valid: boolean
	reasons: string[]
}

function snapshotId(patch: ProposedWorkspacePatch): string {
	return patch.baseWorkspaceSnapshotId || patch.baseSnapshotId || ""
}

export function patchRequiresEvidence(type: WorkspacePatchType): boolean {
	return COMPLETION_PATCH_TYPES.has(type)
}

/** Advisory patches have a lighter quality bar. */
export function validatePatchQuality(patch: ProposedWorkspacePatch, context: PatchQualityContext): PatchQualityResult {
	if (patch.advisory || patch.type === "advisory_only") {
		const reasons: string[] = []
		if (!patch.patchId?.trim()) reasons.push("missing patchId")
		if (!snapshotId(patch)) reasons.push("missing baseWorkspaceSnapshotId")
		if (!patch.agentRoadmapId?.trim()) reasons.push("missing agentRoadmapId")
		return { valid: reasons.length === 0, reasons }
	}

	const reasons: string[] = []

	if (!patch.patchId?.trim()) {
		reasons.push("missing patchId")
	}
	if (!patch.agentRoadmapId?.trim()) {
		reasons.push("missing agentRoadmapId")
	}
	if (!snapshotId(patch)) {
		reasons.push("missing baseWorkspaceSnapshotId")
	}
	if (!patch.itemId?.trim()) {
		reasons.push("missing target roadmap item")
	}
	if (!patch.type) {
		reasons.push("missing patch type")
	}
	if (!patch.conflictPolicy) {
		reasons.push("missing conflict policy")
	}
	if (!patch.expectedTransition?.to?.trim()) {
		reasons.push("missing expected state transition")
	}

	if (patch.type !== "advisory_only" && !patch.advisory) {
		if (!patch.rationale?.trim() || patch.rationale.trim().length < 8 || VAGUE_RATIONALE.test(patch.rationale.trim())) {
			reasons.push("vague or missing rationale")
		}
		if (patch.confidence === undefined || patch.confidence < 0.5) {
			reasons.push("insufficient confidence")
		}
	}

	if (patchRequiresEvidence(patch.type) && !patch.advisory) {
		if (!patch.evidencePointer?.trim()) {
			reasons.push("completion patch missing evidence pointer")
		}
		if ((context.evidenceCount ?? 0) === 0 && !context.transcriptArtifactPath) {
			reasons.push("lane has no evidence backing completion patch")
		}
	}

	const known =
		context.knownItemIds.has(patch.itemId) || context.projectedItemIds?.includes(patch.itemId) || patch.itemId === "workspace"
	if (!known && patch.type !== "suggest_follow_up" && patch.type !== "advisory_only") {
		reasons.push(`unknown roadmap item '${patch.itemId}'`)
	}

	return { valid: reasons.length === 0, reasons }
}

export function normalizePatchSnapshotFields(patch: ProposedWorkspacePatch): ProposedWorkspacePatch {
	const base = patch.baseWorkspaceSnapshotId || patch.baseSnapshotId || ""
	return {
		...patch,
		baseWorkspaceSnapshotId: base,
		baseSnapshotId: base,
	}
}
