import { strict as assert } from "node:assert"
import type { ToolUse } from "@core/assistant-message"
import { DietCodeDefaultTool } from "@shared/tools"
import { describe, it } from "mocha"
import { buildSiblingToolDependencyModel, isReadOnlyVerificationCommand } from "../SiblingToolDependency"

function tool(name: DietCodeDefaultTool, params: ToolUse["params"], callId?: string): ToolUse {
	return {
		type: "tool_use",
		name,
		params,
		partial: false,
		call_id: callId,
	}
}

describe("SiblingToolDependency", () => {
	it("classifies only bounded verification command forms as read-only", () => {
		assert.equal(isReadOnlyVerificationCommand("npm test -- --runInBand"), true)
		assert.equal(isReadOnlyVerificationCommand("npx tsc --noEmit"), true)
		assert.equal(isReadOnlyVerificationCommand("npm testevil"), false)
		assert.equal(isReadOnlyVerificationCommand("npm test && rm -rf build"), false)
		assert.equal(isReadOnlyVerificationCommand("npm install"), false)
	})

	it("keeps independent reads dependency-free", () => {
		const nodes = buildSiblingToolDependencyModel(
			[
				tool(DietCodeDefaultTool.FILE_READ, { path: "src/a.ts" }, "read-a"),
				tool(DietCodeDefaultTool.FILE_READ, { path: "src/b.ts" }, "read-b"),
			],
			"/workspace",
		)

		assert.deepEqual(
			nodes.map((node) => node.dependsOn),
			[[], []],
		)
		assert.deepEqual(
			nodes.map((node) => node.category),
			["query", "query"],
		)
		assert.ok(nodes.every((node) => node.capturePresentation))
		assert.ok(nodes.every((node) => !node.requiresCheckpoint))
	})

	it("orders overlapping writes by resource conflict", () => {
		const nodes = buildSiblingToolDependencyModel(
			[
				tool(DietCodeDefaultTool.FILE_NEW, { path: "src/shared.ts", content: "first" }, "write-a"),
				tool(DietCodeDefaultTool.FILE_EDIT, { path: "src/shared.ts", diff: "second" }, "write-b"),
			],
			"/workspace",
		)

		assert.deepEqual(nodes[1].dependsOn, [0])
		assert.deepEqual(nodes[1].dependencyEdges, [{ sequence: 0, kind: "conflict", reason: "resource-overlap" }])
		assert.ok(nodes.every((node) => node.requiresCheckpoint))
	})

	it("extracts multi-file patch targets and fences only overlapping reads", () => {
		const patch = tool(DietCodeDefaultTool.APPLY_PATCH, {
			input: [
				"*** Begin Patch",
				"*** Update File: src/a.ts",
				"@@",
				"-old",
				"+new",
				"*** Add File: src/b.ts",
				"+new",
				"*** End Patch",
			].join("\n"),
		})
		const nodes = buildSiblingToolDependencyModel(
			[
				patch,
				tool(DietCodeDefaultTool.FILE_READ, { path: "src/b.ts" }),
				tool(DietCodeDefaultTool.FILE_READ, { path: "src/c.ts" }),
			],
			"/workspace",
		)

		assert.deepEqual(nodes[1].dependsOn, [0])
		assert.deepEqual(nodes[2].dependsOn, [])
	})

	it("uses a workspace-wide fence when a mutation target is unknown", () => {
		const nodes = buildSiblingToolDependencyModel(
			[
				tool(DietCodeDefaultTool.APPLY_PATCH, { input: "malformed patch" }),
				tool(DietCodeDefaultTool.FILE_READ, { path: "src/a.ts" }),
			],
			"/workspace",
		)
		assert.deepEqual(nodes[1].dependsOn, [0])
	})

	it("recognizes explicit and result-reference prerequisites", () => {
		const producer = tool(DietCodeDefaultTool.FILE_READ, { path: "src/source.ts" }, "source-read")
		const explicit = {
			...tool(DietCodeDefaultTool.SEARCH, { path: "src", regex: "export" }, "explicit-query"),
			depends_on: ["source-read"],
		} as ToolUse & { depends_on: string[] }
		const referenced = tool(DietCodeDefaultTool.SEARCH, { path: "src", regex: "{{explicit-query}}" }, "reference-query")

		const nodes = buildSiblingToolDependencyModel([producer, explicit, referenced], "/workspace")

		assert.deepEqual(nodes[1].dependencyEdges, [{ sequence: 0, kind: "prerequisite", reason: "explicit-dependency" }])
		assert.deepEqual(nodes[2].dependencyEdges, [{ sequence: 1, kind: "prerequisite", reason: "result-reference" }])
	})

	it("does not make an external-path approval block an unrelated local read", () => {
		const nodes = buildSiblingToolDependencyModel(
			[
				tool(DietCodeDefaultTool.FILE_READ, { path: "/external/secrets.txt" }, "external-read"),
				tool(DietCodeDefaultTool.FILE_READ, { path: "src/local.ts" }, "local-read"),
			],
			"/workspace",
			{ workspaceLocalBySequence: [false, true] },
		)

		assert.deepEqual(
			nodes.map((node) => node.dependsOn),
			[[], []],
		)
		assert.equal(nodes[0].capturePresentation, false)
		assert.equal(nodes[0].requiresAssistantHistory, true)
		assert.ok(nodes[0].claims.some((claim) => claim.kind === "approval"))
		assert.equal(nodes[1].capturePresentation, true)
		assert.equal(nodes[1].requiresAssistantHistory, false)
	})

	it("marks only mutation-capable siblings as checkpoint-dependent", () => {
		const nodes = buildSiblingToolDependencyModel(
			[
				tool(DietCodeDefaultTool.FILE_READ, { path: "src/a.ts" }),
				tool(DietCodeDefaultTool.SEARCH, { path: "src", regex: "needle" }),
				tool(DietCodeDefaultTool.FILE_NEW, { path: "src/new.ts", content: "export {}" }),
				tool(DietCodeDefaultTool.BASH, { command: "npm test" }),
				tool(DietCodeDefaultTool.BASH, { command: "npm install" }),
			],
			"/workspace",
		)

		assert.deepEqual(
			nodes.map((node) => node.requiresCheckpoint),
			[false, false, true, false, true],
		)
	})
})
