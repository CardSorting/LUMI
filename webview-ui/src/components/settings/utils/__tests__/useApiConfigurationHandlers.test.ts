import { ApiProvider as ProtoApiProvider } from "@shared/proto/dietcode/models"
import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { useApiConfigurationHandlers } from "../useApiConfigurationHandlers"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: {
		updateApiConfigurationPartial: vi.fn().mockResolvedValue({}),
	},
}))

describe("useApiConfigurationHandlers", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(useExtensionState).mockReturnValue({
			planActSeparateModelsSetting: true,
		} as unknown as ReturnType<typeof useExtensionState>)
	})

	it("updates xai-oauth without sending a stale full configuration", async () => {
		const { result } = renderHook(() => useApiConfigurationHandlers())

		await act(() =>
			result.current.handleModeFieldChange({ plan: "planModeApiProvider", act: "actModeApiProvider" }, "xai-oauth", "act"),
		)

		expect(ModelsServiceClient.updateApiConfigurationPartial).toHaveBeenCalledWith(
			expect.objectContaining({
				updateMask: ["actModeApiProvider"],
				apiConfiguration: expect.objectContaining({
					actModeApiProvider: ProtoApiProvider.XAI_OAUTH,
					planModeApiProvider: undefined,
				}),
			}),
		)
	})

	it("persists the xAI credential through the partial request", async () => {
		const { result } = renderHook(() => useApiConfigurationHandlers())

		await act(() => result.current.handleFieldChange("xaiApiKey", "xai-token"))

		expect(ModelsServiceClient.updateApiConfigurationPartial).toHaveBeenCalledWith(
			expect.objectContaining({
				updateMask: ["xaiApiKey"],
				apiConfiguration: expect.objectContaining({ xaiApiKey: "xai-token" }),
			}),
		)
	})

	it("marks Cerebras credentials for immediate backend persistence", async () => {
		const { result } = renderHook(() => useApiConfigurationHandlers())

		await act(() =>
			result.current.handleFieldChange("cerebrasApiKey", "csk-test", {
				flushImmediately: true,
			}),
		)

		expect(ModelsServiceClient.updateApiConfigurationPartial).toHaveBeenCalledWith(
			expect.objectContaining({
				updateMask: ["cerebrasApiKey"],
				flushImmediately: true,
				apiConfiguration: expect.objectContaining({ cerebrasApiKey: "csk-test" }),
			}),
		)
	})

	it("updates both provider fields atomically when Plan and Act are linked", async () => {
		vi.mocked(useExtensionState).mockReturnValue({
			planActSeparateModelsSetting: false,
		} as unknown as ReturnType<typeof useExtensionState>)
		const { result } = renderHook(() => useApiConfigurationHandlers())

		await act(() =>
			result.current.handleModeFieldChange({ plan: "planModeApiProvider", act: "actModeApiProvider" }, "xai-oauth", "act"),
		)

		expect(ModelsServiceClient.updateApiConfigurationPartial).toHaveBeenCalledWith(
			expect.objectContaining({
				updateMask: ["planModeApiProvider", "actModeApiProvider"],
				apiConfiguration: expect.objectContaining({
					planModeApiProvider: ProtoApiProvider.XAI_OAUTH,
					actModeApiProvider: ProtoApiProvider.XAI_OAUTH,
				}),
			}),
		)
	})
})
