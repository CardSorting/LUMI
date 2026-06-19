/**
 * [LAYER: CORE]
 * Reason-code vocabulary stability contract.
 */

import { assert } from "chai"
import { JOYRIDE_FORBIDDEN_VAGUE_REASONS, JOYRIDE_REASON_CATEGORY_PREFIXES } from "../JoyRideContract"
import { JOYRIDE_REASON, type JoyRideReasonCode } from "../JoyRideReasonCodes"

describe("JoyRide reason code contract", () => {
	const allCodes = Object.values(JOYRIDE_REASON)

	it("should have unique non-empty reason codes", () => {
		const unique = new Set(allCodes)
		assert.equal(unique.size, allCodes.length)
		for (const code of allCodes) {
			assert.isString(code)
			assert.isNotEmpty(code)
		}
	})

	it("should use approved category prefixes", () => {
		for (const code of allCodes) {
			const hasPrefix = JOYRIDE_REASON_CATEGORY_PREFIXES.some((prefix) => code.startsWith(prefix))
			assert.isTrue(hasPrefix, `reason code ${code} missing approved prefix`)
		}
	})

	it("should not use vague legacy reason fragments as standalone codes", () => {
		const allowedExact = new Set(["miss.command.unknown"])
		for (const code of allCodes) {
			for (const vague of JOYRIDE_FORBIDDEN_VAGUE_REASONS) {
				if (allowedExact.has(code)) continue
				assert.notEqual(code, vague, `vague reason code: ${code}`)
			}
		}
	})

	it("should include expected hit and miss categories", () => {
		const prefixes = new Set(allCodes.map((c) => c.split(".")[0]))
		assert.include(prefixes, "hit")
		assert.include(prefixes, "miss")
		assert.include(prefixes, "stale")
		assert.include(prefixes, "reject")
	})

	it("should be assignable to JoyRideReasonCode type", () => {
		const sample: JoyRideReasonCode = JOYRIDE_REASON.HIT_COMMAND_SAFE_ALLOWLISTED
		assert.isDefined(sample)
	})
})
