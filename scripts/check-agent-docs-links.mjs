#!/usr/bin/env node
/**
 * Verify agent workspace docs: required files exist and relative links resolve.
 * Skips broccolidb/ subtree except cross-links we explicitly validate.
 */
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const docsRoot = path.join(repoRoot, "docs")

const requiredDocs = [
	"README.md",
	"home.mdx",
	"DOCS_GUIDE.md",
	"AGENT_STACK.md",
	"CODE_TO_DOC_MAP.md",
	"PROJECT_MAP.md",
	"architecture/current.md",
	"papers/README.md",
	"papers/philosophy.md",
	"papers/companion-brief.md",
	"papers/whitepaper.md",
	"SYSTEM_COMMUNICATION.md",
	"MEMORY_AND_REASONING.md",
	"WORKING_WITH_SUBAGENTS.md",
	"SECURITY_BEST_PRACTICES.md",
	"CODEBASE_STANDARDS.md",
	"getting-started/quick-start.mdx",
	"getting-started/what-is-dietcode.mdx",
	"tools-reference/all-dietcode-tools.mdx",
	"core-features/model-selection-guide.mdx",
	"features/roadmap-steering.mdx",
	"provider-config/README.mdx",
	"MAINTAINER.md",
	"api/README.md",
]

const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g
const broken = []

for (const rel of requiredDocs) {
	const full = path.join(docsRoot, rel)
	assert.ok(fs.existsSync(full), `required agent doc missing: docs/${rel}`)
}

function walkDocs(dir, out = []) {
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		if (ent.name === "node_modules") continue
		const full = path.join(dir, ent.name)
		if (ent.isDirectory()) walkDocs(full, out)
		else if (/\.(md|mdx)$/.test(ent.name)) out.push(full)
	}
	return out
}

function resolveLink(fromFile, target) {
	if (!target) return null
	if (target.startsWith("file://")) {
		try {
			return fileURLToPath(target.split("#")[0])
		} catch {
			return null
		}
	}
	if (target.startsWith("http") || target.startsWith("#") || target.startsWith("mailto:")) {
		return null
	}
	const noAnchor = target.split("#")[0]
	if (target.startsWith("/")) {
		const base = target.replace(/^\//, "").replace(/#.*$/, "")
		for (const c of [path.join(docsRoot, base), `${path.join(docsRoot, base)}.md`, `${path.join(docsRoot, base)}.mdx`]) {
			if (fs.existsSync(c)) return c
		}
		return null
	}
	if (!noAnchor) return fromFile
	const resolved = path.resolve(path.dirname(fromFile), noAnchor)
	if (fs.existsSync(resolved)) return resolved
	if (fs.existsSync(`${resolved}.md`)) return `${resolved}.md`
	if (fs.existsSync(`${resolved}.mdx`)) return `${resolved}.mdx`
	return resolved
}

const scanRoots = [
	"papers",
	"architecture",
	"getting-started",
	"features",
	"customization",
	"core-workflows",
	"core-features",
	"tools-reference",
	"mcp",
	"provider-config",
]
const scanned = new Set()
for (const sub of scanRoots) {
	const dir = path.join(docsRoot, sub)
	if (fs.existsSync(dir)) for (const f of walkDocs(dir)) scanned.add(f)
}
for (const name of [
	"AGENT_STACK.md",
	"CODE_TO_DOC_MAP.md",
	"PROJECT_MAP.md",
	"README.md",
	"SECURITY_BEST_PRACTICES.md",
	"MEMORY_AND_REASONING.md",
	"WORKING_WITH_SUBAGENTS.md",
	"architecture/current.md",
	"MAINTAINER.md",
]) {
	const full = path.join(docsRoot, name)
	if (fs.existsSync(full)) scanned.add(full)
}

for (const full of scanned) {
	const rel = path.relative(docsRoot, full)
	const content = fs.readFileSync(full, "utf8")
	const re = new RegExp(linkPattern.source, "g")
	let m
	while ((m = re.exec(content))) {
		const target = m[1]
		if (target.startsWith("http") || target.startsWith("#") || target.startsWith("mailto:")) continue
		if (target.includes("../broccolidb") || target.includes("broccolidb/docs")) {
			const resolved = resolveLink(full, target)
			if (resolved && !fs.existsSync(resolved)) broken.push(`${rel} → ${target}`)
			continue
		}
		const resolved = resolveLink(full, target)
		if (!resolved || !fs.existsSync(resolved)) broken.push(`${rel} → ${target}`)
	}
}

const rootIndex = fs.readFileSync(path.join(docsRoot, "README.md"), "utf8")
assert.ok(rootIndex.includes("AGENT_STACK.md"), "docs/README.md must link AGENT_STACK")
assert.ok(rootIndex.includes("papers/philosophy.md"), "docs/README.md must link agent papers")

assert.strictEqual(broken.length, 0, `Broken agent doc links:\n${broken.join("\n")}`)
console.log(`docs:check-agent-links OK — ${requiredDocs.length} required, ${scanned.size} scanned`)
