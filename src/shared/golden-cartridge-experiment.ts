export type GoldenCartridgeCondition = "control" | "skill_only" | "facade_only" | "skill_plus_facade"

export interface GoldenCartridgeExecutionRecord {
	condition: GoldenCartridgeCondition
	requirementPassed: boolean
	validationPassed?: boolean
	repositoryReads?: number
	repeatedReads?: number
	cacheReuse?: number
	commands?: number
	validationDurationMs?: number
	filesChanged?: number
	architecture?: {
		dependenciesAdded?: number
		publicInterfacesAdded?: number
		abstractionsAdded?: number
		persistedFormatsAdded?: number
	}
	evidenceComplete?: boolean
	residualUncertainty?: number
}

const ORDER: GoldenCartridgeCondition[] = ["control", "skill_only", "facade_only", "skill_plus_facade"]

export function compareGoldenCartridgeRecords(records: GoldenCartridgeExecutionRecord[]) {
	const byCondition = new Map(records.map((record) => [record.condition, record]))
	const control = byCondition.get("control")
	const measuredDelta = (value: number | undefined, baseline: number | undefined): number | undefined =>
		value === undefined || baseline === undefined ? undefined : value - baseline
	return {
		conditions: ORDER.map((condition) => {
			const record = byCondition.get(condition)
			return {
				condition,
				available: Boolean(record),
				record,
				versusControl:
					condition === "control" || !record || !control
						? undefined
						: {
								requirementResultPreserved: record.requirementPassed === control.requirementPassed,
								validationResultPreserved:
									record.validationPassed === undefined || control.validationPassed === undefined
										? undefined
										: record.validationPassed === control.validationPassed,
								repositoryReads: measuredDelta(record.repositoryReads, control.repositoryReads),
								repeatedReads: measuredDelta(record.repeatedReads, control.repeatedReads),
								cacheReuse: measuredDelta(record.cacheReuse, control.cacheReuse),
								commands: measuredDelta(record.commands, control.commands),
								validationDurationMs: measuredDelta(record.validationDurationMs, control.validationDurationMs),
								filesChanged: measuredDelta(record.filesChanged, control.filesChanged),
								evidenceComplete:
									record.evidenceComplete === undefined || control.evidenceComplete === undefined
										? undefined
										: record.evidenceComplete === control.evidenceComplete,
								residualUncertainty: measuredDelta(record.residualUncertainty, control.residualUncertainty),
								architecture: {
									dependenciesAdded: measuredDelta(
										record.architecture?.dependenciesAdded,
										control.architecture?.dependenciesAdded,
									),
									publicInterfacesAdded: measuredDelta(
										record.architecture?.publicInterfacesAdded,
										control.architecture?.publicInterfacesAdded,
									),
									abstractionsAdded: measuredDelta(
										record.architecture?.abstractionsAdded,
										control.architecture?.abstractionsAdded,
									),
									persistedFormatsAdded: measuredDelta(
										record.architecture?.persistedFormatsAdded,
										control.architecture?.persistedFormatsAdded,
									),
								},
							},
			}
		}),
		interpretation:
			"Descriptive comparison only. Recorded fixtures can show observable work and evidence differences, not causal effects.",
	}
}
