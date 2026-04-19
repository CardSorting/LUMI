import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import proxyquire from "proxyquire"
import * as sinon from "sinon"

// --- Global Setup ---
// Some files depend on String.prototype extensions defined in src/utils/path
// We mock it here if needed, but for these tests we'll try to avoid it.

// --- Mocks ---
const mockClient = {
	generateAuthUrl: sinon.stub(),
	getToken: sinon.stub(),
	setCredentials: sinon.stub(),
	refreshAccessToken: sinon.stub(),
}

const mockHostProvider = {
	get: () => ({
		getCallbackUrl: sinon.stub().resolves("http://localhost/callback"),
	}),
}

const mockLogger = {
	error: sinon.stub(),
	info: sinon.stub(),
	log: sinon.stub(),
	warn: sinon.stub(),
}

const mockAuthServiceInstance = {
	getAuthToken: sinon.stub(),
	createAuthRequest: sinon.stub().resolves({ value: "http://google.com/auth" }),
}

// --- Proxyquired Components ---

// We mock almost everything that could pull in VSCode or Protobus
const stubs = {
	"google-auth-library": {
		OAuth2Client: () => mockClient,
	},
	"@/hosts/host-provider": {
		HostProvider: mockHostProvider,
	},
	"@/shared/services/Logger": {
		Logger: mockLogger,
	},
	"@/services/auth/AuthService": {
		AuthService: {
			getInstance: () => mockAuthServiceInstance,
		},
	},
	"@/core/controller/grpc-handler": {
		getRequestRegistry: () => ({
			registerRequest: () => {},
			cancelRequest: () => true,
		}),
	},
	vscode: {
		window: {
			showErrorMessage: sinon.stub(),
			showInformationMessage: sinon.stub(),
		},
		env: {
			asExternalUri: sinon.stub().callsFake((uri) => uri),
		},
		Uri: {
			parse: (url: string) => ({ toString: () => url }),
		},
		EventEmitter: class {
			event = sinon.stub()
			fire = sinon.stub()
		},
	},
}

const { GoogleAuthProvider } = proxyquire("../../services/auth/providers/GoogleAuthProvider", stubs)
const { GooglePersonalHandler } = proxyquire("../../core/api/providers/google-personal", stubs)
const { googleAuthClicked } = proxyquire("../../core/controller/account/googleAuthClicked", stubs)

describe("Google Personal Provider: Self-Contained Test Suite", () => {
	let sandbox: sinon.SinonSandbox
	let originalFetch: any

	beforeEach(() => {
		sandbox = sinon.createSandbox()

		// Reset all mocks
		mockClient.generateAuthUrl.reset()
		mockClient.getToken.reset()
		mockClient.refreshAccessToken.reset()
		mockAuthServiceInstance.getAuthToken.reset()
		mockAuthServiceInstance.createAuthRequest.reset()

		// Mock Global Fetch
		originalFetch = global.fetch
		global.fetch = sandbox.stub() as any
	})

	afterEach(() => {
		sandbox.restore()
		global.fetch = originalFetch
	})

	describe("Part 1: GoogleAuthProvider (OAuth Logic)", () => {
		it("should generate a valid Auth Request URL", async () => {
			const provider = new GoogleAuthProvider()
			mockClient.generateAuthUrl.returns("https://google.com/auth")

			const url = await provider.getAuthRequest("http://callback")
			url.should.equal("https://google.com/auth")
		})

		it("should exchange code for tokens in signIn", async () => {
			const provider = new GoogleAuthProvider()
			const mockTokens = { id_token: "id", access_token: "access", expiry_date: 12345 }
			mockClient.getToken.resolves({ tokens: mockTokens })

			const mockController = {
				stateManager: { setSecret: sandbox.stub(), getSecretKey: sandbox.stub() },
			}

			const info = await provider.signIn(mockController, "code", "google")
			info.idToken.should.equal("id")
			sinon.assert.calledWith(mockController.stateManager.setSecret, "dietcode:googleAuthInfo", sinon.match.string)
		})
	})

	describe("Part 2: GooglePersonalHandler (API & Streaming)", () => {
		it("should include Authorization header and parse streamed text", async () => {
			const handler = new GooglePersonalHandler({ apiModelId: "gemini-1.5-flash" })
			mockAuthServiceInstance.getAuthToken.resolves("fake-token")

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
									'data: {"response": {"candidates": [{"content": {"parts": [{"text": "Hello World"}]}}]}}\n',
								),
							})
							.onSecondCall()
							.resolves({ done: true }),
						releaseLock: sandbox.stub(),
					}),
				},
			}
			;(global.fetch as sinon.SinonStub).resolves(mockResponse)

			const stream = handler.createMessage("System", [{ role: "user", content: [{ type: "text", text: "Hi" }] }])
			const messages = []
			for await (const msg of stream) {
				if (msg.type === "text") messages.push(msg.text)
			}

			messages.join("").should.equal("Hello World")
			const [, options] = (global.fetch as sinon.SinonStub).firstCall.args
			options.headers["Authorization"].should.equal("Bearer fake-token")
		})
	})

	describe("Part 3: RPC Handler (Integration Bridge)", () => {
		it("should call createAuthRequest with 'google' provider", async () => {
			const mockController: any = {}
			await googleAuthClicked(mockController, {})

			sinon.assert.calledWith(mockAuthServiceInstance.createAuthRequest, false, "google")
		})
	})
})
