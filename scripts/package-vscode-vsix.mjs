#!/usr/bin/env node
/**
 * Package VS Code Marketplace VSIX as CardSorting.lumi-vscode.
 *
 * Rebuilds better-sqlite3 for Electron and verifies the native binary is
 * included before the VSIX is considered valid.
 *
 * Usage:
 *   npm run package:vsix
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assertVsixHasNativeModule, rebuildBetterSqlite3 } from "./vsix-native-deps.mjs"

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const packageJsonPath = path.join(repoRoot, "package.json")

function main() {
	const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
	const outPath = path.join(repoRoot, "dist", `lumi-vscode-${pkg.version}.vsix`)

	fs.mkdirSync(path.dirname(outPath), { recursive: true })

	try {
		rebuildBetterSqlite3(repoRoot)
		execFileSync("vsce", ["package", "--allow-package-secrets", "sendgrid", "--out", outPath], {
			stdio: "inherit",
			cwd: repoRoot,
		})
		assertVsixHasNativeModule(outPath)
		console.log(`[vscode] packaged ${outPath}`)
	} catch (error) {
		process.exitCode = 1
		if (error instanceof Error) {
			console.error(`[vscode] ${error.message}`)
		}
	}
}

main()
