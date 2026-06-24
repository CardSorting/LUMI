/**
 * [LAYER: CORE]
 * Contract drift prevention — fails loudly on architectural regression.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { assert } from "chai"
import * as joyride from "../index"
import {
	JOYRIDE_FORBIDDEN_EXPORTS,
	JOYRIDE_FORBIDDEN_VAGUE_REASONS,
	JOYRIDE_FROZEN_EXPORTS,
	JOYRIDE_REASON_CATEGORY_PREFIXES,
} from "../JoyRideContract"
import { JOYRIDE_REASON } from "../JoyRideReasonCodes"

import { REPO_ROOT } from "./paths"

describe("JoyRide contract drift prevention", () => {
	it("should export only frozen public symbols", () => {
		const exported = Object.keys(joyride).sort()
		const frozen = [...JOYRIDE_FROZEN_EXPORTS].sort()
		assert.deepEqual(exported, frozen, "public export surface changed — update JoyRideContract.ts and review")
	})

	it("should not export any forbidden legacy or internal symbols", () => {
		for (const name of JOYRIDE_FORBIDDEN_EXPORTS) {
			assert.notProperty(joyride, name)
		}
	})

	it("should keep reason codes within approved category prefixes", () => {
		for (const code of Object.values(JOYRIDE_REASON)) {
			const ok = JOYRIDE_REASON_CATEGORY_PREFIXES.some((p) => code.startsWith(p))
			assert.isTrue(ok, `reason code ${code} outside approved categories`)
		}
	})

	it("should not use vague standalone reason codes", () => {
		const allowedExact = new Set(["miss.command.unknown"])
		for (const code of Object.values(JOYRIDE_REASON)) {
			if (allowedExact.has(code)) continue
			for (const vague of JOYRIDE_FORBIDDEN_VAGUE_REASONS) {
				assert.notEqual(code, vague, `vague reason code: ${code}`)
			}
		}
	})

	it("should not mention legacy integration module in runtime source", () => {
		const joyrideDir = path.join(REPO_ROOT, "src/core/joyride")
		const skip = new Set(["JoyRideContract.ts", "JoyRideContractDrift.test.ts", "JoyRideModernApi.test.ts"])
		const files = fs.readdirSync(joyrideDir, { recursive: true }) as string[]
		for (const file of files) {
			if (typeof file !== "string" || !file.endsWith(".ts")) continue
			const basename = path.basename(file)
			if (skip.has(basename)) continue
			const content = fs.readFileSync(path.join(joyrideDir, file), "utf8")
			assert.notInclude(content, "JoyRideIntegration", `${file} references removed JoyRideIntegration`)
		}
	})

	it("should not export decision constructors from production index", () => {
		const internalConstructors = ["hitDecision", "missDecision", "degradedDecision"]
		for (const name of internalConstructors) {
			assert.notProperty(joyride, name)
		}
	})
})
