#!/usr/bin/env node
/**
 * Publish to Open VSX as CardSorting.lumi (legacy extension ID).
 *
 * VS Code Marketplace uses package name "lumi-vscode" → CardSorting.lumi-vscode.
 * Open VSX listing was created as CardSorting.lumi — packages via
 * scripts/package-openvsx-vsix.mjs (includes better-sqlite3 native deps).
 *
 * Extensions show as verified only after the CardSorting namespace owner is
 * granted by Eclipse (see docs/MAINTAINER.md#open-vsx-namespace-verification).
 *
 * Usage:
 *   OVSX_PAT=... npm run publish:openvsx
 *   OVSX_PAT=... npm run publish:openvsx:prerelease
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assertVsixHasNativeModule, nativeTargetForHost } from "./vsix-native-deps.mjs"

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const packageJsonPath = path.join(repoRoot, "package.json")

const isPreRelease = process.argv.includes("--pre-release")

function main() {
	const token = process.env.OVSX_PAT
	if (!token) {
		console.error("[openvsx] OVSX_PAT is required. Create a token at https://open-vsx.org/user-settings/tokens")
		process.exit(1)
	}

	execFileSync("node", ["scripts/setup-openvsx-namespace.mjs"], {
		stdio: "inherit",
		cwd: repoRoot,
		env: { ...process.env, OVSX_PAT: token },
	})

	const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
	const target = nativeTargetForHost()
	const vsixPath = path.join(repoRoot, "dist", `lumi-${pkg.version}-${target}.vsix`)

	if (!fs.existsSync(vsixPath)) {
		console.log(`[openvsx] building ${vsixPath}...`)
		execFileSync("node", ["scripts/package-openvsx-vsix.mjs"], { stdio: "inherit", cwd: repoRoot })
	}
	assertVsixHasNativeModule(vsixPath)

	const args = ["publish", "-i", vsixPath, "-p", token]
	if (isPreRelease) {
		args.push("--pre-release")
	}

	try {
		execFileSync(process.platform === "win32" ? "ovsx.cmd" : "ovsx", args, { stdio: "inherit", cwd: repoRoot })
		console.log(`[openvsx] published CardSorting.lumi for ${target}`)
		console.warn(
			"[openvsx] If the extension still shows an unverified publisher warning, wait for Eclipse to grant CardSorting namespace ownership, then republish.",
		)
	} catch {
		process.exitCode = 1
	}
}

main()
