/**
 * [LAYER: CORE]
 * GA readiness meta-suite — contract suites exist and baseline passes.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { assert } from "chai"

const TEST_DIR = path.join(__dirname)

const GA_SUITE_FILES = [
	"JoyRideContractDrift.test.ts",
	"JoyRideRealSession.test.ts",
	"JoyRideFailureModes.test.ts",
	"JoyRideVerificationGa.test.ts",
	"JoyRideScratchGa.test.ts",
	"JoyRideSearchGa.test.ts",
	"JoyRideImportBoundary.test.ts",
	"JoyRideModernApi.test.ts",
	"JoyRideDecisionInvariants.test.ts",
	"JoyRideConfigContract.test.ts",
	"JoyRideDegradedContract.test.ts",
	"JoyRideReasonCodes.test.ts",
	"JoyRideContractScenarios.test.ts",
	"JoyRideBenchmark.test.ts",
] as const

describe("JoyRide GA readiness", () => {
	it("should include all required contract test suites", () => {
		for (const file of GA_SUITE_FILES) {
			assert.isTrue(fs.existsSync(path.join(TEST_DIR, file)), `missing GA suite: ${file}`)
		}
	})

	it("should document contributor checklist in joyride.mdx", () => {
		const doc = fs.readFileSync(path.join(__dirname, "../../../../docs/features/joyride.mdx"), "utf8")
		assert.include(doc, "Contributor checklist")
		assert.include(doc, "fallbackBehavior")
		assert.include(doc, "do not import JoyRide internals")
	})

	it("should include package documentation suite", () => {
		const docsDir = path.join(__dirname, "../docs")
		const required = [
			"README.md",
			"BRIEF.md",
			"PHILOSOPHY.md",
			"WHITEPAPER.md",
			"CACHING.md",
			"API.md",
			"GLOSSARY.md",
			"TROUBLESHOOTING.md",
		]
		for (const file of required) {
			assert.isTrue(fs.existsSync(path.join(docsDir, file)), `missing docs/${file}`)
		}
		assert.isTrue(fs.existsSync(path.join(__dirname, "../README.md")), "missing package README.md")
	})

	it("should cross-link documentation hub from package README", () => {
		const readme = fs.readFileSync(path.join(__dirname, "../README.md"), "utf8")
		assert.include(readme, "docs/README.md")
		assert.include(readme, "docs/CACHING.md")
		assert.include(readme, "docs/TROUBLESHOOTING.md")
	})

	it("should include release notes", () => {
		const notes = path.join(__dirname, "../../../../docs/features/joyride-release-notes.mdx")
		assert.isTrue(fs.existsSync(notes), "missing joyride-release-notes.mdx")
	})
})
