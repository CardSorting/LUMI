#!/usr/bin/env node
/**
 * Prepend legacy-provider notice to unwired provider-config pages (idempotent).
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const docsRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "provider-config")

const ACTIVE = new Set(["README.mdx", "openrouter.mdx", "openai-codex.mdx", "nousresearch.mdx", "cloudflare.mdx"])

const NOTICE = `
<Note>
**Legacy reference:** This provider handler exists in the repo but is **not wired** in \`buildApiHandler\` for the current LUMI build. See [Providers overview](/provider-config/README) for the four active providers.
</Note>
`

let updated = 0
for (const name of fs.readdirSync(docsRoot)) {
	if (!name.endsWith(".mdx") || ACTIVE.has(name)) continue
	const full = path.join(docsRoot, name)
	let content = fs.readFileSync(full, "utf8")
	if (content.includes("not wired") || content.includes("Legacy reference")) continue
	const endFrontmatter = content.indexOf("---", 4)
	if (endFrontmatter === -1) continue
	content = content.slice(0, endFrontmatter + 3) + NOTICE + content.slice(endFrontmatter + 3)
	fs.writeFileSync(full, content)
	updated++
}
console.log(`tag-legacy-provider-docs: tagged ${updated} files`)
