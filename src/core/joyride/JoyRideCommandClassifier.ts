/**
 * [LAYER: CORE]
 * Strict command classification for JoyRide — fail closed on unknown commands.
 */

export type JoyRideCommandTier = "safe-readonly" | "verification" | "diagnostic-store-only" | "no-store"

import type { JoyRideReasonCode } from "./JoyRideReasonCodes"
import { JOYRIDE_REASON } from "./JoyRideReasonCodes"

export interface JoyRideCommandClassification {
	tier: JoyRideCommandTier
	canSkipExecution: boolean
	canStoreDiagnostic: boolean
	reason: string
	reasonCode: JoyRideReasonCode
}

/** Commands explicitly safe for active execution skip. Prefix/exact match only. */
const SAFE_READONLY_EXACT: Set<string> = new Set(["pwd", "whoami", "hostname"])

const SAFE_READONLY_PREFIXES: RegExp[] = [
	/^pwd$/,
	/^which\s+\S+$/,
	/^git\s+status(\s|$)/,
	/^git\s+branch(\s|$)/,
	/^git\s+rev-parse\s+(HEAD|--is-inside-work-tree|--show-toplevel)(\s|$)/,
	/^git\s+diff\s+--stat(\s|$)/,
	/^git\s+ls-files(\s|$)/,
	/^git\s+log\s+--oneline(\s|$)/,
	/^ls(\s|$)/,
	/^ls\s+-/,
	/^node\s+--version$/,
	/^npm\s+--version$/,
	/^python3?\s+--version$/,
	/^go\s+version$/,
	/^rustc\s+--version$/,
]

const VERIFICATION_COMMAND_PATTERNS: RegExp[] = [
	/^(npm|pnpm|yarn|bun)\s+(run\s+)?(test|lint|typecheck|check)\b/i,
	/^(npm|pnpm|yarn|bun)\s+test\b/i,
	/^(pytest|tox|nox|jest|vitest|mocha|eslint|tsc)\b/i,
	/^(cargo|go|mvn|gradle|gradlew)\s+(test|check)\b/i,
	/^make\s+(test|check)\b/i,
]

/** Patterns that forbid active reuse even if partially matched. */
const UNSAFE_REUSE_PATTERNS: RegExp[] = [
	/[;|&]{2}/, // && ||
	/;/,
	/\|/,
	/[<>]{1,2}/, // redirects
	/\$\(/, // subshell
	/\$\{/, // brace substitution
	/\$\w+/, // variable substitution
	/`/, // backtick
	/\bexport\s+\w+/,
	/\bunset\s+\w+/,
	/\b(env|printenv)\s+\w+\s*=/,
	/\bgit\s+(add|commit|push|pull|fetch|merge|rebase|reset|checkout|switch|stash|clean|tag|cherry-pick)\b/i,
	/\b(npm|pnpm|yarn|bun)\s+(install|ci|uninstall|update|link|publish)\b/i,
	/\b(curl|wget|fetch|http)\b/i,
	/\b(rm|mv|cp|mkdir|touch|chmod|chown|tee)\b/,
	/\b(npm|pnpm|yarn|bun)\s+run\s+build\b/i,
	/\bdate\b/,
	/\b(random|uuidgen|openssl rand)\b/i,
	/\bsudo\b/,
]

const ENV_ALTERING_PATTERNS: RegExp[] = [
	/\b(npm|pnpm|yarn|bun)\s+(install|ci|uninstall|update|link|publish|add|remove)\b/i,
	/\bnvm\b/,
	/\bbrew\s+(install|upgrade|unlink)\b/i,
	/\bfvm\b/,
	/\bgit\s+config\b/i,
]

export function normalizeCommand(command: string): string {
	return command.trim().replace(/\s+/g, " ")
}

/** Strip quoted strings so hidden shell operators cannot bypass safety checks. */
export function stripQuotesForShellAnalysis(command: string): string {
	return command
		.replace(/"([^"\\]|\\.)*"/g, " ")
		.replace(/'([^'\\]|\\.)*'/g, " ")
		.replace(/\s+/g, " ")
		.trim()
}

export function isEnvAlteringCommand(command: string): boolean {
	const normalized = normalizeCommand(command)
	return ENV_ALTERING_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function isVerificationCommand(command: string): boolean {
	const normalized = normalizeCommand(command)
	return VERIFICATION_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))
}

function hasRelativeOrAbsoluteBinaryInvocation(command: string): boolean {
	const normalized = normalizeCommand(command)
	return /^(\.\/|\.\.\/|\/|[A-Za-z]:\\)/.test(normalized)
}

function hasEnvAssignmentPrefix(command: string): boolean {
	return /^[\w.-]+=/.test(normalizeCommand(command))
}

function hasWindowsCmdSyntax(command: string): boolean {
	return /(^|\s)&(\s|$)/.test(command) || /%[\w.-]+%/.test(command)
}

function hasQuotedUnsafeOperators(command: string): boolean {
	return /"[^"]*[|;&<>$`][^"]*"/.test(command) || /'[^']*[|;&<>$`][^']*'/.test(command)
}

function hasUnsafeReusePattern(command: string): boolean {
	const normalized = normalizeCommand(command)
	const unquoted = stripQuotesForShellAnalysis(normalized)
	if (hasQuotedUnsafeOperators(normalized)) {
		return true
	}
	if (
		hasRelativeOrAbsoluteBinaryInvocation(normalized) ||
		hasEnvAssignmentPrefix(normalized) ||
		hasWindowsCmdSyntax(normalized)
	) {
		return true
	}
	return UNSAFE_REUSE_PATTERNS.some((pattern) => pattern.test(unquoted))
}

function isSafeReadOnlyCommand(command: string): boolean {
	const normalized = normalizeCommand(command)
	if (hasUnsafeReusePattern(normalized)) {
		return false
	}
	if (isEnvAlteringCommand(normalized)) {
		return false
	}
	if (SAFE_READONLY_EXACT.has(normalized)) {
		return true
	}
	return SAFE_READONLY_PREFIXES.some((pattern) => pattern.test(normalized))
}

export function classifyCommand(command: string): JoyRideCommandClassification {
	const normalized = normalizeCommand(command)
	if (!normalized) {
		return {
			tier: "no-store",
			canSkipExecution: false,
			canStoreDiagnostic: false,
			reason: "empty_command",
			reasonCode: JOYRIDE_REASON.MISS_COMMAND_UNKNOWN,
		}
	}

	if (hasUnsafeReusePattern(normalized)) {
		return {
			tier: "diagnostic-store-only",
			canSkipExecution: false,
			canStoreDiagnostic: !isEnvAlteringCommand(normalized),
			reason: "unsafe_chaining_or_mutation_pattern",
			reasonCode: JOYRIDE_REASON.MISS_COMMAND_UNSAFE_SYNTAX,
		}
	}

	if (isEnvAlteringCommand(normalized)) {
		return {
			tier: "diagnostic-store-only",
			canSkipExecution: false,
			canStoreDiagnostic: true,
			reason: "env_altering_command",
			reasonCode: JOYRIDE_REASON.MISS_COMMAND_ENV_ALTERING,
		}
	}

	if (isSafeReadOnlyCommand(normalized)) {
		return {
			tier: "safe-readonly",
			canSkipExecution: true,
			canStoreDiagnostic: true,
			reason: "explicit_safe_readonly_allowlist",
			reasonCode: JOYRIDE_REASON.HIT_COMMAND_SAFE_ALLOWLISTED,
		}
	}

	if (isVerificationCommand(normalized)) {
		return {
			tier: "verification",
			canSkipExecution: false,
			canStoreDiagnostic: true,
			reason: "verification_requires_complete_proof",
			reasonCode: JOYRIDE_REASON.MISS_VERIFICATION_INCOMPLETE_PROOF,
		}
	}

	// Unknown commands: store diagnostic if harmless output, never skip execution
	return {
		tier: "diagnostic-store-only",
		canSkipExecution: false,
		canStoreDiagnostic: true,
		reason: "unknown_command_default_no_reuse",
		reasonCode: JOYRIDE_REASON.MISS_COMMAND_UNKNOWN,
	}
}

/** @deprecated Use classifyCommand().canSkipExecution for safe-readonly tier only. */
export function isReadOnlyCacheableCommand(command: string): boolean {
	return classifyCommand(command).tier === "safe-readonly"
}

export function isCommandCacheEligible(command: string): boolean {
	const classification = classifyCommand(command)
	return classification.canSkipExecution || classification.canStoreDiagnostic
}

export function canCommandSkipExecution(command: string): boolean {
	return classifyCommand(command).canSkipExecution
}
