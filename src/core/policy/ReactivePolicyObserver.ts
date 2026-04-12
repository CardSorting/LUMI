import { AssistantMessageContent } from "../assistant-message"
import { UniversalGuard } from "./UniversalGuard"

/**
 * ReactivePolicyObserver: Monitors the AI stream in real-time to provide
 * proactive architectural guidance. Focuses on tool_use blocks rather than
 * free text to avoid false positives from discussion content.
 */
export class ReactivePolicyObserver {
	constructor(private guard: UniversalGuard) {}

	/**
	 * Scans the assistant's streaming content for architectural signals.
	 * Only triggers on tool_use blocks (not text discussion) to minimize false positives.
	 */
	public observeStream(content: AssistantMessageContent[]): { warning?: string; interrupt?: boolean } {
		const mode = this.guard.getMode()
		for (const block of content) {
			if (block.type === "tool_use" && "name" in block) {
				const params = (block as any).params || {}

				// If the agent is writing to a file, provide proactive layer awareness
				if ((block.name === "write_to_file" || block.name === "replace_in_file") && params.path) {
					const layer = this.guard.getLayerForPath(params.path)
					const content = params.content || params.diff || ""

					// Check for cross-layer import patterns in domain files
					if (
						layer === "domain" &&
						typeof content === "string" &&
						/import\s+.*from\s+["'].*(?:infrastructure|services|integrations|ui|webview)/i.test(content)
					) {
						if (mode === "plan") {
							return {
								warning: `📍 Planning a change in DOMAIN layer file \`${params.path}\` with a cross-layer import. Remember to plan an interface in Domain and an implementation in Infrastructure.`,
							}
						}
						return {
							warning: `📍 Writing to DOMAIN layer file \`${params.path}\` — detected cross-layer import. Domain files should not import from Infrastructure/UI. Consider extracting an interface instead.`,
						}
					}

					// Check for I/O patterns in domain files
					if (
						layer === "domain" &&
						typeof content === "string" &&
						/import\s+.*from\s+["'](?:fs|node:|http|https|net|child_process)/i.test(content)
					) {
						if (mode === "plan") {
							return {
								warning: `📍 Planning a change in DOMAIN layer file \`${params.path}\` with I/O imports. Plan to wrap these in an Infrastructure adapter to keep Domain pure.`,
							}
						}
						return {
							warning: `📍 Writing to DOMAIN layer file \`${params.path}\` — detected I/O import (fs/http/net). Domain should be pure. Wrap I/O in an Infrastructure adapter.`,
						}
					}
				}
			}
		}
		return {}
	}

	/**
	 * Provides proactive layer awareness on tool outcomes.
	 */
	public async observeToolOutcome(_toolName: string, _output: any): Promise<{ hint?: string }> {
		// Read-time layer context is already handled by FluidPolicyEngine.onRead()
		// This hook is available for future enrichments (e.g., dependency graph suggestions)
		return {}
	}
}
