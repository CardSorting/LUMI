import "should"
import { E2EMockOpenRouterHandler } from "../e2e-mock-openrouter"

describe("E2EMockOpenRouterHandler", () => {
	it("returns replace_in_file XML when the user message is edit_request", async () => {
		const handler = new E2EMockOpenRouterHandler({})
		const chunks: unknown[] = []

		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "edit_request" }])) {
			chunks.push(chunk)
		}

		const textChunk = chunks.find((c) => (c as { type?: string }).type === "text") as { text?: string }
		textChunk.text?.should.containEql("<replace_in_file>")
		textChunk.text?.should.containEql("test.ts")
		textChunk.text?.should.not.containEql("<attempt_completion>")
		chunks.some((c) => (c as { type?: string }).type === "usage").should.equal(true)
	})

	it("returns plain acknowledgment after replace_in_file tool result", async () => {
		const handler = new E2EMockOpenRouterHandler({})
		const chunks: unknown[] = []

		for await (const chunk of handler.createMessage("system", [
			{ role: "user", content: "edit_request" },
			{ role: "assistant", content: "<replace_in_file>...</replace_in_file>" },
			{
				role: "user",
				content: "[replace_in_file for 'test.ts'] Result:\nThe content was successfully saved to test.ts.",
			},
		])) {
			chunks.push(chunk)
		}

		const textChunk = chunks.find((c) => (c as { type?: string }).type === "text") as { text?: string }
		textChunk.text?.should.not.containEql("<attempt_completion>")
		textChunk.text?.should.not.containEql("<replace_in_file>")
	})
})
