import { strict as assert } from "node:assert"
import { DietCodeDefaultTool } from "@shared/tools"
import { describe, it } from "mocha"
import type { ToolUse } from "../../assistant-message"
import { canonicalizeAttemptCompletionParams, refreshIgnorePolicyAfterToolMutation } from "../ToolExecutor"

describe("ToolExecutor canonicalization", () => {
	it("canonicalizes attempt_completion response into result", () => {
		const block: ToolUse = {
			type: "tool_use",
			name: DietCodeDefaultTool.ATTEMPT,
			params: {
				response: "final answer from response field",
				task_progress: "- [x] done",
			},
			partial: false,
		}

		const didCanonicalize = canonicalizeAttemptCompletionParams(block)

		assert.equal(didCanonicalize, true)
		assert.equal(block.params.result, "final answer from response field")
		assert.equal(block.params.response, "final answer from response field")
	})

	it("does not canonicalize when attempt_completion already has result", () => {
		const block: ToolUse = {
			type: "tool_use",
			name: DietCodeDefaultTool.ATTEMPT,
			params: {
				result: "already canonical",
				response: "extra text",
			},
			partial: false,
		}

		const didCanonicalize = canonicalizeAttemptCompletionParams(block)

		assert.equal(didCanonicalize, false)
		assert.equal(block.params.result, "already canonical")
	})

	it("does not canonicalize non-attempt tools", () => {
		const block: ToolUse = {
			type: "tool_use",
			name: DietCodeDefaultTool.ACT_MODE,
			params: {
				response: "act mode response",
			},
			partial: false,
		}

		const didCanonicalize = canonicalizeAttemptCompletionParams(block)

		assert.equal(didCanonicalize, false)
		assert.equal(block.params.result, undefined)
	})

	it("refreshes a newly patched ignore policy before the next read", async () => {
		const affected: string[] = []
		let broadRefreshes = 0
		const block: ToolUse = {
			type: "tool_use",
			name: DietCodeDefaultTool.APPLY_PATCH,
			params: { input: "*** Begin Patch\n*** Add File: .dietcodeignore\n+secret.txt\n*** End Patch" },
			partial: false,
		}

		await refreshIgnorePolicyAfterToolMutation(
			block,
			"/workspace",
			{
				refreshPolicy: async () => {
					broadRefreshes++
				},
				refreshPolicyIfAffected: async (target) => {
					affected.push(target)
					return true
				},
			},
			true,
		)

		assert.deepEqual(affected, ["/workspace/.dietcodeignore"])
		assert.equal(broadRefreshes, 0)
	})

	it("does not reload ignore policy after a bounded verification command", async () => {
		let refreshes = 0
		await refreshIgnorePolicyAfterToolMutation(
			{
				type: "tool_use",
				name: DietCodeDefaultTool.BASH,
				params: { command: "npm test -- --group unit" },
				partial: false,
			},
			"/workspace",
			{
				refreshPolicy: async () => {
					refreshes++
				},
				refreshPolicyIfAffected: async () => true,
			},
			false,
		)
		assert.equal(refreshes, 0)
	})
})
