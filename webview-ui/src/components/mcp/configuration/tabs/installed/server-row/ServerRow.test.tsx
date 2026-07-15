import type { McpServer } from "@shared/mcp"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import ServerRow from "./ServerRow"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mcpMarketplaceCatalog: undefined,
		autoApprovalSettings: { actions: { useMcp: false } },
		setMcpServers: vi.fn(),
		remoteConfigSettings: {},
	}),
}))

const connectedTool: McpServer = {
	name: "Docs",
	config: "{}",
	status: "connected",
	disabled: false,
	tools: [],
	resources: [],
	resourceTemplates: [],
	prompts: [],
}

describe("ServerRow navigation ergonomics", () => {
	it("exposes named controls and a keyboard-operable details disclosure", async () => {
		const user = userEvent.setup()
		render(<ServerRow hasTrashIcon isExpandable server={connectedTool} />)

		const expand = screen.getByRole("button", { name: "Expand Docs" })
		expect(screen.getByRole("button", { name: "Reconnect Docs" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Remove Docs" })).toBeInTheDocument()
		expect(screen.getByRole("switch", { name: "Disable Docs" })).toBeInTheDocument()
		expect(screen.getByRole("img", { name: "Docs is connected" })).toBeInTheDocument()

		expand.focus()
		await user.keyboard("{Enter}")
		expect(expand).toHaveAttribute("aria-expanded", "true")
		expect(screen.getByText("Response timeout")).toBeInTheDocument()
	})
})
