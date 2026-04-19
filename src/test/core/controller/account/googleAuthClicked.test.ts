import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import { EmptyRequest } from "@shared/proto/dietcode/common"
import * as sinon from "sinon"
import { googleAuthClicked } from "@/core/controller/account/googleAuthClicked"
import { AuthService } from "@/services/auth/AuthService"

describe("googleAuthClicked RPC Handler", () => {
	let sandbox: sinon.SinonSandbox
	let mockAuthService: any

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		mockAuthService = {
			createAuthRequest: sandbox.stub().resolves({ value: "http://google.com/auth" }),
		}
		sandbox.stub(AuthService, "getInstance").returns(mockAuthService)
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("should trigger Google OAuth flow with provider 'google'", async () => {
		const mockController: any = {}
		const request = EmptyRequest.create()

		await googleAuthClicked(mockController, request)

		sinon.assert.calledOnce(mockAuthService.createAuthRequest)
		const [strict, providerName] = mockAuthService.createAuthRequest.firstCall.args
		strict.should.be.false()
		providerName.should.equal("google")
	})
})
