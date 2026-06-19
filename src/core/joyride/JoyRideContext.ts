/**
 * [LAYER: CORE]
 * Workspace and task fingerprint helpers for JoyRide cache invalidation.
 */

import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { getLatestGitCommitHash } from "@/utils/git"
import { createJoyRideFingerprint } from "./keys"

const LOCKFILE_CANDIDATES = [
	"package-lock.json",
	"pnpm-lock.yaml",
	"yarn.lock",
	"bun.lockb",
	"Cargo.lock",
	"go.sum",
	"poetry.lock",
]

const DEPENDENCY_MANIFEST_CANDIDATES = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "Gemfile", "tsconfig.json"]

export interface JoyRideWorkspaceSnapshot {
	workspaceFingerprint: string
	gitHead: string
	dependencyFingerprint: string
	lockfileFingerprint: string
	environmentFingerprint: string
	changedFileGeneration: number
}

export interface JoyRideTaskScope {
	taskId: string
	generation: number
	approvalBoundaryId: string
	cwd: string
	terminalMode: string
}

function hashFileStat(fullPath: string): string | undefined {
	try {
		const stat = fs.statSync(fullPath)
		return createHash("sha256").update(`${stat.size}:${stat.mtimeMs}`).digest("hex").slice(0, 16)
	} catch {
		return undefined
	}
}

function fingerprintLockfiles(cwd: string): string {
	const parts: Record<string, string> = {}
	for (const name of LOCKFILE_CANDIDATES) {
		const hash = hashFileStat(path.join(cwd, name))
		if (hash) {
			parts[name] = hash
		}
	}
	return createJoyRideFingerprint(parts)
}

function fingerprintDependencies(cwd: string): string {
	const parts: Record<string, string> = {}
	for (const name of DEPENDENCY_MANIFEST_CANDIDATES) {
		const hash = hashFileStat(path.join(cwd, name))
		if (hash) {
			parts[name] = hash
		}
	}
	return createJoyRideFingerprint(parts)
}

export function createEnvironmentFingerprint(cwd: string, terminalMode: string): string {
	return createJoyRideFingerprint({
		cwd,
		terminalMode,
		runtimeVersion: process.version,
		platform: process.platform,
		arch: process.arch,
	})
}

export async function buildJoyRideWorkspaceSnapshot(
	cwd: string,
	terminalMode: string,
	changedFileGeneration = 0,
): Promise<JoyRideWorkspaceSnapshot> {
	const gitHead = (await getLatestGitCommitHash(cwd)) ?? "no-git"
	return {
		workspaceFingerprint: createJoyRideFingerprint({ cwd, gitHead, changedFileGeneration }),
		gitHead,
		dependencyFingerprint: fingerprintDependencies(cwd),
		lockfileFingerprint: fingerprintLockfiles(cwd),
		environmentFingerprint: createEnvironmentFingerprint(cwd, terminalMode),
		changedFileGeneration,
	}
}

export function buildApprovalBoundaryId(taskId: string, apiRequestCount: number, suffix = "command"): string {
	return `task:${taskId}:${suffix}:${apiRequestCount}`
}
