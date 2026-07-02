import { expect } from "chai"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { TspPolicyPlugin } from "../TspPolicyPlugin"
import { detectWorkspaceArchitectureProfile } from "../WorkspaceArchitectureProfile"

describe("WorkspaceArchitectureProfile", () => {
	let cwd: string

	beforeEach(() => {
		cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lumi-architecture-"))
	})

	afterEach(() => {
		fs.rmSync(cwd, { recursive: true, force: true })
	})

	it("uses canonical JoyZoning for an empty greenfield workspace", () => {
		const profile = detectWorkspaceArchitectureProfile(cwd)

		expect(profile.mode).to.equal("greenfield")
		expect(profile.enforceCanonicalLayers).to.equal(true)
		expect(profile.joyZoningSteering).to.equal("canonical")
		expect(profile.steeringThresholds.maxFunctionLines).to.equal(80)
	})

	it("preserves an established workspace without forcing canonical layers", () => {
		fs.mkdirSync(path.join(cwd, "src"))
		fs.writeFileSync(path.join(cwd, "src", "feature.ts"), "export function feature() { return true }\n")

		const profile = detectWorkspaceArchitectureProfile(cwd)
		const validation = new TspPolicyPlugin(cwd).validateSource(
			path.join(cwd, "src", "feature.ts"),
			"export function feature() { return true }\n",
		)

		expect(profile.mode).to.equal("workspace-native")
		expect(profile.enforceCanonicalLayers).to.equal(false)
		expect(profile.joyZoningSteering).to.equal("blended")
		expect(validation.success).to.equal(true)
		expect(validation.errors).to.deep.equal([])
		expect(validation.warnings).to.not.satisfy((warnings: string[]) =>
			warnings.some((warning) => warning.includes("Missing mandatory")),
		)
	})

	it("keeps JoyZoning active as non-blocking steering in workspace-native code", () => {
		fs.mkdirSync(path.join(cwd, "src"))
		const content = `export async function decideAndPersist(input: number, repository: { save(value: number): Promise<void> }) {
	let value = input
	if (input > 10) {
		value += 1
	}
	const normalized = Math.max(0, value)
	const doubled = normalized * 2
	const bounded = Math.min(100, doubled)
	const label = bounded > 50 ? "high" : "low"
	const payload = { bounded, label }
	if (label === "high") {
		value = bounded
	}
	const snapshot = { input, value, payload }
	const result = snapshot.value
	const audit = { result, label }
	const finalValue = audit.result
	const persisted = finalValue + 1
	const output = persisted
	await repository.save(output)
	return output
}
`

		const validation = new TspPolicyPlugin(cwd).validateSource(path.join(cwd, "src", "feature.ts"), content)

		expect(validation.success).to.equal(true)
		expect(validation.errors).to.deep.equal([])
		expect(validation.warnings.some((warning) => warning.includes("[JOY STEERING JZ-B01: BOUNDARY]"))).to.equal(true)
		expect(validation.warnings.some((warning) => warning.includes("src/domain"))).to.equal(false)
	})

	it("supports workspace-calibrated steering thresholds", () => {
		fs.mkdirSync(path.join(cwd, "src"))
		fs.writeFileSync(
			path.join(cwd, "stability.config.json"),
			JSON.stringify({
				global: {
					architectureMode: "auto",
					joyZoningSteering: { maxFunctionLines: 5 },
				},
			}),
		)
		const content = `export function calculate(input: number) {
	const first = input + 1
	const second = first * 2
	const third = second - 1
	const fourth = third / 2
	return fourth
}
`

		const profile = detectWorkspaceArchitectureProfile(cwd)
		const validation = new TspPolicyPlugin(cwd).validateSource(path.join(cwd, "src", "feature.ts"), content)

		expect(profile.steeringThresholds.maxFunctionLines).to.equal(5)
		expect(validation.success).to.equal(true)
		expect(validation.warnings.some((warning) => warning.includes("[JOY STEERING JZ-C01: COHESION]"))).to.equal(true)
	})

	it("retains structural enforcement when a workspace opts into JoyZoning", () => {
		fs.mkdirSync(path.join(cwd, "src", "domain"), { recursive: true })
		fs.writeFileSync(path.join(cwd, "stability.config.json"), JSON.stringify({ global: { architectureMode: "joy-zoning" } }))

		const profile = detectWorkspaceArchitectureProfile(cwd)
		const validation = new TspPolicyPlugin(cwd).validateSource(
			path.join(cwd, "src", "domain", "Order.ts"),
			"export class Order {}\n",
		)

		expect(profile.mode).to.equal("joy-zoning")
		expect(profile.enforceCanonicalLayers).to.equal(true)
		expect(profile.joyZoningSteering).to.equal("canonical")
		expect(validation.warnings.some((warning) => warning.includes("Missing mandatory"))).to.equal(true)
	})

	it("allows an established project to explicitly request workspace-native behavior", () => {
		fs.mkdirSync(path.join(cwd, "src", "domain"), { recursive: true })
		fs.writeFileSync(
			path.join(cwd, "stability.config.json"),
			JSON.stringify({ global: { architectureMode: "workspace-native" } }),
		)

		const profile = detectWorkspaceArchitectureProfile(cwd)

		expect(profile.mode).to.equal("workspace-native")
		expect(profile.enforceCanonicalLayers).to.equal(false)
	})

	it("uses source evidence when architecture mode is auto", () => {
		fs.mkdirSync(path.join(cwd, "server"))
		fs.writeFileSync(path.join(cwd, "server", "main.py"), "print('existing app')\n")
		fs.writeFileSync(path.join(cwd, "stability.config.json"), JSON.stringify({ global: { architectureMode: "auto" } }))

		const profile = detectWorkspaceArchitectureProfile(cwd)

		expect(profile.mode).to.equal("workspace-native")
		expect(profile.enforceCanonicalLayers).to.equal(false)
	})
})
