import { expect } from "chai"
import { describe, it } from "mocha"
import { filterAllowedRemoteConfigFields, isProviderAllowed } from "../field-filter"

describe("remote-config provider filtering", () => {
	it("allows xai-oauth even when an organization allow-list only contains OpenRouter", () => {
		expect(isProviderAllowed("xai-oauth", ["openrouter"])).to.equal(true)
		expect(
			filterAllowedRemoteConfigFields({ planModeApiProvider: "xai-oauth", actModeApiProvider: "xai-oauth" }, [
				"openrouter",
			]),
		).to.deep.equal({ planModeApiProvider: "xai-oauth", actModeApiProvider: "xai-oauth" })
	})

	it("allows qwen-token-plan and zai even when an organization allow-list only contains OpenRouter", () => {
		expect(isProviderAllowed("qwen-token-plan", ["openrouter"])).to.equal(true)
		expect(isProviderAllowed("zai", ["openrouter"])).to.equal(true)
		expect(
			filterAllowedRemoteConfigFields({ planModeApiProvider: "qwen-token-plan", actModeApiProvider: "zai" }, [
				"openrouter",
			]),
		).to.deep.equal({ planModeApiProvider: "qwen-token-plan", actModeApiProvider: "zai" })
	})
})
