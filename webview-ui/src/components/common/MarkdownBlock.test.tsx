import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import MarkdownBlock from "./MarkdownBlock"

describe("MarkdownBlock diagnostic boundary", () => {
	it("sanitizes direct markdown callers that bypass message projection", () => {
		const { container } = render(
			<MarkdownBlock
				markdown={[
					"Visible result",
					"🛡️ SOVEREIGN SUBSTRATE",
					"Pressure: 0.9 | Vitality: 10% | Health: 20%",
					"<completion_gate_envelope>internal</completion_gate_envelope>",
				].join("\n")}
			/>,
		)
		const rendered = container.textContent ?? ""

		expect(rendered).toContain("Visible result")
		expect(rendered).not.toMatch(/SOVEREIGN|SUBSTRATE|Pressure:|Vitality:|Health:|completion_gate/i)
	})
})
