#!/usr/bin/env npx tsx
/**
 * Governed lane worker CLI — process-based execution for BroccoliDB CoordinatorService.
 */
import * as fs from "node:fs/promises"
import * as path from "node:path"
import {
	acquireGovernedFileLock,
	releaseGovernedFileLock,
} from "../src/shared/governance/fileLock"

interface WorkerArgs {
	workerId: string
	prompt: string
	laneId?: string
	swarmId?: string
	workspace?: string
	outputFile?: string
	fail?: boolean
}

function parseArgs(argv: string[]): WorkerArgs {
	const args: WorkerArgs = { workerId: "worker-unknown", prompt: "" }
	for (let i = 2; i < argv.length; i++) {
		const key = argv[i]
		const value = argv[i + 1]
		if (key === "--worker-id" && value) {
			args.workerId = value
			i++
		} else if (key === "--prompt" && value) {
			args.prompt = value
			i++
		} else if (key === "--lane-id" && value) {
			args.laneId = value
			i++
		} else if (key === "--swarm-id" && value) {
			args.swarmId = value
			i++
		} else if (key === "--workspace" && value) {
			args.workspace = value
			i++
		} else if (key === "--output-file" && value) {
			args.outputFile = value
			i++
		} else if (key === "--fail") {
			args.fail = true
		}
	}
	return args
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv)
	const workspace = args.workspace || process.cwd()
	const laneId = args.laneId || `worker-lane:${args.workerId}`
	const swarmId = args.swarmId || "swarm"
	const resourceKey = `governed-lane:${swarmId}:${laneId}`
	const fencingToken = Date.now()

	console.log(`[worker_cli] Starting governed lane ${laneId} for ${args.workerId}`)
	console.log("<pulse>")

	const acquired = await acquireGovernedFileLock(workspace, resourceKey, args.workerId, fencingToken)
	if (!acquired.ok) {
		console.error(`[worker_cli] Lane claim rejected: ${acquired.error}`)
		process.exit(2)
	}

	const startedAt = Date.now()
	let exitCode = 0
	let resultText = ""
	let errorText: string | undefined

	try {
		if (args.fail) {
			throw new Error("Worker forced failure")
		}
		resultText = `Governed lane execution complete for prompt: ${args.prompt.slice(0, 200)}`
		console.log(`[worker_cli] ${resultText}`)
		console.log("<pulse>")
	} catch (error) {
		exitCode = 1
		errorText = (error as Error).message
		console.error(`[worker_cli] Execution failed: ${errorText}`)
	} finally {
		await releaseGovernedFileLock(workspace, resourceKey, args.workerId)

		const receipt = {
			schemaVersion: 1,
			workerId: args.workerId,
			laneId,
			swarmId,
			resourceKey,
			status: exitCode === 0 ? "completed" : "failed",
			prompt: args.prompt,
			result: resultText,
			error: errorText,
			startedAt,
			completedAt: Date.now(),
			evidenceCount: exitCode === 0 ? 1 : 0,
			touchedFiles: [] as string[],
			claimReleased: true,
		}

		const outputPath =
			args.outputFile || path.join(workspace, ".broccolidb", "governed", "receipts", `${args.workerId}.json`)
		await fs.mkdir(path.dirname(outputPath), { recursive: true })
		await fs.writeFile(outputPath, JSON.stringify(receipt, null, 2), "utf8")
		console.log(`[worker_cli] Receipt written: ${outputPath}`)
	}

	process.exit(exitCode)
}

main().catch((error) => {
	console.error("[worker_cli] Fatal:", error)
	process.exit(1)
})
