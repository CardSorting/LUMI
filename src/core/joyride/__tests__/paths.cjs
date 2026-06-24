"use strict"

const path = require("node:path")

const JOYRIDE_TEST_DIR = __dirname
const JOYRIDE_PKG_ROOT = path.resolve(__dirname, "..")
const REPO_ROOT = path.resolve(__dirname, "../../../..")

module.exports = { JOYRIDE_TEST_DIR, JOYRIDE_PKG_ROOT, REPO_ROOT }
