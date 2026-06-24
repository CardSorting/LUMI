/** VS Code integration test bootstrap — path aliases, ts-node, vscode mock. */
const path = require("node:path")

process.env.INTEGRATION_TEST = "1"
process.env.TS_NODE_PROJECT = path.resolve(__dirname, "tsconfig.test.json")

require("tsconfig-paths/register")
require("ts-node/register/transpile-only")
require("./src/test/requires.cjs")

const { setVscodeHostProviderMock } = require("./src/test/host-provider-test-utils")
setVscodeHostProviderMock()
