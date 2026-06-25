import "should"
import {
	conversationHasReplaceInFileResult,
	E2E_MOCK_API_RESPONSES,
	getLastUserText,
	resolveE2EMockResponse,
} from "../e2e-fixtures"

describe("resolveE2EMockResponse", () => {
	it("returns replace_in_file XML for the initial edit_request turn", () => {
		const response = resolveE2EMockResponse([{ role: "user", content: "edit_request" }])
		response.should.containEql("<replace_in_file>")
		response.should.not.containEql("<attempt_completion>")
	})

	it("returns plain acknowledgment after replace_in_file tool result (no attempt_completion)", () => {
		const messages = [
			{ role: "user", content: "edit_request" },
			{ role: "assistant", content: "<replace_in_file>...</replace_in_file>" },
			{
				role: "user",
				content: "[replace_in_file for 'test.ts'] Result:\nThe content was successfully saved to test.ts.",
			},
		]

		conversationHasReplaceInFileResult(messages).should.equal(true)
		const response = resolveE2EMockResponse(messages)
		response.should.equal(E2E_MOCK_API_RESPONSES.POST_EDIT_ACK)
		response.should.not.containEql("<attempt_completion>")
	})

	it("does not re-issue edit_request when history still contains edit_request after tool result", () => {
		const messages = [
			{ role: "user", content: "edit_request" },
			{ role: "assistant", content: "done" },
			{
				role: "user",
				content: "[replace_in_file for 'test.ts'] Result:\nok",
			},
		]

		resolveE2EMockResponse(messages).should.equal(E2E_MOCK_API_RESPONSES.POST_EDIT_ACK)
		resolveE2EMockResponse(messages).should.not.containEql("<replace_in_file>")
	})

	it("getLastUserText returns the most recent user text", () => {
		const last = getLastUserText([
			{ role: "user", content: "edit_request" },
			{ role: "assistant", content: "working" },
			{ role: "user", content: "follow up" },
		])
		last?.should.equal("follow up")
	})
})
