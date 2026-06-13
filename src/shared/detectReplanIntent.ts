/**
 * Detect when user feedback indicates a scope pivot that should return to PLAN MODE.
 * Used during ACT phase interruptions and task resume.
 */
const REPLAN_INTENT_PATTERN =
	/\b(?:re-?plan(?:ning)?|rethink(?:ing)?|different approach|new approach|alternative approach|change of plans|revise (?:the |our )?plan|scrap (?:the |this )?plan|pivot(?:ing)?|let'?s plan(?: again)?|back to planning|start over with (?:a )?(?:new )?plan|need to plan again|take a step back|wrong direction)\b|(?:^|\s)\/replan(?:\s|$)/i

export function detectReplanIntent(feedback: string | undefined): boolean {
	if (!feedback?.trim()) {
		return false
	}

	// Strip quoted context blocks so pasted code does not trigger false positives.
	const withoutContext = feedback.replace(/\[context\][\s\S]*?\[\/context\]/gi, "").trim()
	return REPLAN_INTENT_PATTERN.test(withoutContext)
}
