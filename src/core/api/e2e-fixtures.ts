/** Shared canned LLM responses for E2E (HTTP mock server + in-process handler). */

const EDIT_REQUEST = `<thinking>
The user wants me to replace the name "john" with "dietcode" in the test.ts file. I can see the file content provided:

\`\`\`typescript
export const name = "john"
\`\`\`

I need to change "john" to "dietcode". This is a simple targeted edit, so I should use the replace_in_file tool rather than write_to_file since I'm only changing one small part of the file.

I need to:
1. Use replace_in_file to change "john" to "dietcode" in the test.ts file
2. The SEARCH block should match the exact content: \`export const name = "john"\`
3. The REPLACE block should be: \`export const name = "dietcode"\`
</thinking>

I'll replace "john" with "dietcode" in the test.ts file.

<replace_in_file>
<path>test.ts</path>
<diff>
------- SEARCH
export const name = "john"
=======
export const name = "dietcode"
+++++++ REPLACE
</diff>
</replace_in_file>`

/** Plain acknowledgment after replace_in_file — no attempt_completion (avoids sqlite in E2E). */
const POST_EDIT_ACK = 'I successfully replaced "john" with "dietcode" in the test.ts file. The change has been completed.'

const REPLACE_IN_FILE_RESULT_MARKER = "[replace_in_file for 'test.ts'] Result:"

export const E2E_MOCK_API_RESPONSES = {
	DEFAULT: "Hello! I'm a mock DietCode API response.",
	POST_EDIT_ACK,
	EDIT_REQUEST,
	/** @deprecated Use POST_EDIT_ACK — kept for tests that referenced the old name */
	REPLACE_REQUEST: POST_EDIT_ACK,
} as const

type MockMessage = { role?: string; content?: unknown }

function serializeMessages(messages: MockMessage[]): string {
	return JSON.stringify(messages)
}

export function conversationHasReplaceInFileResult(messages: MockMessage[]): boolean {
	return serializeMessages(messages).includes(REPLACE_IN_FILE_RESULT_MARKER)
}

function extractTextFromContent(content: unknown): string {
	if (typeof content === "string") {
		return content
	}
	if (Array.isArray(content)) {
		return content
			.filter((part): part is { type?: string; text?: string } => typeof part === "object" && part !== null)
			.filter((part) => part.type === "text" && typeof part.text === "string")
			.map((part) => part.text as string)
			.join("")
	}
	return ""
}

/** Last user-authored text in the conversation (ignores tool-result user turns). */
export function getLastUserText(messages: MockMessage[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]
		if (message.role !== "user") {
			continue
		}
		const text = extractTextFromContent(message.content)
		if (text) {
			return text
		}
	}
	return undefined
}

export function resolveE2EMockResponse(messages: MockMessage[]): string {
	// After the file edit tool runs, return plain text only — never attempt_completion
	// (completion loads native sqlite and loops on ABI mismatch in the E2E extension host).
	if (conversationHasReplaceInFileResult(messages)) {
		return E2E_MOCK_API_RESPONSES.POST_EDIT_ACK
	}

	const lastUserText = getLastUserText(messages)
	if (lastUserText?.includes("edit_request")) {
		return E2E_MOCK_API_RESPONSES.EDIT_REQUEST
	}

	return E2E_MOCK_API_RESPONSES.DEFAULT
}
