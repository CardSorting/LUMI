import * as path from "node:path"

const REPO_ROOT = process.cwd()
const JOYRIDE_PKG_ROOT = path.join(REPO_ROOT, "src/core/joyride")
const JOYRIDE_TEST_DIR = path.join(JOYRIDE_PKG_ROOT, "__tests__")

export { JOYRIDE_TEST_DIR, JOYRIDE_PKG_ROOT, REPO_ROOT }
