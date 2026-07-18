import { ApiConfiguration } from "@shared/api"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ExtensionStateContextProvider, useExtensionState } from "@/context/ExtensionStateContext"
import ApiOptions from "../ApiOptions"

vi.mock("../../../context/ExtensionStateContext", async (importOriginal) => {
	const actual = await importOriginal()
	return {
		...(actual || {}),
		useExtensionState: vi.fn(() => ({
			apiConfiguration: {
				planModeApiProvider: "openrouter",
				actModeApiProvider: "openrouter",
				openRouterApiKey: "",
			},
			setApiConfiguration: vi.fn(),
			openRouterModels: {},
			planActSeparateModelsSetting: false,
			favoritedModelIds: [],
			refreshOpenRouterModels: vi.fn(),
			navigateToSettingsModelPicker: vi.fn(),
		})),
	}
})

const mockExtensionState = (apiConfiguration: Partial<ApiConfiguration>) => {
	vi.mocked(useExtensionState).mockReturnValue({
		apiConfiguration,
		setApiConfiguration: vi.fn(),
		openRouterModels: {},
		planActSeparateModelsSetting: false,
		favoritedModelIds: [],
		refreshOpenRouterModels: vi.fn(),
		navigateToSettingsModelPicker: vi.fn(),
	} as any)
}

describe("ApiOptions Component", () => {
	const mockPostMessage = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
		//@ts-expect-error - vscode is not defined in the global namespace in test environment
		global.vscode = { postMessage: mockPostMessage }
		mockExtensionState({
			planModeApiProvider: "openrouter",
			actModeApiProvider: "openrouter",
			openRouterApiKey: "",
		})
	})

	it("renders OpenRouter API Key input", () => {
		render(
			<ExtensionStateContextProvider>
				<ApiOptions currentMode="plan" showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)
		const apiKeyInput = screen.getByPlaceholderText("Enter API Key...")
		expect(apiKeyInput).toBeInTheDocument()
	})

	it("renders OpenRouter model picker", () => {
		render(
			<ExtensionStateContextProvider>
				<ApiOptions currentMode="plan" showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)
		const modelIdInput = screen.getByPlaceholderText("Search and select a model...")
		expect(modelIdInput).toBeInTheDocument()
	})

	it("renders Cerebras credentials and model options", () => {
		mockExtensionState({
			planModeApiProvider: "cerebras",
			actModeApiProvider: "cerebras",
			cerebrasApiKey: "",
		})

		render(
			<ExtensionStateContextProvider>
				<ApiOptions currentMode="plan" showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)

		expect(screen.getByText("Cerebras API Key")).toBeInTheDocument()
		expect(screen.getByText("gemma-4-31b")).toBeInTheDocument()
		expect(screen.getByText("zai-glm-4.7")).toBeInTheDocument()
	})
})
