import { expect } from "chai"
import { resolveCompletionFunnelSnapshot } from "../../completion/completionFunnelMessages"
import type { DietCodeMessage } from "../../ExtensionMessage"
import { buildCompletionFunnelSummary, isInternalDiagnosticsEnabled, projectMessageForWebview } from "../webviewDiagnostics"

describe("webview diagnostic boundary", () => {
	const render = (text: string): string => projectMessageForWebview({ ts: 1, type: "say", say: "text", text }).text ?? ""

	it("removes sovereign substrate telemetry from rendered content", () => {
		const rendered = render(
			[
				"Visible before",
				"🛡️ SOVEREIGN SUBSTRATE [V189]: INFRASTRUCTURE layer",
				"Pressure: 0.1 | Vitality: 100% | Health: 100.0%",
				"Visible after",
			].join("\n"),
		)

		expect(rendered).to.equal("Visible before\nVisible after")
		for (const forbidden of ["SOVEREIGN SUBSTRATE", "Pressure:", "Vitality:", "Health:"]) {
			expect(rendered).not.to.contain(forbidden)
		}
	})

	it("removes sovereign structural audit blocks", () => {
		const rendered = render(
			[
				"🛡️ SOVEREIGN STRUCTURAL AUDIT: DOMAIN layer",
				"Pressure: 1.2 | Vitality: 80% | Health: 71%",
				"",
				"Detected Drift:",
				"- internal violation",
				"User-facing result",
			].join("\n"),
		)

		expect(rendered).to.equal("User-facing result")
		expect(rendered).not.to.contain("SOVEREIGN STRUCTURAL AUDIT")
	})

	it("removes stability audit failure prose", () => {
		const rendered = render(
			["⚠️ STABILITY AUDIT FAILED:", "- No # STRATEGIC REVIEW section found.", "Continue normally."].join("\n"),
		)

		expect(rendered).to.equal("Continue normally.")
		expect(rendered).not.to.contain("STABILITY AUDIT FAILED")
	})

	it("removes completion envelopes and advisory gate XML", () => {
		const rendered = render(
			[
				"Visible result",
				'<completion_gate_envelope schema_version="1" authority="advisory">',
				'<completion_gate_stages><advisory stage="quality">internal</advisory></completion_gate_stages>',
				"</completion_gate_envelope>",
				'<completion_gate_readiness authority="advisory" quality_passed="true" />',
			].join("\n"),
		)

		expect(rendered).to.equal("Visible result")
		expect(rendered).not.to.contain("<completion_gate_envelope")
		expect(rendered).not.to.contain("<completion_gate_stages")
		expect(rendered).not.to.contain("<completion_gate_readiness")
	})

	it("keeps the completion funnel event user-facing", () => {
		const message: DietCodeMessage = {
			ts: 1,
			type: "say",
			say: "info",
			text: "diagnostic",
			completionFunnelEvent: {
				schemaVersion: 1,
				taskId: "task-1",
				phase: "ready",
				kind: "allow_attempt",
				terminal: false,
				nextAllowedAction: "attempt_completion",
				forbiddenActions: ["attempt_completion"],
				canonicalInstruction: "Attempt completion.",
				reason: "Ready.",
				stages: [],
				graphRevision: 1,
				evaluatedAt: 1,
			},
		}
		message.text = buildCompletionFunnelSummary(message)

		const projected = projectMessageForWebview(message)
		expect(projected.text).to.equal("Completion funnel\nNext action: attempt_completion")
		expect(projected.completionFunnelEvent?.nextAllowedAction).to.equal("attempt_completion")
	})

	it("exposes structured diagnostics only behind the explicit debug flag", () => {
		const message: DietCodeMessage = {
			ts: 1,
			type: "say",
			say: "info",
			text: '<completion_gate_envelope authority="advisory"><advisory>internal</advisory></completion_gate_envelope>',
			diagnostics: {
				completionGateEnvelope: {
					authority: "advisory",
					envelope: { nextAction: "run_finalization" },
				},
			},
		}

		const normal = projectMessageForWebview(message)
		expect(normal.text).to.equal("")
		expect(normal.diagnostics).to.equal(undefined)

		const debug = projectMessageForWebview(message, { showInternalDiagnostics: true })
		expect(debug.text).to.equal("")
		expect(debug.diagnostics?.completionGateEnvelope?.envelope).to.deep.equal({
			nextAction: "run_finalization",
		})
	})

	it("strips the complete legacy control-plane regression corpus", () => {
		const samples = [
			"🛡️ SOVEREIGN SUBSTRATE [V189]: INFRASTRUCTURE layer",
			"🛡️ SOVEREIGN STRUCTURAL AUDIT",
			"⚠️ STABILITY AUDIT FAILED:",
			"Pressure: 0.3 | Vitality: 90% | Health: 82%",
			"📊 COGNITIVE REFLECTION",
			"Take a breather nudge and re-orient against scratchpad.md.",
			"<system_nudge>Perform a STRATEGIC REVIEW</system_nudge>",
			'<completion_gate_envelope authority="advisory"><completion_gate_stages /></completion_gate_envelope>',
			"<completion_gate_readiness><advisory>internal</advisory></completion_gate_readiness>",
			"<legacy_lifecycle_envelope>Engineering In Progress</legacy_lifecycle_envelope>",
			"<diagnostic_envelope>internal control plane</diagnostic_envelope>",
			"Finalization not_applicable",
			"Next: attempt_completion, run_verification",
			"gate:preflight.quality:12345",
			"⚠️ validation_pending — governance_policy",
			"📊 PROJECT PROTECTION SUMMARY",
			"### ⚠️ Remaining Errors:",
		]
		const forbidden =
			/SOVEREIGN|SUBSTRATE|STRUCTURAL AUDIT|STABILITY AUDIT|Pressure:|Vitality:|Health:|COGNITIVE REFLECTION|breather nudge|re-orient|system_nudge|<completion_gate_|Finalization not_applicable|Next:\s*attempt_completion,\s*run_verification|gate:preflight|validation_pending|governance_policy|PROJECT PROTECTION SUMMARY|Remaining Errors/i

		for (const sample of samples) {
			expect(render(`Visible result\n${sample}`), sample).not.to.match(forbidden)
		}
	})

	it("sanitizes nested tool and assistant JSON without corrupting the payload", () => {
		const raw = JSON.stringify({
			tool: "web_result",
			result: 'Visible result\nHealth: 12%\n<completion_gate_readiness quality_passed="false" />',
			diagnostics: { pressure: 0.9 },
		})
		const sanitized = render(raw)
		const parsed = JSON.parse(sanitized) as Record<string, unknown>

		expect(parsed.result).to.equal("Visible result")
		expect(parsed).not.to.have.property("diagnostics")
	})

	it("enables internal diagnostic metadata only for the exact environment flag value", () => {
		expect(isInternalDiagnosticsEnabled(undefined)).to.equal(false)
		expect(isInternalDiagnosticsEnabled("false")).to.equal(false)
		expect(isInternalDiagnosticsEnabled("TRUE")).to.equal(false)
		expect(isInternalDiagnosticsEnabled("true")).to.equal(true)
	})

	it("removes audit metadata from the normal projection", () => {
		const message = {
			ts: 1,
			type: "say",
			say: "info",
			text: "Completion diagnostics: advisory",
			auditMetadata: { violations: ["internal"] },
		} as unknown as DietCodeMessage

		const normal = projectMessageForWebview(message)
		expect(normal.auditMetadata).to.equal(undefined)

		const debug = projectMessageForWebview(message, { showInternalDiagnostics: true })
		expect(debug.auditMetadata).not.to.equal(undefined)
	})

	it("resolves the exact completion funnel event without merging projections", () => {
		const projected = projectMessageForWebview({
			ts: 1,
			type: "say",
			say: "info",
			text: "Completion funnel\nNext action: attempt_completion",
			completionFunnelEvent: {
				schemaVersion: 1,
				taskId: "task-1",
				phase: "ready",
				kind: "allow_attempt",
				terminal: false,
				nextAllowedAction: "attempt_completion",
				forbiddenActions: ["attempt_completion"],
				canonicalInstruction: "Attempt completion.",
				reason: "Ready.",
				stages: [],
				graphRevision: 1,
				evaluatedAt: 1,
			},
		} as unknown as DietCodeMessage)
		const snapshot = resolveCompletionFunnelSnapshot([projected])

		expect(snapshot.event?.nextAllowedAction).to.equal("attempt_completion")
		expect(snapshot.terminalCompletion).to.equal(false)
	})
})
