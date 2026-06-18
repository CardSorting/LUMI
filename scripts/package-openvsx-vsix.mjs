#!/usr/bin/env node
/**
 * Package Open VSX VSIX as CardSorting.lumi (legacy extension ID).
 *
 * VS Code Marketplace uses package name "lumi-vscode" → CardSorting.lumi-vscode.
 * Open VSX listing was created as CardSorting.lumi — this script temporarily
 * patches package.json name to "lumi" and runs vsce with --no-dependencies
 * (avoids npm workspace errors). Repacking with zip adds extra fields that
 * Open VSX rejects, so vsce must be used directly.
 *
 * Usage:
 *   npm run package:vsix:openvsx
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const OPENVSX_EXTENSION_NAME = "lumi"
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const packageJsonPath = path.join(repoRoot, "package.json")

function restore(original) {
	fs.writeFileSync(packageJsonPath, original)
	console.log("[openvsx] restored package.json")
}

function main() {
	const original = fs.readFileSync(packageJsonPath, "utf8")
	const pkg = JSON.parse(original)
	const version = pkg.version
	const outPath = path.join(repoRoot, "dist", `lumi-${version}.vsix`)

	fs.mkdirSync(path.dirname(outPath), { recursive: true })

	if (pkg.name !== OPENVSX_EXTENSION_NAME) {
		pkg.name = OPENVSX_EXTENSION_NAME
		fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, "\t")}\n`)
		console.log(`[openvsx] patched name → "${OPENVSX_EXTENSION_NAME}" (CardSorting.${OPENVSX_EXTENSION_NAME})`)
	}

	try {
		execFileSync("vsce", ["package", "--no-dependencies", "--allow-package-secrets", "sendgrid", "--out", outPath], {
			stdio: "inherit",
			cwd: repoRoot,
		})
		console.log(`[openvsx] packaged ${outPath}`)
	} catch {
		process.exitCode = 1
	} finally {
		restore(original)
	}
}

main()
