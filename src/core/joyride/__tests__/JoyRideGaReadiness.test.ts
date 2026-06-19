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

	it("should include release notes", () => {
		const notes = path.join(__dirname, "../../../../docs/features/joyride-release-notes.mdx")
		assert.isTrue(fs.existsSync(notes), "missing joyride-release-notes.mdx")
	})
})
