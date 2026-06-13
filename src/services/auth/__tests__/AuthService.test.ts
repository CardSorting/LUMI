import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import * as sinon from "sinon"
import { AuthService } from "../AuthService"

describe("AuthService Multi-Session", () => {
	let sandbox: sinon.SinonSandbox
	let mockController: Record<string, any>

	beforeEach(() => {
		sandbox = sinon.createSandbox()

		mockController = {
			stateManager: {
				getSecretKey: sandbox.stub(),
				setSecret: sandbox.stub(),
			},
			postStateToWebview: sandbox.stub().resolves(),
		}

		// We need to inject mocks into the providers map
		// AuthService constructor creates new instances, so we might need proxyquire
		// to mock the provider classes OR use setter if available.
		// Looking at AuthService.ts, providers are private.
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("should manage simultaneous logins for different providers", async () => {
		// Since AuthService is a singleton, we should be careful with isolation
		// For testing we will create a fresh instance if possible.
		const service = new (AuthService as any)(mockController)

		const providers = (service as any)._providers
		const dietcodeProvider = providers.get("dietcode")
		const googleProvider = providers.get("google")

		sandbox.stub(dietcodeProvider, "getAccessToken").resolves("dietcode-token")
		sandbox.stub(googleProvider, "getAccessToken").resolves("google-token")(
			// Initialize session state so active provider token retrieval succeeds without network refresh
			service as any,
		)._dietcodeAuthInfo = {
			idToken: "dietcode-token",
			provider: "dietcode",
			expiresAt: Date.now() / 1000 + 3600,
		}
		;(service as any)._authenticated = true

		const dietcodeToken = await service.getAuthToken("dietcode")
		const googleToken = await service.getAuthToken("google")

		dietcodeToken!.should.containEql("dietcode-token")
		googleToken!.should.equal("google-token")
	})
})
