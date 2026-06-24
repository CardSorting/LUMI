/** VS Code integration test bootstrap — path aliases, ts-node, vscode mock. */
const path = require("node:path")
const tsConfigPaths = require("tsconfig-paths")

process.env.INTEGRATION_TEST = "1"
process.env.TS_NODE_PROJECT = path.resolve(__dirname, "tsconfig.test.json")

// Compiled tests under out/ import @/ aliases; default tsconfig paths resolve to src/ and
// create a second HostProvider singleton. Point aliases at out/src for integration runs.
const projectRoot = __dirname
const loadResult = tsConfigPaths.loadConfig(path.join(projectRoot, "tsconfig.json"))
if (loadResult.resultType === "success") {
	const remapToOut = (aliasPaths) =>
		Object.fromEntries(
			Object.entries(aliasPaths).map(([key, values]) => [
				key,
				values.map((value) => value.replace(/^\.\/src\//, "./out/src/")),
			]),
		)
	tsConfigPaths.register({
		baseUrl: loadResult.absoluteBaseUrl,
		paths: remapToOut(loadResult.paths),
	})
} else {
	require("tsconfig-paths/register")
}

require("ts-node/register/transpile-only")
require("./src/test/requires.cjs")

const { setVscodeHostProviderMock } = require("./out/src/test/host-provider-test-utils")
const { HostProvider } = require("./out/src/hosts/host-provider")

setVscodeHostProviderMock()

// Re-init only when a prior test called HostProvider.reset().
exports.mochaHooks = {
	beforeEach() {
		if (!HostProvider.isInitialized()) {
			setVscodeHostProviderMock()
		}
	},
}
