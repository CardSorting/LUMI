#!/usr/bin/env node
/**
 * Prepare the CardSorting namespace on Open VSX before publishing.
 *
 * Publishing alone does not verify extensions — the namespace must have an
 * owner granted by the Eclipse Foundation. See:
 * https://github.com/eclipse/openvsx/wiki/Namespace-Access#how-to-claim-a-namespace
 *
 * Usage:
 *   OVSX_PAT=... npm run setup:openvsx
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const packageJsonPath = path.join(repoRoot, "package.json")
const NAMESPACE_CLAIM_ISSUE = "https://github.com/EclipseFdn/open-vsx.org/issues"

function runOvsx(args) {
	execFileSync("ovsx", args, { stdio: "inherit", cwd: repoRoot })
}

function runOvsxCapture(args) {
	return execFileSync("ovsx", args, { encoding: "utf8", cwd: repoRoot }).trim()
}

function main() {
	const token = process.env.OVSX_PAT
	if (!token) {
		console.error("[openvsx] OVSX_PAT is required. Create a token at https://open-vsx.org/user-settings/tokens")
		process.exit(1)
	}

	const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
	const namespace = pkg.publisher
	if (!namespace) {
		console.error("[openvsx] package.json is missing publisher")
		process.exit(1)
	}

	console.log(`[openvsx] namespace: ${namespace}`)

	try {
		runOvsx(["create-namespace", namespace, "-p", token])
		console.log(`[openvsx] namespace "${namespace}" is ready (created or already exists)`)
	} catch {
		console.warn(`[openvsx] create-namespace failed — it may already exist; continuing`)
	}

	try {
		const verifyOutput = runOvsxCapture(["verify-pat", namespace, "-p", token])
		console.log(`[openvsx] verify-pat: ${verifyOutput || "token can publish to this namespace"}`)
	} catch {
		console.error(`[openvsx] verify-pat failed — your token cannot publish to "${namespace}"`)
		console.error("[openvsx] Log in at https://open-vsx.org with the CardSorting GitHub account and regenerate OVSX_PAT")
		process.exit(1)
	}

	console.log("")
	console.log("[openvsx] IMPORTANT: extensions stay UNVERIFIED until Eclipse grants namespace ownership.")
	console.log("[openvsx] File or comment on a claim issue:")
	console.log(`[openvsx]   ${NAMESPACE_CLAIM_ISSUE}`)
	console.log("[openvsx] See docs/MAINTAINER.md#open-vsx-namespace-verification")
	console.log("[openvsx] After ownership is granted, republish the latest version to clear the warning.")
}

main()
