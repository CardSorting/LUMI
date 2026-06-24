interface JoyrideTestPaths {
	JOYRIDE_TEST_DIR: string
	JOYRIDE_PKG_ROOT: string
	REPO_ROOT: string
}

// CJS shim so mocha/ts-node can load __dirname-based paths on Linux while tsc type-checks cleanly.
const paths = require("./paths.cjs") as JoyrideTestPaths

export const JOYRIDE_TEST_DIR = paths.JOYRIDE_TEST_DIR
export const JOYRIDE_PKG_ROOT = paths.JOYRIDE_PKG_ROOT
export const REPO_ROOT = paths.REPO_ROOT
