import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createStorageContext, StorageContext } from "@shared/storage/storage-context"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import { StateManager } from "../StateManager"

type TestableStateManager = {
	isInitialized: boolean
	setApiConfiguration: StateManager["setApiConfiguration"]
	flushPendingState: StateManager["flushPendingState"]
	getApiConfiguration: StateManager["getApiConfiguration"]
	populateCache: (
		globalState: Record<string, unknown>,
		secrets: Record<string, unknown>,
		workspaceState: Record<string, unknown>,
	) => void
}

function createTestStateManager(storage: StorageContext): TestableStateManager {
	const manager = Reflect.construct(StateManager, [storage]) as unknown as TestableStateManager
	manager.isInitialized = true
	return manager
}

describe("xai-oauth StateManager persistence", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xai-oauth-state-"))
	})

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	it("survives a debounced-state flush and fresh cache hydration", async () => {
		const storage = createStorageContext({ dietcodeDir: tempDir, workspacePath: tempDir })
		const manager = createTestStateManager(storage)

		manager.setApiConfiguration({
			planModeApiProvider: "xai-oauth",
			actModeApiProvider: "xai-oauth",
			planModeApiModelId: "grok-4",
			actModeApiModelId: "grok-4",
			xaiApiKey: "xai-token",
		})
		await manager.flushPendingState()

		expect(storage.globalState.get("planModeApiProvider")).to.equal("xai-oauth")
		expect(storage.globalState.get("actModeApiProvider")).to.equal("xai-oauth")
		expect(storage.secrets.get("xaiApiKey")).to.equal("xai-token")

		const restored = createTestStateManager(storage)
		restored.populateCache(
			{
				planModeApiProvider: storage.globalState.get("planModeApiProvider"),
				actModeApiProvider: storage.globalState.get("actModeApiProvider"),
				planModeApiModelId: storage.globalState.get("planModeApiModelId"),
				actModeApiModelId: storage.globalState.get("actModeApiModelId"),
			},
			{ xaiApiKey: storage.secrets.get("xaiApiKey") },
			{},
		)

		expect(restored.getApiConfiguration()).to.include({
			planModeApiProvider: "xai-oauth",
			actModeApiProvider: "xai-oauth",
			planModeApiModelId: "grok-4",
			actModeApiModelId: "grok-4",
			xaiApiKey: "xai-token",
		})
	})
})
