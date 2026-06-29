import { HeroUIProvider } from "@heroui/react"
import { type ApiConfiguration, bedrockModels } from "@shared/api"
import type { DietCodeMessage } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { useMemo } from "react"
import { ExtensionStateContext, useExtensionState } from "@/context/ExtensionStateContext"
import ChatView from "./ChatView"

// Component that mimics App behavior in Storybook but with a container that triggers our useDensity hook
const DensityMockApp = () => {
	return (
		<HeroUIProvider>
			<ChatView hideAnnouncement={() => {}} isHidden={false} showAnnouncement={false} showHistoryView={() => {}} />
		</HeroUIProvider>
	)
}

const ExtensionStateProviderMock = ExtensionStateContext.Provider

const meta: Meta<typeof DensityMockApp> = {
	title: "Views/SidebarDensity",
	component: DensityMockApp,
	parameters: {
		layout: "fullscreen",
		docs: {
			description: {
				component: "Tests LUMI sidebar webview responsiveness under constrained widths and heights.",
			},
		},
	},
}

export default meta
type Story = StoryObj<typeof DensityMockApp>

// Helper to create mock configuration
const createApiConfig = (): ApiConfiguration => ({
	actModeApiProvider: "anthropic",
	actModeApiModelId: "claude-3-5-sonnet-20241022",
	actModeOpenRouterModelInfo: {
		maxTokens: 8000,
		contextWindow: 200000,
		supportsPromptCache: true,
	},
	apiKey: "mock-key",
})

const mockHistory: HistoryItem[] = [
	{
		id: "task-1",
		ulid: "01HZZZ1A1B2C3D4E5F6G7H8J9K",
		ts: Date.now() - 3600000,
		task: "Test execution task",
		tokensIn: 1000,
		tokensOut: 500,
		cacheWrites: 100,
		cacheReads: 50,
		totalCost: 0.015,
		size: 5000,
	},
]

// Message factories
const createMessage = (
	type: DietCodeMessage["type"],
	sayOrAsk: DietCodeMessage["say"] | DietCodeMessage["ask"],
	text: string,
	overrides: Partial<DietCodeMessage> = {},
): DietCodeMessage => {
	const base: Partial<DietCodeMessage> = {
		ts: Date.now(),
		type,
		text,
		...overrides,
	}
	if (type === "say") {
		base.say = sayOrAsk as DietCodeMessage["say"]
	} else {
		base.ask = sayOrAsk as DietCodeMessage["ask"]
	}
	return base as DietCodeMessage
}

const createMockState = (messages: DietCodeMessage[], overrides: any = {}) => ({
	...useExtensionState(),
	useAutoCondense: true,
	version: "0.0.1-stories",
	welcomeViewCompleted: true,
	showWelcome: false,
	dietcodeMessages: messages,
	taskHistory: mockHistory,
	apiConfiguration: createApiConfig(),
	openRouterModels: bedrockModels,
	showAnnouncement: false,
	backgroundEditEnabled: false,
	...overrides,
})

const createDensityStoryDecorator =
	(width: number, height: number, messages: DietCodeMessage[], stateOverrides: any = {}) =>
	(Story: any) => {
		const mockState = useMemo(() => createMockState(messages, stateOverrides), [])
		return (
			<ExtensionStateProviderMock value={mockState}>
				<div className="w-full h-full flex justify-center items-center overflow-hidden bg-background p-4">
					<div
						data-density-container="true"
						style={{
							width: `${width}px`,
							height: `${height}px`,
							border: "1px solid var(--vscode-panel-border, #ccc)",
							borderRadius: "4px",
							overflow: "hidden",
							position: "relative",
							display: "flex",
							flexDirection: "column",
							backgroundColor: "var(--vscode-editor-background)",
							boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
						}}>
						<Story />
					</div>
				</div>
			</ExtensionStateProviderMock>
		)
	}

// Scenarios definition
const taskMsg = createMessage("say", "task", "Create a new React utility function to format currency values safely.")

const runningMessages = [taskMsg, createMessage("say", "api_req_started", JSON.stringify({ cost: null }))]

const approvalMessages = [
	taskMsg,
	createMessage("say", "text", "I'll create the currency formatting utility now. I need to run a test file creation tool."),
	createMessage(
		"ask",
		"tool",
		JSON.stringify({
			tool: "newFileCreated",
			path: "src/utils/format.ts",
			content: "export const formatCurrency = (val: number) => `$${val}`",
		}),
	),
]

const destructiveApprovalMessages = [
	taskMsg,
	createMessage("say", "text", "To clean up the old formatting code, I will delete the legacy configuration file."),
	createMessage(
		"ask",
		"tool",
		JSON.stringify({
			tool: "fileDeleted",
			path: "src/legacy/old-formatter.js",
		}),
	),
]

const recoveryMessages = [
	taskMsg,
	createMessage("say", "text", "I encountered an API error while processing the request."),
	createMessage("say", "api_req_retried", ""),
]

const cancellationMessages = [
	taskMsg,
	createMessage("say", "api_req_started", JSON.stringify({ cancelReason: "user_cancelled" })),
]

const completionMessages = [
	taskMsg,
	createMessage("say", "text", "I have finished creating and testing the currency formatting utility."),
	createMessage("ask", "completion_result", "Completed successfully."),
]

const denseTimelineMessages = [
	taskMsg,
	createMessage("say", "text", "Let's begin by checking the project structure."),
	createMessage("say", "tool", JSON.stringify({ tool: "listFilesTopLevel", path: "." })),
	createMessage("say", "text", "Found 12 files. Now checking package.json dependencies."),
	createMessage("say", "tool", JSON.stringify({ tool: "viewFile", path: "package.json" })),
	createMessage("say", "text", "Dependencies look good. Installing formatting package."),
	createMessage("say", "tool", JSON.stringify({ tool: "command", command: "npm install numbro" })),
	createMessage("say", "text", "Creating the helper utility."),
	createMessage("say", "tool", JSON.stringify({ tool: "newFileCreated", path: "src/utils/format.ts" })),
	createMessage("say", "text", "Running type check and vitest tests."),
	createMessage("say", "tool", JSON.stringify({ tool: "command", command: "npm run test" })),
	createMessage("say", "text", "All tests passed successfully!"),
	createMessage("say", "api_req_started", JSON.stringify({ cost: null })),
]

// 1. Width 320px — Running
export const Width320_Running: Story = {
	decorators: [createDensityStoryDecorator(320, 600, runningMessages)],
}

// 2. Width 320px — Approval
export const Width320_Approval: Story = {
	decorators: [createDensityStoryDecorator(320, 600, approvalMessages)],
}

// 3. Width 320px — Approval Destructive
export const Width320_ApprovalDestructive: Story = {
	decorators: [createDensityStoryDecorator(320, 600, destructiveApprovalMessages)],
}

// 4. Width 360px — Running
export const Width360_Running: Story = {
	decorators: [createDensityStoryDecorator(360, 600, runningMessages)],
}

// 5. Width 360px — Recovery
export const Width360_Recovery: Story = {
	decorators: [createDensityStoryDecorator(360, 600, recoveryMessages)],
}

// 6. Width 420px — Dense Timeline
export const Width420_DenseTimeline: Story = {
	decorators: [createDensityStoryDecorator(420, 600, denseTimelineMessages)],
}

// 7. Width 480px — Comfortable
export const Width480_Comfortable: Story = {
	decorators: [createDensityStoryDecorator(480, 600, runningMessages)],
}

// 8. Short Height (360px x 400px) — Active Approval
export const ShortHeight_ActiveApproval: Story = {
	decorators: [createDensityStoryDecorator(360, 400, approvalMessages)],
}

// 9. Short Height (360px x 400px) — Failure / Interrupted
export const ShortHeight_Failure: Story = {
	decorators: [
		createDensityStoryDecorator(360, 400, [
			taskMsg,
			createMessage("ask", "api_req_failed", "The model request timed out after 60 seconds."),
		]),
	],
}

// 10. Short Height (360px x 400px) — Completion
export const ShortHeight_Completion: Story = {
	decorators: [createDensityStoryDecorator(360, 400, completionMessages)],
}

// 11. Width 320px — Cancellation
export const Width320_Cancellation: Story = {
	decorators: [createDensityStoryDecorator(320, 600, cancellationMessages)],
}
