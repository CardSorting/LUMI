import { ApiConfiguration } from "@shared/api"
import { ApiProvider as ProtoApiProvider, UpdateApiConfigurationPartialRequest } from "@shared/proto/dietcode/models"
import { expect } from "chai"
import { describe, it } from "mocha"
import type { IController } from "../../types"
import { updateApiConfigurationPartial } from "../updateApiConfigurationPartial"

describe("updateApiConfigurationPartial", () => {
	it("does not revert xai-oauth when a later credential update omits provider fields", async () => {
		let configuration: ApiConfiguration = {
			planModeApiProvider: "openrouter",
			actModeApiProvider: "openrouter",
		}

		const controller = {
			stateManager: {
				getApiConfiguration: () => configuration,
				setApiConfiguration: (next: ApiConfiguration) => {
					configuration = next
				},
			},
			postStateToWebview: async () => undefined,
			task: undefined,
		} as unknown as IController

		await updateApiConfigurationPartial(
			controller,
			UpdateApiConfigurationPartialRequest.create({
				apiConfiguration: { actModeApiProvider: ProtoApiProvider.XAI_OAUTH },
				updateMask: ["actModeApiProvider"],
			}),
		)

		await updateApiConfigurationPartial(
			controller,
			UpdateApiConfigurationPartialRequest.create({
				apiConfiguration: { xaiApiKey: "xai-token" },
				updateMask: ["xaiApiKey"],
			}),
		)

		expect(configuration.actModeApiProvider).to.equal("xai-oauth")
		expect(configuration.xaiApiKey).to.equal("xai-token")
	})
})
