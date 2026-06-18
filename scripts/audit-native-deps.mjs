#!/usr/bin/env node
/** Backwards-compatible alias for `npm run doctor`. */
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const doctorPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "lumi-doctor.mjs")
const result = spawnSync(process.execPath, [doctorPath, ...process.argv.slice(2)], { stdio: "inherit" })
process.exit(result.status ?? 1)
