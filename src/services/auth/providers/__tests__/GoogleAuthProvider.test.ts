import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import proxyquire from "proxyquire"
import * as sinon from "sinon"

// Mock dependencies
const mockClient = {
	generateAuthUrl: sinon.stub(),
	getToken: sinon.stub(),
	setCredentials: sinon.stub(),
	refreshAccessToken: sinon.stub(),
}

const mockHostProvider = {
	getCallbackUrl: sinon.stub().resolves("http://localhost/callback"),
}

const mockLogger = {
	error: sinon.stub(),
	info: sinon.stub(),
}

const { GoogleAuthProvider } = proxyquire("../GoogleAuthProvider", {
	"google-auth-library": {
		OAuth2Client: class {
			constructor() {
				return mockClient
			}
		},
	},
	"@/hosts/host-provider": {
		HostProvider: {
			get: () => mockHostProvider,
		},
	},
	"@/shared/services/Logger": {
		Logger: mockLogger,
	},
})

describe("GoogleAuthProvider", () => {
	let provider: any
	let sandbox: sinon.SinonSandbox
	let mockController: Record<string, any>

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		provider = new GoogleAuthProvider()

		mockController = {
			stateManager: {
				getSecretKey: sandbox.stub(),
				setSecret: sandbox.stub(),
			},
		}

		mockClient.generateAuthUrl.reset()
		mockClient.getToken.reset()
		mockClient.setCredentials.reset()
		mockClient.refreshAccessToken.reset()
		mockHostProvider.getCallbackUrl.resetHistory()
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("getAuthRequest", () => {
		it("should generate a valid Google OAuth URL", async () => {
			const expectedUrl = "https://accounts.google.com/o/oauth2/auth?..."
			mockClient.generateAuthUrl.returns(expectedUrl)

			const url = await provider.getAuthRequest("http://localhost/callback")

			url.should.equal(expectedUrl)
			sinon.assert.calledWith(
				mockClient.generateAuthUrl,
				sinon.match({
					access_type: "offline",
					prompt: "consent",
					redirect_uri: "http://localhost/callback",
				}),
			)
		})
	})

	describe("signIn", () => {
		it("should exchange code for tokens and store them", async () => {
			const authCode = "test-auth-code"
			const mockTokens = {
				id_token: "mock-id-token",
				access_token: "mock-access-token",
				refresh_token: "mock-refresh-token",
				expiry_date: Date.now() + 3600000,
			}
			mockClient.getToken.resolves({ tokens: mockTokens })

			const authInfo = await provider.signIn(mockController, authCode, "google")

			authInfo.should.not.be.null()
			authInfo.idToken.should.equal("mock-id-token")
			authInfo.refreshToken.should.equal("mock-refresh-token")

			sinon.assert.calledWith(
				mockClient.getToken,
				sinon.match({
					code: authCode,
					redirect_uri: "http://localhost/callback",
				}),
			)
			sinon.assert.calledOnce(mockController.stateManager.setSecret)
			const [secretKey, secretValue] = mockController.stateManager.setSecret.firstCall.args
			secretKey.should.equal("dietcode:googleAuthInfo")
			JSON.parse(secretValue).idToken.should.equal("mock-id-token")
		})
	})

	describe("refreshToken", () => {
		it("should refresh the access token", async () => {
			const refreshToken = "old-refresh-token"
			const storedData = { provider: "google" }

			const newTokens = {
				id_token: "new-id-token",
				access_token: "new-access-token",
				refresh_token: "new-refresh-token",
				expiry_date: Date.now() + 3600000,
			}
			mockClient.refreshAccessToken.resolves({ credentials: newTokens })

			const updatedAuthInfo = await provider.refreshToken(refreshToken, storedData)

			updatedAuthInfo.idToken.should.equal("new-id-token")
			updatedAuthInfo.refreshToken.should.equal("new-refresh-token")
			sinon.assert.calledWith(mockClient.setCredentials, sinon.match({ refresh_token: refreshToken }))
		})
	})

	describe("retrieveDietCodeAuthInfo", () => {
		it("should return null if no stored info", async () => {
			mockController.stateManager.getSecretKey.returns(null)

			const authInfo = await provider.retrieveDietCodeAuthInfo(mockController)

			should(authInfo).be.null()
		})

		it("should return stored info if not expired", async () => {
			const storedInfo = {
				idToken: "valid-token",
				expiresAt: Date.now() / 1000 + 1000, // Valid for 1000 seconds
				provider: "google",
			}
			mockController.stateManager.getSecretKey.returns(JSON.stringify(storedInfo))

			const authInfo = await provider.retrieveDietCodeAuthInfo(mockController)

			authInfo.idToken.should.equal("valid-token")
			sinon.assert.notCalled(mockClient.refreshAccessToken)
		})

		it("should refresh info if expired", async () => {
			const storedInfo = {
				idToken: "expired-token",
				refreshToken: "refresh-token",
				expiresAt: Date.now() / 1000 - 100, // Expired 100 seconds ago
				provider: "google",
			}
			mockController.stateManager.getSecretKey.returns(JSON.stringify(storedInfo))

			const newTokens = {
				id_token: "new-token",
				expiry_date: Date.now() + 3600000,
			}
			mockClient.refreshAccessToken.resolves({ credentials: newTokens })

			const authInfo = await provider.retrieveDietCodeAuthInfo(mockController)

			authInfo.idToken.should.equal("new-token")
			sinon.assert.calledOnce(mockClient.refreshAccessToken)
			sinon.assert.calledWith(mockController.stateManager.setSecret, "dietcode:googleAuthInfo", sinon.match.string)
		})
	})
})
