import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import proxyquire from "proxyquire"
import * as sinon from "sinon"

// Mock dependencies
const mockAuthService = {
	getAuthToken: sinon.stub(),
}

const { GooglePersonalHandler } = proxyquire("../google-personal", {
	"@/services/auth/AuthService": {
		AuthService: {
			getInstance: () => mockAuthService,
		},
	},
	"@/shared/services/Logger": {
		Logger: {
			error: sinon.stub(),
		},
	},
})

describe("GooglePersonalHandler", () => {
	let handler: any
	let sandbox: sinon.SinonSandbox
	let originalFetch: typeof global.fetch

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		handler = new GooglePersonalHandler({
			apiModelId: "gemini-1.5-pro",
		})

		// Setup fetch mock
		originalFetch = global.fetch
		global.fetch = sandbox.stub() as unknown as typeof global.fetch

		mockAuthService.getAuthToken.resolves("fake-google-token")
	})

	afterEach(() => {
		sandbox.restore()
		global.fetch = originalFetch
	})

	describe("createMessage", () => {
		it("should inject authorization header and format request correctly", async () => {
			const mockResponse = {
				ok: true,
				body: {
					getReader: () => ({
						read: sandbox
							.stub()
							.onFirstCall()
							.resolves({
								done: false,
								value: new TextEncoder().encode(
									'data: {"response": {"candidates": [{"content": {"parts": [{"text": "Hello"}]}}]}}\n',
								),
							})
							.onSecondCall()
							.resolves({ done: true }),
						releaseLock: sandbox.stub(),
					}),
				},
			}
			;(global.fetch as sinon.SinonStub).resolves(mockResponse)

			const generator = handler.createMessage("System prompt", [
				{ role: "user", content: [{ type: "text", text: "User prompt" }] },
			])
			const results = []
			for await (const chunk of generator) {
				results.push(chunk)
			}

			results.length.should.be.greaterThan(0)
			results[0].text.should.equal("Hello")

			const [url, options] = (global.fetch as sinon.SinonStub).firstCall.args
			url.should.containEql("streamGenerateContent")
			options.headers.Authorization.should.equal("Bearer fake-google-token")

			const body = JSON.parse(options.body)
			body.model.should.equal("gemini-1.5-pro")
			body.request.contents[0].parts[0].text.should.equal("User prompt")
		})

		it("should handle usage metadata in the stream", async () => {
			const mockResponse = {
				ok: true,
				body: {
					getReader: () => ({
						read: sandbox
							.stub()
							.onFirstCall()
							.resolves({
								done: false,
								value: new TextEncoder().encode(
									'data: {"response": {"candidates": [], "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 20}}}\n',
								),
							})
							.onSecondCall()
							.resolves({ done: true }),
						releaseLock: sandbox.stub(),
					}),
				},
			}
			;(global.fetch as sinon.SinonStub).resolves(mockResponse)

			const generator = handler.createMessage("System", [{ role: "user", content: [{ type: "text", text: "Test" }] }])
			const results = []
			for await (const chunk of generator) {
				results.push(chunk)
			}

			const usage = results.find((r) => r.type === "usage")
			usage.should.not.be.undefined()
			usage.inputTokens.should.equal(10)
			usage.outputTokens.should.equal(20)
		})

		it("should throw error if not authenticated", async () => {
			mockAuthService.getAuthToken.resolves(null)

			const generator = handler.createMessage("System", [])

			try {
				await generator.next()
				should.fail("", "", "Should have thrown an error", "")
			} catch (error: unknown) {
				const err = error as Error
				err.message.should.containEql("signed in with Google")
			}
		})

		it("should handle SSE chunks split across multiple packets", async () => {
			const reader = {
				read: sandbox.stub(),
				releaseLock: sandbox.stub(),
			}
			reader.read.onCall(0).resolves({
				done: false,
				value: new TextEncoder().encode('data: {"response": {"candidates": [{"content": {"parts": [{"text": "He"}]}}]}}'),
			})
			reader.read.onCall(1).resolves({
				done: false,
				value: new TextEncoder().encode(
					'\ndata: {"response": {"candidates": [{"content": {"parts": [{"text": "llo"}]}}]}}\n',
				),
			})
			reader.read.onCall(2).resolves({ done: true })

			const mockResponse = {
				ok: true,
				body: {
					getReader: () => reader,
				},
			}
			;(global.fetch as sinon.SinonStub).resolves(mockResponse)

			const generator = handler.createMessage("System", [])
			const results = []
			for await (const chunk of generator) {
				if (chunk.type === "text") results.push(chunk.text)
			}

			results.join("").should.equal("Hello")
		})
	})
})
