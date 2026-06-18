#!/usr/bin/env node
/**
 * Package Open VSX VSIX as CardSorting.lumi (legacy extension ID).
 *
 * Usage:
 *   npm run package:vsix:openvsx
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assertVsixHasNativeModule, rebuildBetterSqlite3 } from "./vsix-native-deps.mjs"
import { createWorkspaceLinkManager } from "./workspace-link.mjs"

const OPENVSX_EXTENSION_NAME = "lumi"
const MARKETPLACE_EXTENSION_NAME = "lumi-vscode"

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const packageJsonPath = path.join(repoRoot, "package.json")
const nodeModulesPath = path.join(repoRoot, "node_modules")
const workspaceLinks = createWorkspaceLinkManager({ repoRoot, nodeModulesPath })

function restorePackageJson(original) {
	fs.writeFileSync(packageJsonPath, original)
	console.log("[openvsx] restored package.json")
}

function main() {
	const originalPackageJson = fs.readFileSync(packageJsonPath, "utf8")
	const pkg = JSON.parse(originalPackageJson)
	const version = pkg.version
	const outPath = path.join(repoRoot, "dist", `lumi-${version}.vsix`)
	let didPatchName = false
	let didReconcileWorkspaceLink = false

	fs.mkdirSync(path.dirname(outPath), { recursive: true })

	try {
		rebuildBetterSqlite3(repoRoot)

		if (pkg.name !== OPENVSX_EXTENSION_NAME) {
			pkg.name = OPENVSX_EXTENSION_NAME
			fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, "\t")}\n`)
			didPatchName = true
			console.log(`[openvsx] patched name → "${OPENVSX_EXTENSION_NAME}" (CardSorting.${OPENVSX_EXTENSION_NAME})`)
		}

		didReconcileWorkspaceLink = workspaceLinks.reconcile({
			fromName: MARKETPLACE_EXTENSION_NAME,
			toName: OPENVSX_EXTENSION_NAME,
		})
		if (didReconcileWorkspaceLink) {
			console.log(`[openvsx] renamed workspace self-link: ${MARKETPLACE_EXTENSION_NAME} → ${OPENVSX_EXTENSION_NAME}`)
		}

		execFileSync("vsce", ["package", "--allow-package-secrets", "sendgrid", "--out", outPath], {
			stdio: "inherit",
			cwd: repoRoot,
		})

		assertVsixHasNativeModule(outPath)
		console.log(`[openvsx] packaged ${outPath}`)
	} catch (error) {
		process.exitCode = 1
		if (error instanceof Error) {
			console.error(`[openvsx] ${error.message}`)
		}
	} finally {
		workspaceLinks.restore({
			fromName: MARKETPLACE_EXTENSION_NAME,
			toName: OPENVSX_EXTENSION_NAME,
			didReconcile: didReconcileWorkspaceLink,
		})
		if (didReconcileWorkspaceLink) {
			console.log(`[openvsx] restored workspace self-link: ${OPENVSX_EXTENSION_NAME} → ${MARKETPLACE_EXTENSION_NAME}`)
		}
		if (didPatchName) {
			restorePackageJson(originalPackageJson)
		}
	}
}

main()
