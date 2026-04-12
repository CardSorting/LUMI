import { describe, it } from "mocha"
import "should"
import { CodemarieStorageMessage } from "../../../../shared/messages/content"
import { convertAnthropicMessageToGemini } from "../gemini-format"

describe("Gemini Format Conversion", () => {
	it("should preserve signature when model IDs match", () => {
		const message: CodemarieStorageMessage = {
			role: "assistant",
			content: [
				{
					type: "thinking",
					thinking: "Thinking content",
					signature: "original-sig",
				} as any,
			],
			modelInfo: {
				modelId: "gemini-3.1-pro-preview",
				providerId: "gemini",
				mode: "plan",
			},
		}

		const result = convertAnthropicMessageToGemini(message, "gemini-3.1-pro-preview")

		result.parts?.[0].thoughtSignature?.should.equal("original-sig")
	})

	it("should replace signature with dummy when model IDs differ", () => {
		const message: CodemarieStorageMessage = {
			role: "assistant",
			content: [
				{
					type: "thinking",
					thinking: "Thinking content",
					signature: "old-model-sig",
				} as any,
			],
			modelInfo: {
				modelId: "gemini-2.0-flash-thinking",
				providerId: "gemini",
				mode: "plan",
			},
		}

		// Switching to a different model
		const result = convertAnthropicMessageToGemini(message, "gemini-3.1-pro-preview")

		result.parts?.[0].thoughtSignature?.should.equal("skip_thought_signature_validator")
	})

	it("should use dummy signature for tool_use if no signature is present", () => {
		const message: CodemarieStorageMessage = {
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "call_123",
					name: "read_file",
					input: { path: "test.ts" },
				} as any,
			],
		}

		const result = convertAnthropicMessageToGemini(message, "gemini-3.1-pro-preview")

		result.parts?.[0].thoughtSignature?.should.equal("skip_thought_signature_validator")
	})

	it("should handle text blocks with signatures during model switches", () => {
		const message: CodemarieStorageMessage = {
			role: "assistant",
			content: [
				{
					type: "text",
					text: "Some text",
					signature: "old-sig",
				} as any,
			],
			modelInfo: {
				modelId: "old-model",
				providerId: "gemini",
				mode: "plan",
			},
		}

		const result = convertAnthropicMessageToGemini(message, "new-model")

		result.parts?.[0].thoughtSignature?.should.equal("skip_thought_signature_validator")
	})
})
