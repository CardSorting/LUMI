/**
 * [LAYER: CORE]
 * Runtime import boundary enforcement for JoyRide integrations.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { assert } from "chai"
import {
	JOYRIDE_FORBIDDEN_CACHE_CALLS,
	JOYRIDE_FORBIDDEN_RUNTIME_IMPORTS,
	JOYRIDE_RUNTIME_INTEGRATION_FILES,
} from "../JoyRideContract"

const REPO_ROOT = path.resolve(__dirname, "../../../..")

describe("JoyRide import boundary enforcement", () => {
	for (const relativeFile of JOYRIDE_RUNTIME_INTEGRATION_FILES) {
		it(`should keep ${relativeFile} on modern JoyRide entrypoint only`, () => {
			const filePath = path.join(REPO_ROOT, relativeFile)
			const content = fs.readFileSync(filePath, "utf8")

			for (const forbidden of JOYRIDE_FORBIDDEN_RUNTIME_IMPORTS) {
				assert.notInclude(content, forbidden, `${relativeFile} must not import JoyRide internal module ${forbidden}`)
			}

			for (const forbiddenCall of JOYRIDE_FORBIDDEN_CACHE_CALLS) {
				assert.notInclude(content, forbiddenCall, `${relativeFile} must not use raw cache access: ${forbiddenCall}`)
			}

			if (content.includes("joyride") || content.includes("JoyRide")) {
				const hasModernEntry =
					content.includes("@core/joyride") || content.includes("./core/joyride") || content.includes("../joyride")
				assert.isTrue(hasModernEntry, `${relativeFile} must import from @core/joyride entrypoint`)
			}
		})
	}
})
