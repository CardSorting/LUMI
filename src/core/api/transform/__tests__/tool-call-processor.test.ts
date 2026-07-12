import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import type { ChatCompletionChunk } from "openai/resources/chat/completions"
import { ToolCallProcessor } from "../tool-call-processor"

type ToolCallDelta = ChatCompletionChunk.Choice.Delta.ToolCall

describe("ToolCallProcessor", () => {
	it("keeps interleaved sibling ids and names isolated by tool-call index", () => {
		const processor = new ToolCallProcessor()

		assert.deepEqual(
			[
				...processor.processToolCallDeltas([
					{ index: 0, id: "call-read", function: { name: "read_file" } } as ToolCallDelta,
					{ index: 1, id: "call-search", function: { name: "search_files" } } as ToolCallDelta,
				]),
			],
			[],
		)

		const searchChunk = [
			...processor.processToolCallDeltas([{ index: 1, function: { arguments: '{"query":"needle"}' } } as ToolCallDelta]),
		][0]
		const readChunk = [
			...processor.processToolCallDeltas([
				{ index: 0, function: { arguments: '{"path":"src/index.ts"}' } } as ToolCallDelta,
			]),
		][0]

		assert.equal(searchChunk.tool_call.call_id, "call-search")
		assert.equal(searchChunk.tool_call.function.id, "call-search")
		assert.equal(searchChunk.tool_call.function.name, "search_files")
		assert.equal(searchChunk.tool_call.function.arguments, '{"query":"needle"}')

		assert.equal(readChunk.tool_call.call_id, "call-read")
		assert.equal(readChunk.tool_call.function.id, "call-read")
		assert.equal(readChunk.tool_call.function.name, "read_file")
		assert.equal(readChunk.tool_call.function.arguments, '{"path":"src/index.ts"}')

		assert.deepEqual(processor.getState(0), { id: "call-read", name: "read_file" })
		assert.deepEqual(processor.getState(1), { id: "call-search", name: "search_files" })
	})

	it("clears every sibling state when reset", () => {
		const processor = new ToolCallProcessor()
		;[
			...processor.processToolCallDeltas([
				{ index: 0, id: "call-a", function: { name: "read_file" } } as ToolCallDelta,
				{ index: 1, id: "call-b", function: { name: "list_files" } } as ToolCallDelta,
			]),
		]

		processor.reset()

		assert.deepEqual(processor.getState(0), { id: "", name: "" })
		assert.deepEqual(processor.getState(1), { id: "", name: "" })
	})
})
