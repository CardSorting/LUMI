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

	it("accepts Gemma 4 for Cerebras and flushes it without backend debounce", async () => {
		let configuration: ApiConfiguration = {
			planModeApiProvider: "cerebras",
			actModeApiProvider: "cerebras",
		}
		let flushCount = 0

		const controller = {
			stateManager: {
				getApiConfiguration: () => configuration,
				setApiConfiguration: (next: ApiConfiguration) => {
					configuration = next
				},
				flushPendingState: async () => {
					flushCount += 1
				},
			},
			postStateToWebview: async () => undefined,
			task: undefined,
		} as unknown as IController

		await updateApiConfigurationPartial(
			controller,
			UpdateApiConfigurationPartialRequest.create({
				apiConfiguration: { planModeApiModelId: "gemma-4-31b" },
				updateMask: ["planModeApiModelId"],
			}),
		)

		expect(configuration.planModeApiModelId).to.equal("gemma-4-31b")
		expect(flushCount).to.equal(1)
	})

	it("rejects an unsupported Cerebras model before mutating configuration", async () => {
		let configuration: ApiConfiguration = {
			planModeApiProvider: "cerebras",
			actModeApiProvider: "cerebras",
		}
		let setCount = 0

		const controller = {
			stateManager: {
				getApiConfiguration: () => configuration,
				setApiConfiguration: (next: ApiConfiguration) => {
					setCount += 1
					configuration = next
				},
				flushPendingState: async () => undefined,
			},
			postStateToWebview: async () => undefined,
			task: undefined,
		} as unknown as IController

		let error: unknown
		try {
			await updateApiConfigurationPartial(
				controller,
				UpdateApiConfigurationPartialRequest.create({
					apiConfiguration: { planModeApiModelId: "not-a-cerebras-model" },
					updateMask: ["planModeApiModelId"],
				}),
			)
		} catch (caught) {
			error = caught
		}

		expect(error).to.be.instanceOf(Error)
		expect((error as Error).message).to.equal("Unsupported Cerebras model: not-a-cerebras-model")
		expect(setCount).to.equal(0)
		expect(configuration.planModeApiModelId).to.equal(undefined)
	})

	it("normalizes Cerebras credentials and honors the proto immediate-flush flag", async () => {
		let configuration: ApiConfiguration = {
			planModeApiProvider: "openrouter",
			actModeApiProvider: "openrouter",
		}
		let flushCount = 0

		const controller = {
			stateManager: {
				getApiConfiguration: () => configuration,
				setApiConfiguration: (next: ApiConfiguration) => {
					configuration = next
				},
				flushPendingState: async () => {
					flushCount += 1
				},
			},
			postStateToWebview: async () => undefined,
			task: undefined,
		} as unknown as IController

		await updateApiConfigurationPartial(
			controller,
			UpdateApiConfigurationPartialRequest.create({
				apiConfiguration: { cerebrasApiKey: "  csk-test  " },
				updateMask: ["cerebrasApiKey"],
				flushImmediately: true,
			}),
		)

		expect(configuration.cerebrasApiKey).to.equal("csk-test")
		expect(flushCount).to.equal(1)
	})

	it("rejects a malformed Cerebras credential before persistence", async () => {
		let setCount = 0
		let flushCount = 0
		const controller = {
			stateManager: {
				getApiConfiguration: () => ({ planModeApiProvider: "cerebras" as const }),
				setApiConfiguration: () => {
					setCount += 1
				},
				flushPendingState: async () => {
					flushCount += 1
				},
			},
			postStateToWebview: async () => undefined,
			task: undefined,
		} as unknown as IController

		let error: unknown
		try {
			await updateApiConfigurationPartial(
				controller,
				UpdateApiConfigurationPartialRequest.create({
					apiConfiguration: { cerebrasApiKey: "csk invalid" },
					updateMask: ["cerebrasApiKey"],
					flushImmediately: true,
				}),
			)
		} catch (caught) {
			error = caught
		}

		expect(error).to.be.instanceOf(Error)
		expect((error as Error).message).to.equal("Cerebras API key must not contain whitespace")
		expect(setCount).to.equal(0)
		expect(flushCount).to.equal(0)
	})

	it("rejects unknown fields that are not present in the backend proto", async () => {
		const controller = {
			stateManager: {
				getApiConfiguration: () => ({}),
				setApiConfiguration: () => undefined,
				flushPendingState: async () => undefined,
			},
			postStateToWebview: async () => undefined,
			task: undefined,
		} as unknown as IController

		let error: unknown
		try {
			await updateApiConfigurationPartial(
				controller,
				UpdateApiConfigurationPartialRequest.create({
					apiConfiguration: {},
					updateMask: ["unknownField"],
				}),
			)
		} catch (caught) {
			error = caught
		}

		expect(error).to.be.instanceOf(Error)
		expect((error as Error).message).to.equal("Invalid API configuration field in update_mask: unknownField")
	})
})
