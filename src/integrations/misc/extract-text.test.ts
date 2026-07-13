import { strict as assert } from "node:assert"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import { MAX_CONTENT_SIZE_BYTES } from "@/shared/content-limits"
import { extractFileContent } from "./extract-file-content"
import { callTextExtractionFunctions, type TextExtractionStats } from "./extract-text"

describe("bounded common text extraction", () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dietcode-text-read-"))
	})

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("uses one open/fstat/read path and the UTF-8 fast path", async () => {
		const filePath = path.join(tempDir, "small.ts")
		const expected = "export const value = 42\n"
		await fs.writeFile(filePath, expected)
		let stats: TextExtractionStats | undefined

		const content = await callTextExtractionFunctions(filePath, {
			onStats: (value) => {
				stats = { ...value }
			},
		})

		assert.equal(content, expected)
		assert.equal(stats?.fileOpens, 1)
		assert.equal(stats?.metadataCalls, 1)
		assert.equal(stats?.readOperations, 1)
		assert.equal(stats?.bytesRead, Buffer.byteLength(expected))
		assert.equal(stats?.utf8FastPath, true)
		assert.equal(stats?.truncated, false)
	})

	it("reads only a bounded prefix before producing a truncation envelope", async () => {
		const filePath = path.join(tempDir, "large.txt")
		const fileBytes = 2 * 1024 * 1024
		await fs.writeFile(filePath, "x".repeat(fileBytes))
		let stats: TextExtractionStats | undefined

		const content = await callTextExtractionFunctions(filePath, {
			onStats: (value) => {
				stats = { ...value }
			},
		})

		assert.match(content, /FILE TRUNCATED/)
		assert.ok(Buffer.byteLength(content, "utf8") <= MAX_CONTENT_SIZE_BYTES)
		assert.ok((stats?.bytesRead ?? fileBytes) < fileBytes)
		assert.equal(stats?.truncated, true)
		assert.equal(stats?.utf8FastPath, true)
	})

	it("keeps non-ASCII truncation within the UTF-8 byte envelope", async () => {
		const filePath = path.join(tempDir, "unicode.txt")
		await fs.writeFile(filePath, "😀".repeat(200_000))

		const content = await callTextExtractionFunctions(filePath)

		assert.match(content, /FILE TRUNCATED/)
		assert.ok(Buffer.byteLength(content, "utf8") <= MAX_CONTENT_SIZE_BYTES)
		assert.doesNotMatch(content, /�/)
	})

	it("preserves the read_file missing-file contract without a preflight access call", async () => {
		const missingPath = path.join(tempDir, "missing.txt")
		await assert.rejects(extractFileContent(missingPath, false), new RegExp(`File not found: ${missingPath}`))
	})

	it("settles pre-aborted reads before opening the file", async () => {
		const filePath = path.join(tempDir, "cancelled.txt")
		await fs.writeFile(filePath, "content")
		const controller = new AbortController()
		controller.abort()
		let stats: TextExtractionStats | undefined

		await assert.rejects(
			callTextExtractionFunctions(filePath, {
				signal: controller.signal,
				onStats: (value) => {
					stats = { ...value }
				},
			}),
			(error: Error) => error.name === "AbortError",
		)
		assert.equal(stats?.fileOpens, 0)
	})

	it("preserves the task cancellation reason after the first bytes arrive", async () => {
		const filePath = path.join(tempDir, "cancel-after-read.txt")
		await fs.writeFile(filePath, "content")
		const controller = new AbortController()
		const reason = new Error("task stopped")
		reason.name = "AbortError"

		await assert.rejects(
			extractFileContent(filePath, false, {
				signal: controller.signal,
				onFirstBytes: () => controller.abort(reason),
			}),
			(error: Error) => error === reason,
		)
	})
})
