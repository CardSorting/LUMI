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

	it("should show core rigor guidance when readCount is low (e.g., 0)", async () => {
		const filePath = path.join(cwd, "src/domain/test.ts")
		const content = "export class Test {}"
		const result = await engine.onRead(filePath, content, 0, 0)

		expect(result).to.contain("DOMAIN layer")
		expect(result).to.contain("[CORE RIGOR]")
		expect(result).to.contain("scratchpad.md")
	})

	it("should show context saturation when totalReadCount is moderate (e.g., 5)", async () => {
		const filePath = path.join(cwd, "src/domain/test.ts")
		const content = "export class Test {}"
		const result = await engine.onRead(filePath, content, 5, 1)

		expect(result).to.contain("[CONTEXT SATURATED]")
		expect(result).to.contain("plan_mode_respond")
		expect(result).to.contain("[SOVEREIGN DRAFTING]")
	})

	it("should show stalling warning when perFileReadCount is high (e.g., 3)", async () => {
		const filePath = path.join(cwd, "src/domain/test.ts")
		const content = "export class Test {}"
		const result = await engine.onRead(filePath, content, 3, 3)

		expect(result).to.contain("[RECURSIVE STALLING]")
		expect(result).to.contain("Stop reading and start planning")
	})

	it("should show scanning limit when core-layer investigation budget is exhausted", async () => {
		const filePath = path.join(cwd, "src/domain/test.ts")
		const content = "export class Test {}"
		const result = await engine.onRead(filePath, content, 15, 1)

		expect(result).to.contain("[SCANNING LIMIT]")
		expect(result).to.contain("plan_mode_respond")
	})
})
