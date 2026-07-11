import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { compareGoldenCartridgeRecords, type GoldenCartridgeExecutionRecord } from "./golden-cartridge-experiment"

describe("Golden Cartridge experiment comparison", () => {
	it("compares four conditions deterministically and preserves unavailable measurements", () => {
		const records: GoldenCartridgeExecutionRecord[] = [
			{ condition: "facade_only", requirementPassed: true, repositoryReads: 7, repeatedReads: 1, commands: 2 },
			{ condition: "control", requirementPassed: true, repositoryReads: 12, repeatedReads: 5, commands: 3 },
			{ condition: "skill_plus_facade", requirementPassed: true, repositoryReads: 6, repeatedReads: 0, commands: 2 },
			{ condition: "skill_only", requirementPassed: true, repositoryReads: 10, repeatedReads: 3, commands: 3 },
		]
		const first = compareGoldenCartridgeRecords(records)
		const second = compareGoldenCartridgeRecords([...records].reverse())
		assert.deepEqual(first, second)
		assert.deepEqual(
			first.conditions.map((item) => item.condition),
			["control", "skill_only", "facade_only", "skill_plus_facade"],
		)
		assert.equal(first.conditions[3].versusControl?.repositoryReads, -6)
		assert.equal(first.conditions[3].versusControl?.validationDurationMs, undefined)
		assert.match(first.interpretation, /not causal/i)
	})
})
