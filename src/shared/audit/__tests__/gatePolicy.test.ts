import {
	DEFAULT_INTENT_THRESHOLD_ADJUSTMENTS,
	getIntentThresholdAdjustment,
	parseIntentThresholdOverrides,
	resolveEffectiveGateThreshold,
} from "@shared/audit/gatePolicy"
import { expect } from "chai"

describe("gatePolicy", () => {
	it("raises threshold for high-risk intent classes", () => {
		expect(resolveEffectiveGateThreshold(50, "FIX")).to.equal(60)
		expect(resolveEffectiveGateThreshold(50, "TEST")).to.equal(60)
		expect(resolveEffectiveGateThreshold(50, "CREATE")).to.equal(50)
		expect(getIntentThresholdAdjustment("DELETE")).to.equal(5)
		expect(DEFAULT_INTENT_THRESHOLD_ADJUSTMENTS.FIX).to.equal(10)
	})

	it("clamps effective threshold to 0-100", () => {
		expect(resolveEffectiveGateThreshold(95, "FIX")).to.equal(100)
		expect(resolveEffectiveGateThreshold(5, "GENERAL")).to.equal(5)
	})

	it("respects intentAdjustmentsEnabled=false", () => {
		expect(resolveEffectiveGateThreshold(50, "FIX", { intentAdjustmentsEnabled: false })).to.equal(50)
	})

	it("applies custom intent threshold overrides", () => {
		const overrides = parseIntentThresholdOverrides('{"FIX": 15, "TEST": 20}')
		expect(overrides.FIX).to.equal(15)
		expect(resolveEffectiveGateThreshold(50, "FIX", { overrides })).to.equal(65)
		expect(resolveEffectiveGateThreshold(50, "TEST", { overrides })).to.equal(70)
	})

	it("returns empty overrides for invalid JSON", () => {
		expect(parseIntentThresholdOverrides("not-json")).to.deep.equal({})
	})
})
