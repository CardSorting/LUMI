/**
 * Serializable canonical lifecycle decision — mirrors the shape of
 * CompletionLifecycleDecision from the core engine, but lives in `shared`
 * so it can be published to the webview via DietCodeMessage.
 *
 * The backend maps from CompletionLifecycleDecision to this type before
 * publishing.  The webview uses it as the canonical authority for the
 * LifecycleProjection resolver.
 */

export type CanonicalDecisionKind = "allow_attempt" | "allow_probe" | "route_to_finalization" | "soft_block" | "hard_block"

export type CanonicalNextAction = "attempt_completion" | "run_finalization" | "modify_workspace" | "stop_and_report" | "none"

/**
 * A serializable canonical lifecycle decision.
 * This is the ONLY next-action authority the webview should use.
 */
export interface CanonicalLifecycleDecision {
	kind: CanonicalDecisionKind
	nextAllowedAction: CanonicalNextAction
	forbiddenActions: CanonicalNextAction[]
	canonicalInstruction: string
	reason: string
}
