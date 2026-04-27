import { expect } from "chai"
import { describe, it } from "mocha"
import { isWebviewExecutableCommand, WEBVIEW_EXECUTABLE_COMMANDS } from "@/shared/WebviewMessage"

describe("Webview executable command allowlist", () => {
	it("allows the JoyZoning audit command", () => {
		expect(isWebviewExecutableCommand("dietcode.joyZoningAudit")).to.equal(true)
		expect(WEBVIEW_EXECUTABLE_COMMANDS).to.include("dietcode.joyZoningAudit")
	})

	it("rejects arbitrary VS Code commands", () => {
		expect(isWebviewExecutableCommand("workbench.action.reloadWindow")).to.equal(false)
		expect(isWebviewExecutableCommand("dietcode.plusButtonClicked")).to.equal(false)
	})
})
