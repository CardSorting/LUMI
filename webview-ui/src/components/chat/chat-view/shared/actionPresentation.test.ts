import type { DietCodeMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { getActionPresentation, resolveActionShortcut } from "./actionPresentation"
import { BUTTON_CONFIGS } from "./buttonConfig"

describe("getActionPresentation", () => {
	it("describes a read approval as low-risk and read-only", () => {
		const message: DietCodeMessage = {
			ts: 1,
			type: "ask",
			ask: "tool",
			text: JSON.stringify({ tool: "readFile", path: "src/config.ts" }),
		}
		const result = getActionPresentation(message, BUTTON_CONFIGS.tool_approve)

		expect(result.resource).toBe("src/config.ts")
		expect(result.risk).toBe("low")
		expect(result.reversibility).toContain("No workspace change")
	})

	it("makes rejection the recommended action for file deletion", () => {
		const message: DietCodeMessage = {
			ts: 1,
			type: "ask",
			ask: "tool",
			text: JSON.stringify({ tool: "fileDeleted", path: "src/legacy.ts" }),
		}
		const result = getActionPresentation(message, BUTTON_CONFIGS.tool_save, { checkpointAvailable: true })

		expect(result.isDestructive).toBe(true)
		expect(result.recommendedAction).toBe("reject")
		expect(result.approveLabel).toBe("Delete file")
		expect(result.reversibility).toContain("checkpoint")
	})

	it("flags destructive terminal commands", () => {
		const message: DietCodeMessage = { ts: 1, type: "ask", ask: "command", text: "rm -rf build" }
		const result = getActionPresentation(message, BUTTON_CONFIGS.command)

		expect(result.risk).toBe("high")
		expect(result.recommendedAction).toBe("reject")
	})

	it("gives a failed request a calm retry path", () => {
		const message: DietCodeMessage = { ts: 1, type: "ask", ask: "api_req_failed", text: "timeout" }
		const result = getActionPresentation(message, BUTTON_CONFIGS.api_req_failed)

		expect(result.kind).toBe("recovery")
		expect(result.riskLabel).toBe("Safe to retry")
		expect(result.reversibility).toContain("preserved")
	})
})

describe("resolveActionShortcut", () => {
	it("allows the deliberate approval shortcut for non-destructive actions", () => {
		expect(
			resolveActionShortcut({
				key: "Enter",
				ctrlKey: true,
				isPanelFocused: false,
				isExecutionControl: false,
				isApproval: true,
				isDestructive: false,
				primaryAction: "approve",
				secondaryAction: "reject",
			}),
		).toBe("approve")
	})

	it("never keyboard-approves a destructive action", () => {
		expect(
			resolveActionShortcut({
				key: "Enter",
				metaKey: true,
				isPanelFocused: true,
				isExecutionControl: false,
				isApproval: true,
				isDestructive: true,
				primaryAction: "approve",
				secondaryAction: "reject",
			}),
		).toBeUndefined()
	})

	it("limits Escape rejection to focus within the approval panel", () => {
		const base = {
			key: "Escape",
			isExecutionControl: false,
			isApproval: true,
			isDestructive: false,
			primaryAction: "approve" as const,
			secondaryAction: "reject" as const,
		}
		expect(resolveActionShortcut({ ...base, isPanelFocused: false })).toBeUndefined()
		expect(resolveActionShortcut({ ...base, isPanelFocused: true })).toBe("reject")
	})
})
