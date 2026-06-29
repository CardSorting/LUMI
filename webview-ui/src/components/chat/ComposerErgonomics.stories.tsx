import { HeroUIProvider } from "@heroui/react"
import { type ApiConfiguration, bedrockModels } from "@shared/api"
import type { DietCodeMessage } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { useMemo } from "react"
import { ExtensionStateContext, useExtensionState } from "@/context/ExtensionStateContext"
import ChatView from "./ChatView"

// Component that mimics App behavior in Storybook with a density container
const DensityMockApp = () => {
	return (
		<HeroUIProvider>
			<ChatView hideAnnouncement={() => {}} isHidden={false} showAnnouncement={false} showHistoryView={() => {}} />
		</HeroUIProvider>
	)
}

const ExtensionStateProviderMock = ExtensionStateContext.Provider

const meta: Meta<typeof DensityMockApp> = {
	title: "Views/ComposerErgonomics",
	component: DensityMockApp,
	parameters: {
		layout: "fullscreen",
		docs: {
			description: {
				component:
					"Focused composer writing-surface scenarios: empty, focused, typing, multiline, compact, ultra-compact, approval-collapsed, recovery, disabled, streaming.",
			},
		},
	},
}

export default meta
type Story = StoryObj<typeof DensityMockApp>

const createApiConfig = (): ApiConfiguration => ({
	actModeApiProvider: "anthropic",
	actModeApiModelId: "claude-3-5-sonnet-20241022",
	actModeOpenRouterModelInfo: {
		maxTokens: 8000,
		contextWindow: 200000,
		supportsPromptCache: true,
	},
	apiKey: "***",
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

// ─── Scenario messages ───

const taskMsg = createMessage("say", "task", "Refactor the authentication module to use async/await.")

// Empty: no messages → composer ready with placeholder
// Focused/typing/multiline: use a task + text (composer is interactive in Storybook)

const runningMessages = [taskMsg, createMessage("say", "api_req_started", JSON.stringify({ cost: null }))]

const approvalMessages = [
	taskMsg,
	createMessage("say", "text", "I'll create the new auth module. I need to write a file."),
	createMessage(
		"ask",
		"tool",
		JSON.stringify({
			tool: "newFileCreated",
			path: "src/auth/index.ts",
			content: "export const authenticate = async () => true",
		}),
	),
]

const recoveryMessages = [
	taskMsg,
	createMessage("say", "text", "I encountered an API error while processing."),
	createMessage("say", "api_req_retried", ""),
]

const completionMessages = [
	taskMsg,
	createMessage("say", "text", "I have finished refactoring the auth module."),
	createMessage("ask", "completion_result", "Completed successfully."),
]

const streamingMessages = [
	taskMsg,
	createMessage("say", "text", "Working on the refactor now…"),
	createMessage("say", "api_req_started", JSON.stringify({ cost: null })),
]

const disabledMessages = [
	taskMsg,
	createMessage("say", "text", "Recovery is in progress."),
	createMessage("ask", "api_req_failed", "The model request timed out."),
]

// ─── Stories ───

// 1. Empty composer — no task active
export const Empty_Composer: Story = {
	decorators: [createDensityStoryDecorator(480, 600, [])],
}

// 2. Focused composer — task active, ready to type
export const Focused_Ready: Story = {
	decorators: [createDensityStoryDecorator(480, 600, [taskMsg])],
}

// 3. Typing — task + assistant running (composer interactive)
export const Typing_Running: Story = {
	decorators: [createDensityStoryDecorator(480, 600, runningMessages)],
}

// 4. Multiline typing — comfortable width, taller height
export const Multiline_Comfortable: Story = {
	decorators: [createDensityStoryDecorator(480, 700, [taskMsg])],
}

// 5. Compact width (360px)
export const Compact_360: Story = {
	decorators: [createDensityStoryDecorator(360, 600, runningMessages)],
}

// 6. Ultra-compact width (320px)
export const UltraCompact_320: Story = {
	decorators: [createDensityStoryDecorator(320, 600, runningMessages)],
}

// 7. Approval-collapsed composer
export const Approval_Collapsed: Story = {
	decorators: [createDensityStoryDecorator(480, 600, approvalMessages)],
}

// 8. Recovery mode
export const Recovery_Mode: Story = {
	decorators: [createDensityStoryDecorator(480, 600, recoveryMessages)],
}

// 9. Disabled state
export const Disabled_State: Story = {
	decorators: [createDensityStoryDecorator(480, 600, disabledMessages)],
}

// 10. Streaming state
export const Streaming_State: Story = {
	decorators: [createDensityStoryDecorator(480, 600, streamingMessages)],
}

// 11. Completion mode — composer collapsed
export const Completion_Mode: Story = {
	decorators: [createDensityStoryDecorator(480, 600, completionMessages)],
}

// 12. Ultra-compact + short height
export const UltraCompact_ShortHeight: Story = {
	decorators: [createDensityStoryDecorator(320, 400, runningMessages)],
}
