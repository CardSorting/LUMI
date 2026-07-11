import { strict as assert } from "node:assert"
import { extractTextFromToolResponse } from "@shared/audit/auditPostTool"
import { describe, it } from "mocha"
import {
	attachCommandExecutionEvidence,
	type CommandExecutionEvidence,
	commandOutputSummary,
	readCommandExecutionEvidence,
} from "./command-execution-evidence"

const base: CommandExecutionEvidence = {
	command: "npm test",
	approvalStatus: "approved",
	started: true,
	completed: true,
	exitCode: 0,
	timedOut: false,
	durationMs: 14,
	stdoutAvailable: true,
	stderrAvailable: false,
}

describe("command execution evidence compatibility", () => {
	it("preserves ordinary text consumption while carrying structured success evidence", () => {
		const response = attachCommandExecutionEvidence("tests passed", base)
		assert.match(extractTextFromToolResponse(response), /^tests passed/)
		assert.deepEqual(readCommandExecutionEvidence(response), base)
		assert.equal(commandOutputSummary(response), "tests passed")
	})

	it("preserves nonzero exits, denial, timeout, signal, and execution errors without inference", () => {
		const variants: CommandExecutionEvidence[] = [
			{ ...base, exitCode: 2 },
			{ ...base, approvalStatus: "denied", started: false, completed: false, exitCode: undefined },
			{ ...base, timedOut: true, completed: false, exitCode: undefined },
			{ ...base, signal: "SIGTERM", exitCode: undefined },
			{ ...base, executionError: "spawn failed", completed: false, exitCode: undefined },
		]
		for (const evidence of variants) {
			assert.deepEqual(
				readCommandExecutionEvidence(attachCommandExecutionEvidence("output", evidence)),
				JSON.parse(JSON.stringify(evidence)),
			)
		}
	})

	it("replaces prior metadata without duplicating it", () => {
		const first = attachCommandExecutionEvidence([{ type: "text", text: "output" }], base)
		const second = attachCommandExecutionEvidence(first, { ...base, exitCode: 1 })
		assert.equal(readCommandExecutionEvidence(second)?.exitCode, 1)
		assert.equal((extractTextFromToolResponse(second).match(/<command_execution_evidence>/g) ?? []).length, 1)
	})
})
