/**
 * [LAYER: CORE]
 * Frozen export surface and legacy reintroduction guards.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { assert } from "chai"
import * as joyride from "../index"
import { JOYRIDE_FORBIDDEN_EXPORTS } from "../JoyRideContract"

import { REPO_ROOT } from "./paths"

describe("JoyRide API freeze", () => {
	it("should not export forbidden legacy or internal symbols", () => {
		for (const name of JOYRIDE_FORBIDDEN_EXPORTS) {
			assert.notProperty(joyride, name, `forbidden export reintroduced: ${name}`)
		}
	})

	it("should not reference legacy API names in docs except removal notice", () => {
		const docPath = path.join(REPO_ROOT, "docs/features/joyride.mdx")
		const content = fs.readFileSync(docPath, "utf8")
		const legacyNames = ["lookupCommandResult", "lookupGrepResult", "storeCommandResult", "storeGrepResult"]
		for (const name of legacyNames) {
			const matches = content.match(new RegExp(name, "g")) ?? []
			assert.isAtMost(matches.length, 1, `docs should mention ${name} at most once (removal notice only)`)
		}
	})

	it("should not export JoyRideCache class directly", () => {
		assert.notProperty(joyride, "JoyRideCache")
	})
})
