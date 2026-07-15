import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { WorkspaceNavigationMenu } from "./WorkspaceNavigationMenu"

describe("WorkspaceNavigationMenu", () => {
	it("makes every destination discoverable and supports arrow-key selection", async () => {
		const user = userEvent.setup()
		const onNavigate = vi.fn()
		render(<WorkspaceNavigationMenu activePanel="chat" onNavigate={onNavigate} />)

		await user.click(screen.getByRole("button", { name: "Menu" }))
		const currentChat = await screen.findByRole("menuitem", { name: /Current chat/ })
		const pastChats = screen.getByRole("menuitem", { name: /Past chats/ })
		expect(screen.getAllByRole("menuitem")).toHaveLength(5)
		expect(currentChat).toHaveAttribute("aria-current", "page")
		await waitFor(() => expect(currentChat).toHaveFocus())

		await user.keyboard("{ArrowDown}{Enter}")
		expect(pastChats).not.toBeInTheDocument()
		expect(onNavigate).toHaveBeenCalledWith("history")
	})
})
