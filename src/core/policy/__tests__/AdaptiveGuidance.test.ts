import { expect } from "chai"
import * as path from "path"
import { FluidPolicyEngine } from "../FluidPolicyEngine"

describe("FluidPolicyEngine - Adaptive Architectural Guidance", () => {
	let engine: FluidPolicyEngine
	const cwd = process.cwd()

	beforeEach(() => {
		engine = new FluidPolicyEngine(cwd)
		engine.setMode("plan")
	})

	it("should show full probing questions when readCount is low (e.g., 0)", async () => {
		const filePath = path.join(cwd, "src/domain/test.ts")
		const content = "export class Test {}"
		const result = await engine.onRead(filePath, content, 0, 0)

		expect(result).to.contain("🔍 Architecture Probing (PLAN mode):")
		expect(result).to.contain("- Does this logic belong in a Core Service instead?")
	})

	it("should show quiet mode when totalReadCount is moderate (e.g., 5)", async () => {
		const filePath = path.join(cwd, "src/domain/test.ts")
		const content = "export class Test {}"
		const result = await engine.onRead(filePath, content, 5, 1)

		expect(result).to.contain("🔍 Architecture Context (PLAN mode):")
		expect(result).to.contain("(Probing questions disabled for turn-efficiency. Focus on your planning objective.)")
		expect(result).to.not.contain("Architecture Probing")
	})

	it("should show stalling warning when perFileReadCount is high (e.g., 3)", async () => {
		const filePath = path.join(cwd, "src/domain/test.ts")
		const content = "export class Test {}"
		const result = await engine.onRead(filePath, content, 3, 3)

		expect(result).to.contain("🔍 Architecture Analysis (PLAN mode):")
		expect(result).to.contain("⚠️ RECURSIVE STALLING DETECTED")
		expect(result).to.contain("You have read this specific file")
	})

	it("should show cross-turn recursion detected when globalFileReadCount is high (e.g., 5)", async () => {
		const filePath = path.join(cwd, "src/domain/test.ts")
		const content = "export class Test {}"
		const result = await engine.onRead(filePath, content, 0, 1, 5)

		expect(result).to.contain("🔍 Architecture Analysis (PLAN mode):")
		expect(result).to.contain("⚠️ CROSS-TURN RECURSION DETECTED")
		expect(result).to.contain("across multiple turns")
	})
})
