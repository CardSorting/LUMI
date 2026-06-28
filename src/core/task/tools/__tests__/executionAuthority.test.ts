import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { DietCodeDefaultTool } from "@/shared/tools"
import {
	appendSessionStabilityContext,
	computeFastIoReservedSlots,
	isIoAuthorityTool,
	resolveSessionSpiderEngine,
	shouldBypassGuardForLaneIoTool,
	shouldBypassGuardForParentIoTool,
	shouldCloseBrowserBetweenTools,
	shouldDeferLaneGuardPostExecution,
	shouldDeferParentGuardPostExecution,
	shouldSkipLayerInjectionForParentIoTool,
	shouldSkipPreToolUseForLaneIoTool,
	shouldSkipPreToolUseForParentIoTool,
	shouldUseIoAuthorityReadFastPath,
} from "../executionAuthority"

describe("executionAuthority", () => {
	it("identifies parent I/O authority tools", () => {
		assert.equal(isIoAuthorityTool(DietCodeDefaultTool.FILE_READ), true)
		assert.equal(isIoAuthorityTool(DietCodeDefaultTool.BASH), false)
		assert.equal(shouldBypassGuardForParentIoTool(DietCodeDefaultTool.SEARCH), true)
	})

	it("bypasses guard for lane I/O only on non-mutating modes", () => {
		assert.equal(shouldBypassGuardForLaneIoTool("read_only", DietCodeDefaultTool.FILE_READ), true)
		assert.equal(shouldBypassGuardForLaneIoTool("mutation", DietCodeDefaultTool.FILE_READ), false)
	})

	it("uses lightweight read path for parent and lane I/O", () => {
		assert.equal(shouldUseIoAuthorityReadFastPath(DietCodeDefaultTool.FILE_READ), true)
		assert.equal(shouldUseIoAuthorityReadFastPath(DietCodeDefaultTool.FILE_READ, "mutation"), false)
	})

	it("scales bulkhead reservation with pool capacity", () => {
		assert.equal(computeFastIoReservedSlots(3), 1)
		assert.equal(computeFastIoReservedSlots(6), 2)
	})

	it("defers parent guard post-exec for mutating tools but not I/O authority", () => {
		assert.equal(shouldDeferParentGuardPostExecution(DietCodeDefaultTool.FILE_EDIT, false), true)
		assert.equal(shouldDeferParentGuardPostExecution(DietCodeDefaultTool.FILE_READ, false), false)
		assert.equal(shouldDeferParentGuardPostExecution(DietCodeDefaultTool.FILE_EDIT, true), false)
	})

	it("defers lane guard post-exec for mutating lane tools", () => {
		assert.equal(shouldDeferLaneGuardPostExecution("mutation", DietCodeDefaultTool.FILE_EDIT), true)
		assert.equal(shouldDeferLaneGuardPostExecution("read_only", DietCodeDefaultTool.FILE_READ), false)
	})

	it("skips PreToolUse for lane I/O on non-mutating lanes", () => {
		assert.equal(shouldSkipPreToolUseForLaneIoTool("read_only", DietCodeDefaultTool.SEARCH), true)
		assert.equal(shouldSkipPreToolUseForLaneIoTool("mutation", DietCodeDefaultTool.SEARCH), false)
	})

	it("skips PreToolUse for parent I/O authority tools", () => {
		assert.equal(shouldSkipPreToolUseForParentIoTool(DietCodeDefaultTool.FILE_READ, false), true)
		assert.equal(shouldSkipPreToolUseForParentIoTool(DietCodeDefaultTool.LIST_FILES, false), true)
		assert.equal(shouldSkipPreToolUseForParentIoTool(DietCodeDefaultTool.SEARCH, false), true)
		assert.equal(shouldSkipPreToolUseForParentIoTool(DietCodeDefaultTool.FILE_READ, true), false)
		assert.equal(shouldSkipPreToolUseForParentIoTool(DietCodeDefaultTool.BASH, false), false)
	})

	it("appendSessionStabilityContext returns text unchanged when node is absent", () => {
		const config = {
			cwd: "/tmp",
			isSubagentExecution: false,
			universalGuard: { engine: { getNodes: () => new Map() } },
		} as import("../types/TaskConfig").TaskConfig
		const text = "file body"
		assert.equal(appendSessionStabilityContext(config, "src/a.ts", text), text)
	})

	it("resolveSessionSpiderEngine returns guard spider when present", () => {
		const spider = { nodes: new Map() }
		const config = {
			universalGuard: { getSpiderEngine: () => spider },
		} as import("../types/TaskConfig").TaskConfig
		assert.equal(resolveSessionSpiderEngine(config), spider)
	})

	it("shouldCloseBrowserBetweenTools only when session active and tool is not browser", () => {
		assert.equal(shouldCloseBrowserBetweenTools(DietCodeDefaultTool.FILE_READ, false), false)
		assert.equal(shouldCloseBrowserBetweenTools(DietCodeDefaultTool.FILE_READ, true), true)
		assert.equal(shouldCloseBrowserBetweenTools(DietCodeDefaultTool.BROWSER, true), false)
	})

	it("shouldSkipLayerInjectionForParentIoTool on I/O authority tools", () => {
		assert.equal(shouldSkipLayerInjectionForParentIoTool(DietCodeDefaultTool.FILE_READ), true)
		assert.equal(shouldSkipLayerInjectionForParentIoTool(DietCodeDefaultTool.BASH), false)
	})
})
