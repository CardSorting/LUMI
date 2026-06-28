import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import {
	classifyBlockerSeverity,
	deriveLaneAuthorityState,
	filterAdvisoryParentSignals,
	isAdvisoryParentGateSignal,
} from "../blockerPolicy"

describe("blockerPolicy", () => {
	it("classifies parent context as advisory", () => {
		assert.equal(classifyBlockerSeverity("parent_context", "gate blocked"), "advisory")
	})

	it("classifies merge corruption as hard", () => {
		assert.equal(classifyBlockerSeverity("coordinator_merge", "split-brain lock authority detected"), "hard")
	})

	it("classifies supersession conflict as soft", () => {
		assert.equal(classifyBlockerSeverity("coordinator_merge", "unsealed retry cannot supersede prior sealed receipt"), "soft")
	})

	it("filters advisory parent gate signals", () => {
		const signals = [
			"ADVISORY: GATE: PARENT_BLOCKED (2)",
			"SIGNAL: PARENT_CRITICAL_VIOLATIONS",
			"ADVISORY: SIGNAL: PARENT_GATE_BLOCKED",
		]
		const advisory = filterAdvisoryParentSignals(signals)
		assert.equal(advisory.length, 2)
		assert.ok(!advisory.some((s) => s.includes("CRITICAL")))
		assert.ok(isAdvisoryParentGateSignal("ADVISORY: GATE: PARENT_BLOCKED (2)"))
	})

	it("derives lane authority state for partial progress", () => {
		assert.equal(
			deriveLaneAuthorityState({
				status: "running",
				advisorySignalCount: 2,
				hasPartialResult: true,
			}),
			"partial",
		)
	})
})
