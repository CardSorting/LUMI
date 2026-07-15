import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { NewChatConfirmModal } from "./NewChatConfirmModal"

describe("NewChatConfirmModal", () => {
	it("starts on the safe action and supports keyboard cancellation", async () => {
		const user = userEvent.setup()
		const onCancel = vi.fn()
		render(<NewChatConfirmModal isOpen onCancel={onCancel} onConfirm={vi.fn()} />)

		expect(screen.getByRole("dialog", { name: "Start a new chat?" })).toBeInTheDocument()
		expect(screen.getByText(/return to this conversation from Past chats/i)).toBeInTheDocument()
		await waitFor(() => expect(screen.getByRole("button", { name: "Keep current chat" })).toHaveFocus())

		await user.keyboard("{Escape}")
		expect(onCancel).toHaveBeenCalledOnce()
	})

	it("prevents duplicate actions and announces a recoverable error", () => {
		render(
			<NewChatConfirmModal
				error="Couldn’t start a new chat. Please try again."
				isOpen
				isPending
				onCancel={vi.fn()}
				onConfirm={vi.fn()}
			/>,
		)

		expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t start a new chat")
		expect(screen.getByRole("button", { name: "Keep current chat" })).toBeDisabled()
		expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled()
	})
})
