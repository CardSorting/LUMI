import "should"
import { isNativeModuleVersionMismatch, isSqlitePersistenceBypassed } from "../sqlitePersistence"

describe("sqlitePersistence", () => {
	const originalE2E = process.env.E2E_TEST

	afterEach(() => {
		if (originalE2E === undefined) {
			delete process.env.E2E_TEST
		} else {
			process.env.E2E_TEST = originalE2E
		}
	})

	it("detects NODE_MODULE_VERSION mismatch errors", () => {
		isNativeModuleVersionMismatch(
			new Error("The module was compiled against NODE_MODULE_VERSION 140. This version requires NODE_MODULE_VERSION 146."),
		).should.equal(true)
	})

	it("bypasses persistence when E2E_TEST is set", () => {
		process.env.E2E_TEST = "true"
		isSqlitePersistenceBypassed().should.equal(true)
	})
})
