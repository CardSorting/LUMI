import { moonshotDefaultModelId } from "@shared/api"
import { expect } from "chai"
import { describe, it } from "mocha"
import { getProviderDefaultModelId, getProviderModelIdKey } from "../provider-keys"

describe("Provider key mapping", () => {
	it("returns Moonshot default model ID", () => {
		expect(getProviderDefaultModelId("moonshot")).to.equal(moonshotDefaultModelId)
	})

	it("uses generic model key for Moonshot", () => {
		expect(getProviderModelIdKey("moonshot", "act")).to.equal("actModeApiModelId")
		expect(getProviderModelIdKey("moonshot", "plan")).to.equal("planModeApiModelId")
	})

	it("keeps provider-specific model key behavior for OpenRouter", () => {
		expect(getProviderModelIdKey("openrouter", "act")).to.equal("actModeOpenRouterModelId")
		expect(getProviderModelIdKey("openrouter", "plan")).to.equal("planModeOpenRouterModelId")
	})

	it("uses provider-specific model key behavior for Codemarie", () => {
		expect(getProviderModelIdKey("codemarie", "act")).to.equal("actModeCodemarieModelId")
		expect(getProviderModelIdKey("codemarie", "plan")).to.equal("planModeCodemarieModelId")
	})
})
