import assert from "node:assert/strict"
import { readCommandExecutionEvidence } from "@shared/command-execution-evidence"
import { EventEmitter } from "events"
import { describe, it } from "mocha"
import { CommandExecutor } from "./CommandExecutor"
import { orchestrateCommandExecution } from "./CommandOrchestrator"
import type {
	CommandExecutorCallbacks,
	ITerminalManager,
	ITerminalProcess,
	OrchestrationResult,
	TerminalCompletionDetails,
	TerminalProcessEvents,
	TerminalProcessResultPromise,
} from "./types"

class FakeTerminalProcess extends EventEmitter<TerminalProcessEvents> implements ITerminalProcess {
	isHot = false
	waitForShellIntegration = false
	private readonly promise: Promise<void>
	private resolvePromise!: () => void
	private rejectPromise!: (error: Error) => void

	constructor() {
		super()
		this.promise = new Promise<void>((resolve, reject) => {
			this.resolvePromise = resolve
			this.rejectPromise = reject
		})
	}

	continue(): void {
		this.emit("continue")
		this.resolvePromise()
	}

	getUnretrievedOutput(): string {
		return ""
	}

	getCompletionDetails(): TerminalCompletionDetails {
		return {}
	}

	complete(details?: TerminalCompletionDetails): void {
		this.emit("completed", details)
		this.emit("continue")
		this.resolvePromise()
	}

	fail(error: Error): void {
		this.emit("error", error)
		this.rejectPromise(error)
	}

	terminate(): void {
		this.complete({ exitCode: null, signal: "SIGINT" })
	}

	asResultPromise(): TerminalProcessResultPromise {
		const processWithPromise = this as unknown as FakeTerminalProcess & Partial<TerminalProcessResultPromise>
		processWithPromise.then = this.promise.then.bind(this.promise)
		processWithPromise.catch = this.promise.catch.bind(this.promise)
		processWithPromise.finally = this.promise.finally.bind(this.promise)
		return processWithPromise as TerminalProcessResultPromise
	}
}

function createCallbacks(): CommandExecutorCallbacks {
	return {
		say: async () => undefined,
		ask: async () => ({ response: "messageResponse" }),
		updateBackgroundCommandState: () => {},
		updateDietCodeMessage: async () => {},
		getDietCodeMessages: () => [],
		addToUserMessageContent: () => {},
	}
}

function createTerminalManager(): ITerminalManager {
	return {
		processOutput: (outputLines: string[]) => outputLines.join("\n"),
	} as ITerminalManager
}

describe("CommandOrchestrator exit status messaging", () => {
	it("reports non-zero exit codes as command failures", async () => {
		const process = new FakeTerminalProcess()
		const orchestrationPromise = orchestrateCommandExecution(
			process.asResultPromise(),
			createTerminalManager(),
			createCallbacks(),
			{ command: "false" },
		)

		process.complete({ exitCode: 2, signal: null })
		const result: OrchestrationResult = await orchestrationPromise

		assert.equal(result.completed, true)
		assert.equal(result.exitCode, 2)
		assert.match(result.result as string, /^Command failed with exit code 2\./)
	})

	it("reports successful command completion with explicit exit code", async () => {
		const process = new FakeTerminalProcess()
		const orchestrationPromise = orchestrateCommandExecution(
			process.asResultPromise(),
			createTerminalManager(),
			createCallbacks(),
			{ command: "echo ok" },
		)

		process.complete({ exitCode: 0, signal: null })
		const result: OrchestrationResult = await orchestrationPromise

		assert.equal(result.completed, true)
		assert.equal(result.exitCode, 0)
		assert.match(result.result as string, /^Command executed successfully \(exit code 0\)\./)
	})
})

describe("CommandExecutor structured evidence", () => {
	const executorConfig = (terminalManager: ITerminalManager) => ({
		cwd: "/workspace",
		taskId: "task",
		ulid: "ulid",
		terminalExecutionMode: "vscodeTerminal" as const,
		terminalManager,
	})
	const terminalInfo = { terminal: { show: () => {} }, id: 1, busy: false, lastCommand: "", lastActive: Date.now() }

	it("keeps the ordinary response contract while attaching actual completion metadata", async () => {
		const process = new FakeTerminalProcess()
		const manager = {
			...createTerminalManager(),
			getOrCreateTerminal: async () => terminalInfo,
			runCommand: () => process.asResultPromise(),
		} as unknown as ITerminalManager
		const executor = new CommandExecutor(executorConfig(manager), createCallbacks())
		const pending = executor.execute("npm test", undefined)
		await new Promise((resolve) => setImmediate(resolve))
		process.complete({ exitCode: 0, signal: null })
		const [rejected, response] = await pending
		assert.equal(rejected, false)
		const evidence = readCommandExecutionEvidence(response)
		assert.equal(evidence?.completed, true)
		assert.equal(evidence?.exitCode, 0)
		assert.equal(evidence?.started, true)
		assert.equal(evidence?.timedOut, false)
	})

	it("preserves signal termination and managed timeout distinctly", async () => {
		const signalProcess = new FakeTerminalProcess()
		const signalManager = {
			...createTerminalManager(),
			getOrCreateTerminal: async () => terminalInfo,
			runCommand: () => signalProcess.asResultPromise(),
		} as unknown as ITerminalManager
		const signalExecutor = new CommandExecutor(executorConfig(signalManager), createCallbacks())
		const signaled = signalExecutor.execute("npm test", undefined)
		await new Promise((resolve) => setImmediate(resolve))
		signalProcess.complete({ signal: "SIGTERM", exitCode: null })
		assert.equal(readCommandExecutionEvidence((await signaled)[1])?.signal, "SIGTERM")

		const timeoutProcess = new FakeTerminalProcess()
		const timeoutManager = {
			...createTerminalManager(),
			getOrCreateTerminal: async () => terminalInfo,
			runCommand: () => timeoutProcess.asResultPromise(),
		} as unknown as ITerminalManager
		const timeoutExecutor = new CommandExecutor(executorConfig(timeoutManager), createCallbacks())
		const timedOut = await timeoutExecutor.execute("npm test", 0.001)
		assert.equal(readCommandExecutionEvidence(timedOut[1])?.timedOut, true)
		assert.equal(readCommandExecutionEvidence(timedOut[1])?.completed, false)
	})

	it("reports active foreground work and cancels it without presentation sleep", async () => {
		const process = new FakeTerminalProcess()
		const manager = {
			...createTerminalManager(),
			getOrCreateTerminal: async () => terminalInfo,
			runCommand: () => process.asResultPromise(),
		} as unknown as ITerminalManager
		const executor = new CommandExecutor(executorConfig(manager), createCallbacks())
		const pending = executor.execute("npm test", undefined)
		await new Promise((resolve) => setImmediate(resolve))
		assert.equal(executor.hasActiveBackgroundCommand(), true)

		assert.equal(await executor.cancelBackgroundCommand(), true)
		assert.equal((await pending)[0], true)
		assert.equal(executor.hasActiveBackgroundCommand(), false)
	})
})
