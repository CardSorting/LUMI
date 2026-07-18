import assert from "node:assert/strict"
import { describe, it } from "mocha"
import { resolveCarriageReturns, stripAnsi } from "./ansiUtils"

describe("terminal ANSI utilities", () => {
	it("strips ANSI styling without changing text", () => {
		assert.equal(stripAnsi("\u001b[31mfailed\u001b[0m"), "failed")
	})

	it("resolves terminal carriage-return overwrites", () => {
		assert.equal(resolveCarriageReturns("Downloading 1%\rDownloading 100%"), "Downloading 100%")
		assert.equal(resolveCarriageReturns("abcdef\rxy"), "xycdef")
		assert.equal(resolveCarriageReturns("first\rfinal\nnext\rline"), "final\nline")
	})

	it("returns ordinary output unchanged", () => {
		assert.equal(resolveCarriageReturns("line one\nline two"), "line one\nline two")
	})
})
