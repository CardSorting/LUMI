const Module = require("module")
const originalRequire = Module.prototype.require

/**
 * VSCode is not available during unit tests
 * @see {@link file://./vscode-mock.ts}
 */
Module.prototype.require = function (path) {
	if (path === "vscode") {
		return require("./vscode-mock")
	}
	// Avoid pulling in VSCode-integrated checkpoint/editor code during unit tests
	if (path === "@integrations/checkpoints") {
		return {}
	}
	if (path === "@integrations/checkpoints/MultiRootCheckpointManager") {
		return { MultiRootCheckpointManager: class {} }
	}
	// Unit-test-only mocks — integration tests need real grpc-handler and protobus wiring.
	if (!process.env.INTEGRATION_TEST) {
		if (path.endsWith("generated/hosts/vscode/protobus-services") || path.endsWith("protobus-services.ts")) {
			return { serviceHandlers: {} }
		}
		if (path.endsWith("core/controller/grpc-handler") || path.endsWith("grpc-handler.ts")) {
			return {
				getRequestRegistry: () => ({
					registerRequest: () => {},
					cancelRequest: () => true,
					hasRequest: () => false,
					getRequestInfo: () => undefined,
				}),
			}
		}
	}

	return originalRequire.call(this, path)
}

function toPosixPath(p) {
	return p.replace(/\\/g, "/")
}

if (!String.prototype.toPosix) {
	String.prototype.toPosix = function () {
		return toPosixPath(this)
	}
}
