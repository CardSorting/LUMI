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
import { assertVsixHasNativeModule, nativeTargetForHost, rebuildBetterSqlite3 } from "./vsix-native-deps.mjs"

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const packageJsonPath = path.join(repoRoot, "package.json")

function main() {
	const originalPackageJson = fs.readFileSync(packageJsonPath, "utf8")
	const pkg = JSON.parse(originalPackageJson)
	const target = nativeTargetForHost()
	const outPath = path.join(repoRoot, "dist", `lumi-vscode-${pkg.version}-${target}.vsix`)
	let didPatchName = false

	fs.mkdirSync(path.dirname(outPath), { recursive: true })

	try {
		rebuildBetterSqlite3(repoRoot)

		if (pkg.name !== "lumi-vscode") {
			pkg.name = "lumi-vscode"
			fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, "\t")}\n`)
			didPatchName = true
			console.log(`[vscode] patched name → "lumi-vscode" (CardSorting.lumi-vscode)`)
		}

		// Stage package.json so vsce reads the patched name when packing the archive
		if (didPatchName) {
			execFileSync("git", ["add", "package.json"], { cwd: repoRoot })
		}

		execFileSync(
			process.platform === "win32" ? "vsce.cmd" : "vsce",
			["package", "--target", target, "--allow-package-secrets", "sendgrid", "--out", outPath],
			{
				stdio: "inherit",
				cwd: repoRoot,
			},
		)
		assertVsixHasNativeModule(outPath)
		console.log(`[vscode] packaged ${outPath}`)
	} catch (error) {
		process.exitCode = 1
		if (error instanceof Error) {
			console.error(`[vscode] ${error.message}`)
		}
	} finally {
		// Unstage package.json and restore it if patched
		if (didPatchName) {
			try {
				execFileSync("git", ["reset", "package.json"], { cwd: repoRoot, stdio: "ignore" })
			} catch {}
			fs.writeFileSync(packageJsonPath, originalPackageJson)
			console.log("[vscode] restored package.json")
		}
	}
}

main()
