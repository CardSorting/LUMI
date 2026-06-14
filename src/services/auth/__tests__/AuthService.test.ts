import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import * as sinon from "sinon"
import { AuthService } from "../AuthService"

describe("AuthService Multi-Session", () => {
	let sandbox: sinon.SinonSandbox
	let mockController: Record<string, unknown>

	beforeEach(() => {
		sandbox = sinon.createSandbox()

		mockController = {
			stateManager: {
				getSecretKey: sandbox.stub(),
				setSecret: sandbox.stub(),
			},
			postStateToWebview: sandbox.stub().resolves(),
		}
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("should manage simultaneous logins for different providers", async () => {
		const service = new (AuthService as unknown as new (controller: unknown) => AuthService)(mockController)

		const providers = (service as unknown as { _providers: Map<string, { getAccessToken: () => Promise<string> }> })
			._providers
		const dietcodeProvider = providers.get("dietcode")
		const googleProvider = providers.get("google")

		sandbox.stub(dietcodeProvider!, "getAccessToken").resolves("dietcode-token")
		sandbox.stub(googleProvider!, "getAccessToken").resolves("google-token")

		const serviceState = service as unknown as {
			_dietcodeAuthInfo: { idToken: string; provider: string; expiresAt: number }
			_authenticated: boolean
		}
		serviceState._dietcodeAuthInfo = {
			idToken: "dietcode-token",
			provider: "dietcode",
			expiresAt: Date.now() / 1000 + 3600,
		}
		serviceState._authenticated = true

		const dietcodeToken = await service.getAuthToken("dietcode")
		const googleToken = await service.getAuthToken("google")

		dietcodeToken!.should.containEql("dietcode-token")
		googleToken!.should.equal("google-token")
	})
})
