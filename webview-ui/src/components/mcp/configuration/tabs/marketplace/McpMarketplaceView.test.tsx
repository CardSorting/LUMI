import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import McpMarketplaceView from "./McpMarketplaceView"

const mocks = vi.hoisted(() => ({
	refreshMarketplace: vi.fn(),
	setMarketplaceCatalog: vi.fn(),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mcpServers: [],
		mcpMarketplaceCatalog: { items: [] },
		setMcpMarketplaceCatalog: mocks.setMarketplaceCatalog,
		remoteConfigSettings: {},
	}),
}))

vi.mock("@/services/grpc-client", () => ({
	McpServiceClient: {
		refreshMcpMarketplace: mocks.refreshMarketplace,
	},
}))

describe("McpMarketplaceView", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.refreshMarketplace.mockResolvedValue({ items: [] })
	})

	it("finishes loading after one catalog request and presents a plain-language empty state", async () => {
		render(<McpMarketplaceView />)

		expect(screen.getByRole("status", { name: "Loading available tools" })).toBeInTheDocument()
		expect(await screen.findByText("No tools are available right now.")).toBeInTheDocument()
		await waitFor(() => expect(mocks.refreshMarketplace).toHaveBeenCalledOnce())
		expect(mocks.setMarketplaceCatalog).toHaveBeenCalledWith({ items: [] })
	})
})
