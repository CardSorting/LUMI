#!/usr/bin/env node
/**
 * Verify relative links in root README.md resolve to existing files.
 */
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8")

const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g
const broken = []

function resolve(target) {
	if (!target || target.startsWith("http") || target.startsWith("mailto:")) return null
	const noAnchor = target.split("#")[0]
	if (!noAnchor) return null
	const resolved = path.resolve(repoRoot, noAnchor)
	if (fs.existsSync(resolved)) return resolved
	if (fs.existsSync(`${resolved}.md`)) return `${resolved}.md`
	if (fs.existsSync(`${resolved}.mdx`)) return `${resolved}.mdx`
	return resolved
}

let m
while ((m = linkPattern.exec(readme))) {
	const target = m[1]
	if (target.startsWith("http") || target.startsWith("mailto:")) continue
	const noAnchor = target.split("#")[0]
	if (!noAnchor) continue
	const resolved = resolve(noAnchor)
	if (!resolved || !fs.existsSync(resolved)) broken.push(target)
}

assert.strictEqual(broken.length, 0, `Broken root README links:\n${broken.join("\n")}`)
console.log("docs:check-root-readme-links OK")
