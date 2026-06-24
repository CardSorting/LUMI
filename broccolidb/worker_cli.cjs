#!/usr/bin/env node
"use strict"

/**
 * Governed lane worker CLI (CJS) — avoids tsx ESM import issues on Linux CI.
 */
const { createHash } = require("node:crypto")
const fs = require("node:fs/promises")
const path = require("node:path")

const DEFAULT_STALE_MS = 600_000

function governedLockPath(workspace, resourceKey) {
	const lockDir = path.join(workspace, ".broccolidb", "governed", "locks")
	return path.join(lockDir, `${createHash("sha256").update(resourceKey).digest("hex")}.lock`)
}

async function acquireGovernedFileLock(workspace, resourceKey, ownerId, fencingToken, staleMs = DEFAULT_STALE_MS) {
	const lockPath = governedLockPath(workspace, resourceKey)
	await fs.mkdir(path.dirname(lockPath), { recursive: true })

	try {
		const handle = await fs.open(lockPath, "wx")
		const record = {
			ownerId,
			resourceKey,
			claimedAt: Date.now(),
			pid: process.pid,
			fencingToken,
		}
		await handle.writeFile(JSON.stringify(record), "utf8")
		await handle.close()
		return { ok: true }
	} catch (error) {
		if (error.code !== "EEXIST") {
			throw error
		}

		try {
			const existing = JSON.parse(await fs.readFile(lockPath, "utf8"))
			if (Date.now() - existing.claimedAt > staleMs) {
				await fs.unlink(lockPath)
				return acquireGovernedFileLock(workspace, resourceKey, ownerId, fencingToken, staleMs)
			}
			if (existing.ownerId === ownerId) {
				return { ok: true }
			}
			return {
				ok: false,
				reason: "collision",
				error: `File lock held by '${existing.ownerId}' (pid ${existing.pid}).`,
			}
		} catch {
			return { ok: false, reason: "collision", error: `File lock exists for '${resourceKey}'.` }
		}
	}
}

async function releaseGovernedFileLock(workspace, resourceKey, ownerId) {
	const lockPath = governedLockPath(workspace, resourceKey)
	try {
		const existing = JSON.parse(await fs.readFile(lockPath, "utf8"))
		if (existing.ownerId === ownerId) {
			await fs.unlink(lockPath)
		}
	} catch {
		// lock already gone
	}
}

function parseArgs(argv) {
	const args = { workerId: "worker-unknown", prompt: "" }
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

async function main() {
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
	let errorText

	try {
		if (args.fail) {
			throw new Error("Worker forced failure")
		}
		resultText = `Governed lane execution complete for prompt: ${args.prompt.slice(0, 200)}`
		console.log(`[worker_cli] ${resultText}`)
		console.log("<pulse>")
	} catch (error) {
		exitCode = 1
		errorText = error.message
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
			touchedFiles: [],
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
