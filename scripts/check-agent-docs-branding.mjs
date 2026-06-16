#!/usr/bin/env node
/**
 * Fail if user-facing doc dirs contain stale standalone "DietCode" product references.
 */
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const docsRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs")

const scanDirs = [
	"getting-started",
	"features",
	"customization",
	"core-workflows",
	"core-features",
	"tools-reference",
	"mcp",
	"provider-config",
]

const allowPatterns = [
	/DietCode \(internal\)/,
	/DietCodeMessage/,
	/DietCodeDefaultTool/,
	/DietCode\*/,
	/`DietCode/,
	/\.dietcoderules/,
	/dietcodeignore/,
	/dietcode-rules/,
	/dietcode\.bot/,
	/Legacy reference/,
	/not wired in/,
	/Internal prefix/,
	/legacy filenames/,
	/internal types/,
	/DietCode Rules/, // link label to dietcode-rules path — prefer fixing to "project rules"
]

const violations = []

function walk(dir, out = []) {
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, ent.name)
		if (ent.isDirectory()) walk(full, out)
		else if (/\.(md|mdx)$/.test(ent.name)) out.push(full)
	}
	return out
}

for (const sub of scanDirs) {
	const dir = path.join(docsRoot, sub)
	if (!fs.existsSync(dir)) continue
	for (const full of walk(dir)) {
		const rel = path.relative(docsRoot, full)
		if (rel === "provider-config/README.mdx") continue
		const content = fs.readFileSync(full, "utf8")
		if (content.includes("Legacy reference:")) continue
		const lines = content.split("\n")
		lines.forEach((line, i) => {
			if (!/\bDietCode\b/.test(line)) return
			if (allowPatterns.some((p) => p.test(line))) return
			violations.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`)
		})
	}
}

assert.strictEqual(violations.length, 0, `Stale DietCode branding in user docs:\n${violations.join("\n")}`)
console.log("docs:check-agent-branding OK")
