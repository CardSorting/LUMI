#!/usr/bin/env node
/**
 * Rebuild better-sqlite3 for the Electron ABI used by VS Code / Antigravity.
 *
 * Linux and macOS CI have a full toolchain, so we compile from source for a
 * reliable ABI match. Windows GitHub runners do not ship Visual Studio, so we
 * rely on electron-rebuild's prebuilt binaries instead of --build-from-source.
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ELECTRON_VERSION } from "./vsix-native-deps.mjs"

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

/** @param {NodeJS.Platform} [platform] */
export function getElectronRebuildArgs(platform = process.platform, arch = process.arch) {
	const args = ["-v", ELECTRON_VERSION, "-w", "better-sqlite3", "--arch", arch]
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

	const platform = process.platform
	const arch = process.arch
	const binDir = path.join(repoRoot, "node_modules", "better-sqlite3", "bin")

	if (fs.existsSync(binDir)) {
		const subdirs = fs.readdirSync(binDir)
		const prefix = `${platform}-${arch}-`
		const match = subdirs.find((dir) => dir.startsWith(prefix))
		if (match) {
			const srcFile = path.join(binDir, match, "better-sqlite3.node")
			if (fs.existsSync(srcFile)) {
				const destDir = path.join(repoRoot, "node_modules", "better-sqlite3", "build", "Release")
				fs.mkdirSync(destDir, { recursive: true })
				const destFile = path.join(destDir, "better_sqlite3.node")
				fs.copyFileSync(srcFile, destFile)
				console.log(`[rebuild] Copied Electron binary from ${srcFile} to ${destFile}`)
			} else {
				console.warn(`[rebuild] Expected binary file not found at ${srcFile}`)
			}
		} else {
			console.warn(`[rebuild] No binary directory matching prefix ${prefix} found in ${binDir}`)
		}
	} else {
		console.warn(`[rebuild] Binary directory does not exist at ${binDir}`)
	}
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
	runElectronRebuild()
}
