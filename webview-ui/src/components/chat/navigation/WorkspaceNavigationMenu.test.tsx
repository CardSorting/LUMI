import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import "@testing-library/jest-dom"
import { CHAT_MENU_ITEMS } from "./chatNavConfig"
import { WorkspaceNavigationMenu } from "./WorkspaceNavigationMenu"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		platform: "mac",
	}),
}))

describe("WorkspaceNavigationMenu", () => {
	it("makes every destination discoverable and supports arrow-key selection", async () => {
		const user = userEvent.setup()
		const onNavigate = vi.fn()
		render(<WorkspaceNavigationMenu activePanel="chat" menuItems={CHAT_MENU_ITEMS} onNavigate={onNavigate} />)

		await user.click(screen.getByRole("button", { name: "Menu" }))
		const currentChat = await screen.findByRole("menuitem", { name: /Active chat/ })
		const pastChats = screen.getByRole("menuitem", { name: /Chat history/ })
		expect(screen.getAllByRole("menuitem")).toHaveLength(7)
		expect(currentChat).toHaveAttribute("aria-current", "page")
		await waitFor(() => expect(currentChat).toHaveFocus())

		await user.keyboard("{ArrowDown}{Enter}")
		expect(pastChats).not.toBeInTheDocument()
		expect(onNavigate).toHaveBeenCalledWith("history")
	})
})
