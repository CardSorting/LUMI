import { expect } from "chai"
import { describe, it } from "mocha"
import { buildApiHandler } from "../index"
import { XAIOauthHandler } from "../providers/xai-oauth"

describe("xai-oauth handler selection", () => {
	it("builds the xAI OAuth handler for both modes", () => {
		const configuration = {
			planModeApiProvider: "xai-oauth" as const,
			actModeApiProvider: "xai-oauth" as const,
			planModeApiModelId: "grok-4",
			actModeApiModelId: "grok-4",
			xaiApiKey: "xai-token",
		}

		const planHandler = buildApiHandler(configuration, "plan")
		const actHandler = buildApiHandler(configuration, "act")

		expect(planHandler).to.be.instanceOf(XAIOauthHandler)
		expect(actHandler).to.be.instanceOf(XAIOauthHandler)
		expect(planHandler.getModel().id).to.equal("grok-4")
		expect(actHandler.getModel().id).to.equal("grok-4")
	})
})
