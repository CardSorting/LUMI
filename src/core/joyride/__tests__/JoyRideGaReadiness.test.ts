/**
 * [LAYER: CORE]
 * GA readiness meta-suite — contract suites exist and baseline passes.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { assert } from "chai"
import { JOYRIDE_PKG_ROOT, JOYRIDE_TEST_DIR, REPO_ROOT } from "./paths.cjs"

const TEST_DIR = JOYRIDE_TEST_DIR

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
		const doc = fs.readFileSync(path.join(REPO_ROOT, "docs/features/joyride.mdx"), "utf8")
		assert.include(doc, "Contributor checklist")
		assert.include(doc, "fallbackBehavior")
		assert.include(doc, "do not import JoyRide internals")
	})

	it("should include package documentation suite", () => {
		const docsDir = path.join(JOYRIDE_PKG_ROOT, "docs")
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
		assert.isTrue(fs.existsSync(path.join(JOYRIDE_PKG_ROOT, "README.md")), "missing package README.md")
	})

	it("should include MIT license crediting CardSorting", () => {
		const license = fs.readFileSync(path.join(JOYRIDE_PKG_ROOT, "LICENSE"), "utf8")
		assert.include(license, "MIT License")
		assert.include(license, "CardSorting")
	})

	it("should include contributor guide", () => {
		const contributing = path.join(JOYRIDE_PKG_ROOT, "CONTRIBUTING.md")
		assert.isTrue(fs.existsSync(contributing), "missing CONTRIBUTING.md")
		const content = fs.readFileSync(contributing, "utf8")
		assert.include(content, "Pull request checklist")
		assert.include(content, "isJoyRideHitDecision")
		assert.include(content, "CardSorting")
	})

	it("should reference MIT license in package README", () => {
		const readme = fs.readFileSync(path.join(JOYRIDE_PKG_ROOT, "README.md"), "utf8")
		assert.include(readme, "MIT")
		assert.include(readme, "CardSorting")
		assert.include(readme, "CONTRIBUTING.md")
		assert.include(readme, "docs/README.md")
		assert.include(readme, "docs/CACHING.md")
		assert.include(readme, "docs/TROUBLESHOOTING.md")
	})

	it("should include release notes", () => {
		const notes = path.join(REPO_ROOT, "docs/features/joyride-release-notes.mdx")
		assert.isTrue(fs.existsSync(notes), "missing joyride-release-notes.mdx")
	})
})
