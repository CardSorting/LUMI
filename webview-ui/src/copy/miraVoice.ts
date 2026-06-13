/**
 * MIRA voice helpers — warm, collaborative microcopy.
 *
 * Design principles:
 * - Can someone keep this open all day without feeling managed by it?
 * - Does this interface reduce tension?
 * - Does this reduce cognitive tension right now? (tired-developer test)
 * - Sustainable pace — not velocity, hustle, or optimization pressure.
 * - Recoverable cognition — observations and possibilities, not judgment.
 * - Archival artifacts — project notes, not infrastructure telemetry.
 */

/** Warm completion closers — used sparingly when speech is warranted. */
export const COMPLETION_CLOSERS = [
	"That should help.",
	"Looks better now.",
	"I think we're back on track.",
	"That should make things easier.",
] as const

export type CompletionPresentation = {
	/** When false, the header row is omitted — panel settles in silence. */
	showHeader: boolean
	header: string | null
	closer: string | null
}

/** Soft silence: most completions settle without extra narration. */
export function pickCompletionPresentation(seed: number): CompletionPresentation {
	const bucket = Math.abs(seed) % 4
	if (bucket === 0 || bucket === 1) {
		return { showHeader: false, header: null, closer: null }
	}
	if (bucket === 2) {
		return { showHeader: true, header: null, closer: null }
	}
	const closer = Math.abs(seed >> 2) % 2 === 0 ? null : COMPLETION_CLOSERS[Math.abs(seed >> 3) % COMPLETION_CLOSERS.length]
	return { showHeader: true, header: "All done.", closer }
}

/** @deprecated Use pickCompletionPresentation */
export function pickCompletionCloser(seed: number): string | null {
	return pickCompletionPresentation(seed).closer
}

/** Stable placeholders — no rotation; quiet availability. */
const PLACEHOLDER_WITH_TASK = "Ask me anything…"
const PLACEHOLDER_STEERING = "Add a follow-up, steer the task, or type /replan…"
const PLACEHOLDER_EMPTY = "Take your time."
const PLACEHOLDER_LONG_SESSION = "Still here."
const PLACEHOLDER_NIGHT = "…"

export function pickEmptyStateLine(_seed: number): string {
	return PLACEHOLDER_EMPTY
}

export function pickChatPlaceholder(
	hasTask: boolean,
	_seed: number,
	sessionMinutes = 0,
	isNightDesk = false,
	agentActive = false,
): string {
	if (isNightDesk) {
		return PLACEHOLDER_NIGHT
	}
	if (sessionMinutes >= 90) {
		return PLACEHOLDER_LONG_SESSION
	}
	if (!hasTask) {
		return PLACEHOLDER_EMPTY
	}
	if (agentActive) {
		return PLACEHOLDER_STEERING
	}
	return PLACEHOLDER_WITH_TASK
}

/** Gentle recovery lines after failure — stable per message timestamp. */
export const RECOVERY_LINES = [
	"We can try another way.",
	"That didn't work, but I have another idea.",
	"I think I found a better approach.",
	"No rush — we can keep exploring.",
] as const

export function pickRecoveryLine(seed: number): string {
	return RECOVERY_LINES[Math.abs(seed) % RECOVERY_LINES.length]
}

/** Calm copy when MIRA is uncertain or stuck. */
export const STUCK_LINES = [
	"This one's a little tricky.",
	"I'm not fully sure yet.",
	"I found a couple possible directions.",
	"We'll figure it out.",
] as const

export function pickStuckLine(seed: number): string {
	return STUCK_LINES[Math.abs(seed) % STUCK_LINES.length]
}

/** Soft approval prompts — invitation, not permission gates. */
export const APPROVAL = {
	editFile: "Want me to apply these changes?",
	deleteFile: "I can remove this file if you'd like.",
	newFile: "Want me to add this file?",
	readFile: "I can take a look at this file.",
	listFiles: "Want me to browse the files here?",
	listRecursive: "Want me to look through the files here?",
	definitions: "Want me to check definitions in this folder?",
	searchPrefix: "Want me to search this folder for",
	webFetch: "Want me to open this page?",
	webSearch: "Want me to search the web for:",
	command: "Want me to try this in the terminal?",
	browser: "Want me to open the browser?",
	condense: "Want me to tidy up our chat?",
	mcpPrefix: "Want me to use a tool on",
} as const
