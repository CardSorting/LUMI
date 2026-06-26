#!/usr/bin/env node
/**
 * Pin third-party GitHub Actions to full commit SHAs for OpenSSF Scorecard.
 * Run after bumping action tags: node scripts/pin-github-actions.mjs
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const workflowsDir = path.join(repoRoot, ".github", "workflows")

/** @type {Record<string, string>} tag -> sha */
const PINS = {
	"actions/checkout@v4": "34e114876b0b11c390a56381ad16ebd13914f8d5",
	"actions/setup-node@v4": "49933ea5288caeca8642d1e84afbd3f7d6820020",
	"actions/cache@v4": "0057852bfaa89a56745cba8c7296529d2fc39830",
	"actions/upload-artifact@v4": "ea165f8d65b6e75b540449e92b4886f43607fa02",
	"actions/download-artifact@v4": "d3f86a106a0bac45b974a628896c90dbdf5c8093",
	"actions/stale@v9": "5bef64f19d7facfb25b37b414482c7164d639639",
	"actions/stale@28ca103": "5bef64f19d7facfb25b37b414482c7164d639639",
	"actions/labeler@v5": "8558fd74291d67161a8a78ce36a881fa63b766a9",
	"actions/dependency-review-action@v4": "2031cfc080254a8a887f58cffee85186f0e49e48",
	"actions/first-interaction@v3": "1c4688942c71f71d4f5502a26ea67c331730fa4d",
	"actions/github-script@v7": "f28e40c7f34bde8b3046d885e986cb6290c5673b",
	"github/codeql-action/init@v3": "dd903d2e4f5405488e5ef1422510ee31c8b32357",
	"github/codeql-action/autobuild@v3": "dd903d2e4f5405488e5ef1422510ee31c8b32357",
	"github/codeql-action/analyze@v3": "dd903d2e4f5405488e5ef1422510ee31c8b32357",
	"github/codeql-action/upload-sarif@v3": "dd903d2e4f5405488e5ef1422510ee31c8b32357",
	"dorny/paths-filter@v3": "d1c1ffe0248fe513906c8e24db8ea791d46f8590",
	"ossf/scorecard-action@v2.4.3": "4eaacf0543bb3f2c246792bd56e8cdeffafb205a",
	"softprops/action-gh-release@v2": "3bb12739c298aeb8a4eeaf626c5b8d85266b0e65",
	"dependabot/fetch-metadata@v2": "21025c705c08248db411dc16f3619e6b5f9ea21a",
	"release-drafter/release-drafter@v6": "6a93d829887aa2e0748befe2e808c66c0ec6e4c7",
	"dessant/lock-threads@v5": "1bf7ec25051fe7c00bdd17e6a7cf3d7bfb7dc771",
	"EndBug/label-sync@v2": "52074158190acb45f3077f9099fea818aa43f97a",
	"eps1lon/actions-label-merge-conflict@v3": "0273be72a0bbd58fcd71d0d6c02c209b50d1e5e1",
	"amannn/action-semantic-pull-request@v5": "e32d7e603df1aa1ba07e981f2a23455dee596825",
	"pascalgn/size-label-action@v0.5.7": "56b489b027932ec0cf60438a1a5f1a19c8fc71ff",
	"qltysh/qlty-action/coverage@v2": "fd52dc852530a708d68c3b7342f8d33d1df4cd55",
	"sigstore/cosign-installer@v3.7.0": "dc72c7d5c4d10cd6bcb8cf6e3fd625a9e5e537da",
}

function pinWorkflow(content) {
	let updated = content
	for (const [tag, sha] of Object.entries(PINS)) {
		const shortTag = tag.split("@")[1]
		const action = tag.split("@")[0]
		const re = new RegExp(`${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g")
		updated = updated.replace(re, `${action}@${sha} # ${shortTag}`)
	}
	return updated
}

async function main() {
	let changed = 0
	for (const file of fs.readdirSync(workflowsDir).filter((f) => f.endsWith(".yml"))) {
		const filePath = path.join(workflowsDir, file)
		const original = fs.readFileSync(filePath, "utf8")
		const pinned = pinWorkflow(original)
		if (pinned !== original) {
			fs.writeFileSync(filePath, pinned)
			changed++
			console.log(`pinned ${file}`)
		}
	}
	console.log(`Updated ${changed} workflow file(s).`)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
