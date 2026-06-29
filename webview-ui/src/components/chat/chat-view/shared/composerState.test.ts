import type { DietCodeMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { deriveComposerMode, shouldCollapseComposer } from "./composerState"

const task: DietCodeMessage = { ts: 1, type: "say", say: "task", text: "Do work" }

describe("deriveComposerMode", () => {
	it("distinguishes active steering from an idle composer", () => {
		const streaming: DietCodeMessage = { ts: 2, type: "say", say: "text", text: "Working", partial: true }
		expect(deriveComposerMode([task, streaming], undefined, true)).toBe("steering")
		expect(deriveComposerMode([task], undefined, true)).toBe("ready")
	})

	it("identifies optional approval feedback", () => {
		const approval: DietCodeMessage = { ts: 2, type: "ask", ask: "tool", text: "{}" }
		expect(deriveComposerMode([task, approval], "tool", true)).toBe("approval")
	})

	it("gives disabled semantics precedence", () => {
		const approval: DietCodeMessage = { ts: 2, type: "ask", ask: "tool", text: "{}" }
		expect(deriveComposerMode([task, approval], "tool", false)).toBe("disabled")
	})

	it("demotes the composer after completion", () => {
		const completion: DietCodeMessage = { ts: 2, type: "ask", ask: "completion_result", text: "Done" }
		expect(deriveComposerMode([task, completion], "completion_result", true)).toBe("completion")
	})

	it("demotes optional guidance while recovery is active", () => {
		const recovering: DietCodeMessage = { ts: 2, type: "say", say: "api_req_retried", text: "Retrying" }
		expect(deriveComposerMode([task, recovering], undefined, true)).toBe("recovering")
		expect(shouldCollapseComposer("recovering", false, false)).toBe(true)
	})

	it("turns a cancelled request into a clear resume composer", () => {
		const cancelled: DietCodeMessage = {
			ts: 2,
			type: "say",
			say: "api_req_started",
			text: JSON.stringify({ cancelReason: "user_cancelled" }),
		}
		expect(deriveComposerMode([task, cancelled], undefined, true)).toBe("resume")
	})

	it("collapses secondary composers but preserves drafts and quotes", () => {
		expect(shouldCollapseComposer("approval", false, false)).toBe(true)
		expect(shouldCollapseComposer("completion", false, false)).toBe(true)
		expect(shouldCollapseComposer("approval", true, false)).toBe(false)
		expect(shouldCollapseComposer("approval", false, true)).toBe(false)
		expect(shouldCollapseComposer("steering", false, false)).toBe(false)
	})
})
