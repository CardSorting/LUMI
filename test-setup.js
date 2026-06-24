/** VS Code integration test bootstrap — path aliases, ts-node, vscode mock. */
process.env.TS_NODE_PROJECT = process.env.TS_NODE_PROJECT || "./tsconfig.test.json"
require("tsconfig-paths/register")
require("ts-node/register/transpile-only")
require("./src/test/requires.cjs")
