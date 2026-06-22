import { expect } from "chai"
import { describe, it } from "mocha"
import { GrpcRequestRegistry } from "./grpc-request-registry"

describe("GrpcRequestRegistry closeout", () => {
	it("chains cleanup handlers when the same request is registered twice", () => {
		const registry = new GrpcRequestRegistry()
		const calls: string[] = []
		registry.registerRequest("req-1", () => calls.push("first"))
		registry.registerRequest("req-1", () => calls.push("second"))

		registry.cancelRequest("req-1")

		expect(calls).to.deep.equal(["first", "second"])
		expect(registry.hasRequest("req-1")).to.be.false
	})

	it("cancel is idempotent for unknown requests", () => {
		const registry = new GrpcRequestRegistry()
		expect(registry.cancelRequest("missing")).to.be.false
		expect(registry.cancelRequest("missing")).to.be.false
	})

	it("dispose cancels all registered requests", () => {
		const registry = new GrpcRequestRegistry()
		let cleaned = 0
		registry.registerRequest("a", () => {
			cleaned += 1
		})
		registry.registerRequest("b", () => {
			cleaned += 1
		})

		registry.dispose()
		expect(cleaned).to.equal(2)
		expect(registry.getAllRequests()).to.have.length(0)
	})
})
