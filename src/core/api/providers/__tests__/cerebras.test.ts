import { expect } from "chai"
import { describe, it } from "mocha"
import { isNativeToolCallingConfig } from "@/utils/model-utils"
import { buildApiHandler } from "../../index"
import { CerebrasHandler, prepareCerebrasMessages } from "../cerebras"

describe("Cerebras provider", () => {
	it("builds a Cerebras handler with mode-specific models", () => {
		const configuration = {
			planModeApiProvider: "cerebras" as const,
			actModeApiProvider: "cerebras" as const,
			planModeApiModelId: "gemma-4-31b",
			actModeApiModelId: "gpt-oss-120b",
			cerebrasApiKey: "csk-test",
		}

		const planHandler = buildApiHandler(configuration, "plan")
		const actHandler = buildApiHandler(configuration, "act")

		expect(planHandler).to.be.instanceOf(CerebrasHandler)
		expect(actHandler).to.be.instanceOf(CerebrasHandler)
		expect(planHandler.getModel().id).to.equal("gemma-4-31b")
		expect(planHandler.getModel().info.supportsImages).to.equal(true)
		expect(actHandler.getModel().id).to.equal("gpt-oss-120b")
	})

	it("uses native tool calling when the setting is enabled", () => {
		const providerInfo = {
			providerId: "cerebras",
			model: new CerebrasHandler({ cerebrasApiKey: "csk-test" }).getModel(),
			mode: "act" as const,
		}

		expect(isNativeToolCallingConfig(providerInfo, true)).to.equal(true)
		expect(isNativeToolCallingConfig(providerInfo, false)).to.equal(false)
	})

	it("strips reasoning history and omits reasoning-only assistant messages", () => {
		const messages = prepareCerebrasMessages([
			{ role: "user", content: "hello" },
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "private trace", signature: "signature" },
					{
						type: "text",
						text: "Hello from LUMI",
						reasoning_details: [
							{
								type: "reasoning.text",
								text: "private trace",
								signature: "signature",
								format: "anthropic-claude-v1",
								index: 0,
							},
						],
					},
				],
			},
			{
				role: "assistant",
				content: [{ type: "thinking", thinking: "drop me", signature: "signature" }],
			},
			{ role: "user", content: "continue" },
		])

		expect(messages).to.have.length(3)
		expect(messages[0]).to.include({ role: "user", content: "hello" })
		expect(messages[1]).to.include({ role: "assistant", content: "Hello from LUMI" })
		expect(messages[2]).to.include({ role: "user", content: "continue" })
		expect(JSON.stringify(messages)).not.to.include("private trace")
		expect(JSON.stringify(messages)).not.to.include("drop me")
	})
})
