/**
 * Anti-recursion guards for governed subagent execution.
 * Vague improvement language must not trigger architecture expansion.
 */

export type GovernedDirectiveKind =
	| "bug_fix"
	| "regression_test"
	| "documentation"
	| "thin_adapter_swap"
	| "ux_clarity"
	| "architecture_expansion"
	| "vague_recursive_escalation"

export type GovernedAllowedPass = "audit_only" | "test_only" | "docs_only" | "thin_adapter" | "ux_clarity" | "implement"

export interface GovernedDirectiveClassification {
	kind: GovernedDirectiveKind
	allowedPass: GovernedAllowedPass
	architectureExpansionPermitted: boolean
	matchedSignals: string[]
	reason: string
}

export type GovernedFrozenLayer = "lock_authority" | "receipt_schema" | "merge_gate" | "worker_path" | "parent_memory_convergence"

export interface GovernedInvariantStatus {
	name: string
	satisfied: boolean
}

export interface GovernedBoundedResponse {
	classification: GovernedDirectiveClassification
	invariants: GovernedInvariantStatus[]
	architectureFrozen: boolean
	allowedNextActions: string[]
	refusal?: string
}

/** Invariants considered complete — further work is audit/test/docs unless a test fails. */
export const GOVERNED_EXECUTION_COMPLETE_INVARIANTS: GovernedInvariantStatus[] = [
	{ name: "unified ownership", satisfied: true },
	{ name: "durable execution truth", satisfied: true },
	{ name: "fail-closed merge gate", satisfied: true },
	{ name: "crash receipt", satisfied: true },
	{ name: "retry safety", satisfied: true },
	{ name: "replay checksum", satisfied: true },
	{ name: "operator incident console", satisfied: true },
	{ name: "operator runbook", satisfied: true },
]

const VAGUE_ESCALATION_PATTERNS: Array<{ pattern: RegExp; signal: string }> = [
	{ pattern: /\bdouble\s+down\b/i, signal: "double down" },
	{ pattern: /\bworld[- ]?class\b/i, signal: "worldclass" },
	{ pattern: /\bdeeply\s+(investigate|audit|dig)\b/i, signal: "deeply investigate" },
	{ pattern: /\banother\s+pass\b/i, signal: "another pass" },
	{ pattern: /\bdig\s+deeper\b/i, signal: "dig deeper" },
	{ pattern: /\bindustry\s+standards?\b/i, signal: "industry standards" },
	{ pattern: /\bmore\s+robust\b|\bmake\s+it\s+robust\b/i, signal: "make it more robust" },
	{ pattern: /\bimprove(d)?\s+subagent\s+(ergonomics|ux)\b/i, signal: "improve subagent ergonomics" },
	{ pattern: /\bworldclass\s+ux\b/i, signal: "worldclass UX" },
	{ pattern: /\bhardening\s+pass\b/i, signal: "hardening pass" },
	{ pattern: /\bfinal\s+pass\b/i, signal: "final pass" },
	{ pattern: /\boverbuild\b|\bexpand\s+the\s+architecture\b/i, signal: "architecture expansion language" },
]

const BUG_FIX_PATTERNS = [/\bbug\b/i, /\bfix\b/i, /\bregression\b/i, /\bfailing\s+test\b/i, /\bbroken\b/i, /\bcrash(es|ed)?\b/i]

const TEST_PATTERNS = [/\badd\s+tests?\b/i, /\btest\s+coverage\b/i, /\bregression\s+test\b/i]

const DOCS_PATTERNS = [/\brunbook\b/i, /\bdocumentation\b/i, /\boperator\s+guide\b/i]

const ADAPTER_PATTERNS = [/\badapter\s+swap\b/i, /\bthin\s+adapter\b/i, /\bwire\s+\w+\s+mutex\b/i]

const UX_PATTERNS = [
	/\bclarif(y|ication)\b/i,
	/\boperator\s+console\b/i,
	/\bincident\s+console\b/i,
	/\bdiagnostics?\s+clarity\b/i,
]

const ARCHITECTURE_PATTERNS = [
	/\bnew\s+lock\s+authority\b/i,
	/\bnew\s+receipt\s+schema\b/i,
	/\bnew\s+merge\s+gate\b/i,
	/\bnew\s+worker\s+path\b/i,
	/\bparent[- ]memory\b/i,
	/\bunify\s+ownership\b.*\bnew\b/i,
]

function matchAny(text: string, patterns: RegExp[]): boolean {
	return patterns.some((p) => p.test(text))
}

function matchVagueSignals(text: string): string[] {
	return VAGUE_ESCALATION_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ signal }) => signal)
}

/**
 * Classify a subagent-improvement request before executing it.
 */
export function classifyGovernedDirective(prompt: string): GovernedDirectiveClassification {
	const text = prompt.trim()
	const vagueSignals = matchVagueSignals(text)
	const hasConcreteBug = matchAny(text, BUG_FIX_PATTERNS)
	const hasExplicitArchitecture = matchAny(text, ARCHITECTURE_PATTERNS)
	const hasFailingTestMention = /\bfailing\s+test\b|\btest\s+proves\b|\bconcrete\s+bug\b/i.test(text)

	if (matchAny(text, TEST_PATTERNS) && !hasExplicitArchitecture) {
		return {
			kind: "regression_test",
			allowedPass: "test_only",
			architectureExpansionPermitted: false,
			matchedSignals: [],
			reason: "Explicit test/coverage request — bounded to regression tests.",
		}
	}

	if (matchAny(text, DOCS_PATTERNS) && !hasExplicitArchitecture) {
		return {
			kind: "documentation",
			allowedPass: "docs_only",
			architectureExpansionPermitted: false,
			matchedSignals: [],
			reason: "Documentation/runbook request — no architecture changes.",
		}
	}

	if (matchAny(text, ADAPTER_PATTERNS)) {
		return {
			kind: "thin_adapter_swap",
			allowedPass: "thin_adapter",
			architectureExpansionPermitted: false,
			matchedSignals: [],
			reason: "Approved thin adapter swap — no new public ownership surface.",
		}
	}

	if (hasExplicitArchitecture && (hasFailingTestMention || hasConcreteBug)) {
		return {
			kind: "architecture_expansion",
			allowedPass: "implement",
			architectureExpansionPermitted: true,
			matchedSignals: vagueSignals,
			reason: "Architecture change permitted only with failing test or concrete bug evidence.",
		}
	}

	if (matchAny(text, UX_PATTERNS) && !hasExplicitArchitecture && vagueSignals.length === 0) {
		return {
			kind: "ux_clarity",
			allowedPass: "ux_clarity",
			architectureExpansionPermitted: false,
			matchedSignals: [],
			reason: "UX/diagnostics clarity — presentation only.",
		}
	}

	if (hasConcreteBug && (hasFailingTestMention || /\bfix\b/i.test(text)) && !hasExplicitArchitecture) {
		return {
			kind: "bug_fix",
			allowedPass: "implement",
			architectureExpansionPermitted: false,
			matchedSignals: vagueSignals,
			reason: "Concrete bug/fix with evidence — implement minimal fix only.",
		}
	}

	if (hasExplicitArchitecture && !hasFailingTestMention && !hasConcreteBug) {
		return {
			kind: "vague_recursive_escalation",
			allowedPass: "audit_only",
			architectureExpansionPermitted: false,
			matchedSignals: vagueSignals,
			reason: "Architecture expansion requested without failing-test or bug evidence — audit only.",
		}
	}

	if (vagueSignals.length > 0 && !hasConcreteBug && !hasFailingTestMention) {
		return {
			kind: "vague_recursive_escalation",
			allowedPass: "audit_only",
			architectureExpansionPermitted: false,
			matchedSignals: vagueSignals,
			reason: "Vague recursive escalation detected — convert to audit/test pass, not new layers.",
		}
	}

	return {
		kind: "bug_fix",
		allowedPass: "implement",
		architectureExpansionPermitted: false,
		matchedSignals: [],
		reason: "Concrete scoped request — implement minimally.",
	}
}

/**
 * Architecture freeze: no new frozen layers without failing test or concrete bug.
 */
export function isArchitectureExpansionAllowed(
	layer: GovernedFrozenLayer,
	evidence: { failingTest?: boolean; concreteBug?: boolean },
): boolean {
	if (evidence.failingTest || evidence.concreteBug) {
		return true
	}
	return false
}

export function assertArchitectureFreeze(
	layer: GovernedFrozenLayer,
	evidence: { failingTest?: boolean; concreteBug?: boolean },
): void {
	if (!isArchitectureExpansionAllowed(layer, evidence)) {
		throw new Error(`Architecture freeze: cannot add or expand '${layer}' without a failing test or concrete bug.`)
	}
}

/**
 * Bounded operator response for vague improvement prompts.
 */
export function buildBoundedImprovementResponse(prompt: string, options?: { failingTests?: string[] }): GovernedBoundedResponse {
	const classification = classifyGovernedDirective(prompt)
	const invariants = GOVERNED_EXECUTION_COMPLETE_INVARIANTS
	const architectureFrozen = !classification.architectureExpansionPermitted

	const allowedNextActions: string[] = []
	switch (classification.allowedPass) {
		case "audit_only":
			allowedNextActions.push("Run governed gate audit (false-positive / false-negative checks)")
			allowedNextActions.push("Report invariant status and existing test coverage")
			allowedNextActions.push("Clarify diagnostics copy in incident console")
			break
		case "test_only":
			allowedNextActions.push("Add regression tests for concrete behavior")
			break
		case "docs_only":
			allowedNextActions.push("Update runbook or operator documentation")
			break
		case "thin_adapter":
			allowedNextActions.push("Swap adapter behind existing public surface (e.g. Broccoli mutex)")
			break
		case "ux_clarity":
			allowedNextActions.push("Improve incident console labels and operator messaging")
			break
		case "implement":
			allowedNextActions.push("Minimal fix for concrete bug or failing test")
			break
	}

	const refusal =
		classification.kind === "vague_recursive_escalation"
			? "Refusing speculative architecture expansion. Governed execution invariants are complete; provide a failing test, concrete bug, or approved adapter swap."
			: undefined

	if (options?.failingTests?.length) {
		allowedNextActions.push(`Address failing tests: ${options.failingTests.join(", ")}`)
	}

	return {
		classification,
		invariants,
		architectureFrozen,
		allowedNextActions,
		refusal,
	}
}

/** Route vague prompts into audit mode — never spawn architecture-building work. */
export function routeGovernedImprovementPrompt(prompt: string): GovernedAllowedPass {
	const classification = classifyGovernedDirective(prompt)
	if (classification.kind === "vague_recursive_escalation") {
		return "audit_only"
	}
	return classification.allowedPass
}
