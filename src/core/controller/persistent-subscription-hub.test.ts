import { expect } from "chai"
import { describe, it } from "mocha"
import type { StreamingResponseHandler } from "./grpc-handler-types"
import { disposeAllPersistentSubscriptionHubs, PersistentSubscriptionHub } from "./persistent-subscription-hub"

describe("PersistentSubscriptionHub closeout", () => {
	it("isolates fanout failures and prunes dead subscribers", async () => {
		const hub = new PersistentSubscriptionHub<{ value: number }>("test")
		const healthy: StreamingResponseHandler<{ value: number }> = async () => {}
		const broken: StreamingResponseHandler<{ value: number }> = async () => {
			throw new Error("broken stream")
		}

		hub.register(healthy, undefined)
		hub.register(broken, undefined)

		const result = await hub.broadcast({ value: 1 })
		expect(result.delivered).to.equal(1)
		expect(result.pruned).to.equal(1)
		expect(result.failed).to.equal(1)
		expect(hub.size).to.equal(1)
	})

	it("continues delivery when one subscriber throws", async () => {
		const hub = new PersistentSubscriptionHub<string>("delivery")
		const delivered: string[] = []

		hub.register(async () => {
			throw new Error("first broken")
		}, undefined)
		hub.register(async (msg) => {
			delivered.push(String(msg))
		}, undefined)

		const result = await hub.broadcast("payload")
		expect(result.delivered).to.equal(1)
		expect(result.pruned).to.equal(1)
		expect(delivered).to.deep.equal(["payload"])
	})

	it("clears all hubs on extension shutdown dispose", () => {
		const hubA = new PersistentSubscriptionHub<null>("a")
		const hubB = new PersistentSubscriptionHub<null>("b")
		hubA.register(async () => {}, undefined)
		hubB.register(async () => {}, undefined)

		expect(hubA.size).to.equal(1)
		expect(hubB.size).to.equal(1)

		disposeAllPersistentSubscriptionHubs()
		expect(hubA.size).to.equal(0)
		expect(hubB.size).to.equal(0)
	})
})
