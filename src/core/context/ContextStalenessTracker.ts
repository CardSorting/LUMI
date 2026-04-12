import * as fs from "fs"
import * as path from "path"

export interface ContextEntry {
	path: string
	lastReadTimestamp: number
	lastEditTimestamp: number
	signature: string
	stale: boolean
}

/**
 * ContextStalenessTracker: Ensures "Cognitive Freshness".
 * Keeps track of which files the agent has read and warns if they have been
 * modified externally or by other tool calls, rendering the current context "Stale".
 */
export class ContextStalenessTracker {
	private contextMap: Map<string, ContextEntry> = new Map()

	constructor(private cwd: string) {}

	/**
	 * Records that a file has been read into context.
	 */
	public async recordRead(filePath: string, content: string) {
		const absolutePath = path.resolve(this.cwd, filePath)
		const signature = this.calculateSignature(content)

		this.contextMap.set(absolutePath, {
			path: absolutePath,
			lastReadTimestamp: Date.now(),
			lastEditTimestamp: this.getMtime(absolutePath),
			signature,
			stale: false,
		})
	}

	/**
	 * Records that a file has been modified (usually by a tool call).
	 */
	public recordEdit(filePath: string) {
		const absolutePath = path.resolve(this.cwd, filePath)
		const entry = this.contextMap.get(absolutePath)
		if (entry) {
			entry.stale = true
			entry.lastEditTimestamp = Date.now()
		}
	}

	/**
	 * Checks if a file in the context window is now stale.
	 */
	public checkStaleness(filePath: string): { isStale: boolean; reason?: string } {
		const absolutePath = path.resolve(this.cwd, filePath)
		const entry = this.contextMap.get(absolutePath)

		if (!entry) return { isStale: false }

		// 1. Check if marked stale by previous tool action
		if (entry.stale) {
			return { isStale: true, reason: "Modified by a previous tool call." }
		}

		// 2. Check physical mtime for external changes
		const currentMtime = this.getMtime(absolutePath)
		if (currentMtime > entry.lastReadTimestamp) {
			entry.stale = true
			return { isStale: true, reason: "Modified externally on disk." }
		}

		return { isStale: false }
	}

	/**
	 * Returns a warning message if the context is stale.
	 */
	public getStaleWarning(filePath: string): string | null {
		const status = this.checkStaleness(filePath)
		if (status.isStale) {
			return `⚠️ COGNITIVE STALENESS: The version of \`${path.basename(filePath)}\` in your current context window is OUTDATED. ${status.reason} You MUST re-read this file to align your mental model with truth.`
		}
		return null
	}

	private getMtime(p: string): number {
		try {
			return fs.statSync(p).mtimeMs
		} catch {
			return 0
		}
	}

	private calculateSignature(content: string): string {
		// Simple length + first 100 chars hash for speed
		return `${content.length}:${content.substring(0, 100)}`
	}
}
