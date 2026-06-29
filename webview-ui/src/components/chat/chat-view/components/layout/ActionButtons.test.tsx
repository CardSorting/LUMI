import type { DietCodeMessage } from "@shared/ExtensionMessage"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ChatState, MessageHandlers } from "../../types/chatTypes"
import { ActionButtons } from "./ActionButtons"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ enableCheckpointsSetting: true, checkpointManagerErrorMessage: undefined }),
}))

const task: DietCodeMessage = { ts: 1, type: "say", say: "task", text: "Update the project" }

function buildProps(executeButtonAction = vi.fn().mockResolvedValue(undefined)) {
	const chatState = {
		inputValue: "",
		selectedImages: [],
		selectedFiles: [],
		setSendingDisabled: vi.fn(),
		setInputValue: vi.fn(),
		setSelectedImages: vi.fn(),
		setSelectedFiles: vi.fn(),
	} as unknown as ChatState
	const messageHandlers = { executeButtonAction } as unknown as MessageHandlers
	return { chatState, messageHandlers, executeButtonAction }
}

describe("ActionButtons approval hierarchy", () => {
	beforeEach(() => vi.clearAllMocks())

	it("puts the safe action first and separates destructive approval", async () => {
		const user = userEvent.setup()
		const props = buildProps()
		const deletion: DietCodeMessage = {
			ts: 2,
			type: "ask",
			ask: "tool",
			text: JSON.stringify({ tool: "fileDeleted", path: "src/legacy.ts" }),
		}

		render(
			<ActionButtons
				chatState={props.chatState}
				messageHandlers={props.messageHandlers}
				messages={[task, deletion]}
				mode="act"
				task={task}
			/>,
		)

		expect(screen.getByText("Delete a workspace file")).toBeInTheDocument()
		expect(screen.getByText("src/legacy.ts")).toBeInTheDocument()
		expect(screen.getByText("High risk")).toBeInTheDocument()
		expect(screen.getByText(/Undo available/)).toBeInTheDocument()

		await user.keyboard("{Control>}{Enter}{/Control}")
		expect(props.executeButtonAction).not.toHaveBeenCalled()

		await user.click(screen.getByRole("button", { name: /Not now · Recommended/ }))
		expect(props.executeButtonAction).toHaveBeenCalledWith("reject", "", [], [])
	})

	it("supports deliberate keyboard approval for a read-only action", async () => {
		const user = userEvent.setup()
		const props = buildProps()
		const read: DietCodeMessage = {
			ts: 2,
			type: "ask",
			ask: "tool",
			text: JSON.stringify({ tool: "readFile", path: "src/config.ts" }),
		}

		render(
			<ActionButtons
				chatState={props.chatState}
				messageHandlers={props.messageHandlers}
				messages={[task, read]}
				mode="act"
				task={task}
			/>,
		)

		await user.keyboard("{Control>}{Enter}{/Control}")
		expect(props.executeButtonAction).toHaveBeenCalledWith("approve", "", [], [])
	})

	it("removes stop controls after cancellation is recorded", () => {
		const props = buildProps()
		const cancelled: DietCodeMessage = {
			ts: 2,
			type: "say",
			say: "api_req_started",
			text: JSON.stringify({ cancelReason: "user_cancelled" }),
		}

		render(
			<ActionButtons
				chatState={props.chatState}
				messageHandlers={props.messageHandlers}
				messages={[task, cancelled]}
				mode="act"
				task={task}
			/>,
		)

		expect(screen.queryByRole("button", { name: "Stop execution" })).not.toBeInTheDocument()
	})
})
