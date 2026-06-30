#!/usr/bin/env node
/** Publish the already-validated host-targeted VSIX to Visual Studio Marketplace. */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assertVsixHasNativeModule, nativeTargetForHost } from "./vsix-native-deps.mjs"

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const isPreRelease = process.argv.includes("--pre-release")

function main() {
	const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"))
	const target = nativeTargetForHost()
	const vsixPath = path.join(repoRoot, "dist", `lumi-vscode-${pkg.version}-${target}.vsix`)

	if (!fs.existsSync(vsixPath)) {
		console.log(`[vscode] building ${vsixPath}...`)
		execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "package:vsix"], {
			stdio: "inherit",
			cwd: repoRoot,
		})
	}

	assertVsixHasNativeModule(vsixPath)
	const args = ["publish", "--packagePath", vsixPath]
	if (isPreRelease) {
		args.push("--pre-release")
	}
	execFileSync(process.platform === "win32" ? "vsce.cmd" : "vsce", args, {
		stdio: "inherit",
		cwd: repoRoot,
	})
	console.log(`[vscode] published CardSorting.lumi-vscode for ${target}`)
}

main()
