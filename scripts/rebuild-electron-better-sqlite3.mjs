#!/usr/bin/env node
/**
 * Rebuild better-sqlite3 for the Electron ABI used by VS Code / Antigravity.
 *
 * Linux and macOS CI have a full toolchain, so we compile from source for a
 * reliable ABI match. Windows GitHub runners do not ship Visual Studio, so we
 * rely on electron-rebuild's prebuilt binaries instead of --build-from-source.
 */
import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ELECTRON_VERSION } from "./vsix-native-deps.mjs"

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

/** @param {NodeJS.Platform} [platform] */
export function getElectronRebuildArgs(platform = process.platform) {
	const args = ["-v", ELECTRON_VERSION, "-w", "better-sqlite3"]
	if (platform !== "win32") {
		args.push("--build-from-source")
	}
	return args
}

function runElectronRebuild() {
	const args = getElectronRebuildArgs()
	console.log(`[rebuild] electron-rebuild ${args.join(" ")}`)
	// npm exec resolves the local binary on all platforms (Windows PATH lacks .bin).
	execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["exec", "electron-rebuild", "--", ...args], {
		stdio: "inherit",
		cwd: repoRoot,
	})
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
	runElectronRebuild()
}
