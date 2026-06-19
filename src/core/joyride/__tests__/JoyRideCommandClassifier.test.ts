/**
 * [LAYER: CORE]
 * Strict command classifier regression tests.
 */

import { assert } from "chai"
import { canCommandSkipExecution, classifyCommand } from "../JoyRideCommandClassifier"

describe("JoyRideCommandClassifier", () => {
	describe("safe read-only allowlist", () => {
		it("should allow pwd and git status skip", () => {
			assert.isTrue(canCommandSkipExecution("pwd"))
			assert.isTrue(canCommandSkipExecution("git status"))
			assert.isTrue(canCommandSkipExecution("git rev-parse HEAD"))
			assert.isTrue(canCommandSkipExecution("git diff --stat"))
		})

		it("should reject unknown commands from active reuse", () => {
			const result = classifyCommand("my-unknown-binary --foo")
			assert.equal(result.tier, "diagnostic-store-only")
			assert.isFalse(result.canSkipExecution)
			assert.isTrue(result.canStoreDiagnostic)
		})
	})

	describe("unsafe patterns", () => {
		it("should reject redirects", () => {
			assert.isFalse(canCommandSkipExecution("echo hello > out.txt"))
		})

		it("should reject pipes", () => {
			assert.isFalse(canCommandSkipExecution("git status | grep foo"))
		})

		it("should reject chained commands with semicolon", () => {
			assert.isFalse(canCommandSkipExecution("pwd; rm -rf /"))
		})

		it("should reject chained commands with &&", () => {
			assert.isFalse(canCommandSkipExecution("git status && npm test"))
		})

		it("should reject subshells", () => {
			assert.isFalse(canCommandSkipExecution("echo $(whoami)"))
		})

		it("should reject env var mutation", () => {
			assert.isFalse(canCommandSkipExecution("export FOO=bar"))
		})

		it("should reject package manager install", () => {
			assert.isFalse(canCommandSkipExecution("npm install lodash"))
			assert.isFalse(canCommandSkipExecution("pnpm install"))
		})

		it("should reject git mutation commands", () => {
			assert.isFalse(canCommandSkipExecution("git commit -m test"))
			assert.isFalse(canCommandSkipExecution("git checkout main"))
		})

		it("should reject network commands", () => {
			assert.isFalse(canCommandSkipExecution("curl https://example.com"))
		})

		it("should reject npm run build", () => {
			assert.isFalse(canCommandSkipExecution("npm run build"))
		})

		it("should reject timestamp/random output commands", () => {
			assert.isFalse(canCommandSkipExecution("date"))
		})
	})

	describe("verification tier", () => {
		it("should store verification diagnostically but not skip without proof", () => {
			const result = classifyCommand("npm test")
			assert.equal(result.tier, "verification")
			assert.isFalse(result.canSkipExecution)
			assert.isTrue(result.canStoreDiagnostic)
		})
	})

	describe("shell and platform edge cases", () => {
		it("should reject relative binary paths", () => {
			assert.isFalse(canCommandSkipExecution("./git status"))
			assert.isFalse(canCommandSkipExecution("../bin/pwd"))
		})

		it("should reject command substitution and backticks even inside quotes", () => {
			assert.isFalse(canCommandSkipExecution('echo "$(whoami)"'))
			assert.isFalse(canCommandSkipExecution("echo `date`"))
		})

		it("should reject env assignment prefixes", () => {
			assert.isFalse(canCommandSkipExecution("FOO=bar git status"))
		})

		it("should reject npm run custom scripts as unknown", () => {
			const result = classifyCommand("npm run deploy")
			assert.equal(result.tier, "diagnostic-store-only")
			assert.isFalse(result.canSkipExecution)
		})

		it("should reject quoted pipe operators hiding mutation", () => {
			assert.isFalse(canCommandSkipExecution('git status "| rm -rf /"'))
		})

		it("should reject escaped pipe variants", () => {
			assert.isFalse(canCommandSkipExecution("git status \\| wc -l"))
		})

		it("should reject quoted redirect variants", () => {
			assert.isFalse(canCommandSkipExecution('echo "hello" > out.txt'))
			assert.isFalse(canCommandSkipExecution("echo 'hello' > out.txt"))
		})

		it("should reject || chaining", () => {
			assert.isFalse(canCommandSkipExecution("false || rm -rf /"))
		})

		it("should reject backtick command substitution", () => {
			assert.isFalse(canCommandSkipExecution("echo `whoami`"))
		})

		it("should reject path-prefixed binaries", () => {
			assert.isFalse(canCommandSkipExecution("/usr/bin/git status"))
			assert.isFalse(canCommandSkipExecution("./node_modules/.bin/eslint ."))
		})
	})
})
