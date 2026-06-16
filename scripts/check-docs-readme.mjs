#!/usr/bin/env node
/**
 * Guardrails for docs/README.md structure and required cross-links.
 */
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const docsRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs")
const content = fs.readFileSync(path.join(docsRoot, "README.md"), "utf8")

const requiredSections = [
	"## At a glance",
	"## Project configuration",
	"## Reading paths by audience",
	"## Where to document what",
	"## Release & policy",
	"## Local development",
	"## Principles",
]

for (const section of requiredSections) {
	assert.ok(content.includes(section), `docs/README.md missing section: ${section}`)
}

const requiredLinks = [
	"AGENT_STACK.md",
	"MAINTAINER.md",
	"papers/companion-brief.md",
	"broccolidb/docs/README.md",
	"core-workflows/working-with-files.mdx",
	".dietcoderules/hooks",
]

for (const link of requiredLinks) {
	assert.ok(content.includes(link), `docs/README.md missing: ${link}`)
}

assert.ok(content.includes("```mermaid"), "docs/README.md must include doc map diagram")

console.log("docs:check-docs-readme OK")
