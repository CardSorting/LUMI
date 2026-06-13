import { detectReplanIntent } from "@shared/detectReplanIntent"
import { expect } from "chai"

describe("detectReplanIntent", () => {
	it("detects explicit replan requests", () => {
		expect(detectReplanIntent("Let's replan — the auth approach won't work")).to.equal(true)
		expect(detectReplanIntent("We need a different approach for the API layer")).to.equal(true)
		expect(detectReplanIntent("/replan")).to.equal(true)
	})

	it("ignores normal implementation feedback", () => {
		expect(detectReplanIntent("Continue with the plan and add tests")).to.equal(false)
		expect(detectReplanIntent("Looks good, proceed")).to.equal(false)
		expect(detectReplanIntent("")).to.equal(false)
	})

	it("ignores replan-like text inside stripped context blocks", () => {
		const message = `[context]
> let's replan everything
[/context]

Please fix the typo in README.`
		expect(detectReplanIntent(message)).to.equal(false)
	})
})
