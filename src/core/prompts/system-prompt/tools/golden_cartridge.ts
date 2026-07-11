import { ModelFamily } from "@/shared/prompts"
import { DietCodeDefaultTool } from "@/shared/tools"
import type { DietCodeToolSpec } from "../spec"

const VERBS = [
	"trace",
	"slice",
	"resolve_authority",
	"find_reuse",
	"compress",
	"compare_mass",
	"design_compact",
	"patch_smallest",
	"disprove",
	"measure",
	"reclaim",
	"seal",
]

const GENERIC: DietCodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id: DietCodeDefaultTool.GOLDEN_CARTRIDGE,
	name: "golden_cartridge",
	description:
		"Compact, cached compositions for critical-path discovery, decision context, authority/reuse analysis, narrow mutation, adversarial validation, cost observation, and evidence receipts. Never grants permission or completion.",
	contextRequirements: (context) => context.goldenCartridgeAvailable === true,
	parameters: [
		{
			name: "verb",
			required: true,
			type: "string",
			enum: VERBS,
			instruction:
				"trace finds a supported path; slice selects decision context; resolve_authority ranks ownership; find_reuse ranks behavior; compare_mass compares candidates; design_compact transforms representation; compress updates working context; reclaim subtracts superseded work; measure observes current cost; seal projects the handoff receipt.",
		},
		{
			name: "payload",
			required: false,
			type: "string",
			instruction:
				"Compact JSON. Common: requirement, target, evidence, refresh. patch_smallest: proposedChange/canonicalTarget/allowedFiles. disprove: proposedCommands/testFiles/knownRepositoryCommands/execute. compress: release/persistDurableMemory. seal: validationEvidence/residualRisks.",
		},
	],
}

export const golden_cartridge_variants = [GENERIC]
