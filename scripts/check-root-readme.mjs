#!/usr/bin/env node
/**
 * Production guardrails for root README.md / readme.md parity and required content.
 * Validates live metrics against package.json and src/shared/tools.ts.
 */
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

const upper = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8")
const lower = fs.readFileSync(path.join(repoRoot, "readme.md"), "utf8")

assert.strictEqual(upper, lower, "README.md and readme.md must be identical")

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"))
const providers = JSON.parse(fs.readFileSync(path.join(repoRoot, "src/shared/providers/providers.json"), "utf8"))
const toolsSrc = fs.readFileSync(path.join(repoRoot, "src/shared/tools.ts"), "utf8")
const slashSrc = fs.readFileSync(path.join(repoRoot, "src/core/slash-commands/index.ts"), "utf8")
const hooksSrc = fs.readFileSync(path.join(repoRoot, "src/core/hooks/utils.ts"), "utf8")

const enumBlock = toolsSrc.match(/export enum DietCodeDefaultTool[\s\S]*?^}/m)
assert.ok(enumBlock, "DietCodeDefaultTool enum not found")
const toolCount = (enumBlock[0].match(/^\s+\w+\s*=/gm) || []).length

const readOnlyMatch = toolsSrc.match(/export const READ_ONLY_TOOLS = \[([\s\S]*?)\] as const/)
const readOnlyCount = readOnlyMatch ? (readOnlyMatch[1].match(/DietCodeDefaultTool\.\w+/g) || []).length : 0

const slashBlock = slashSrc.match(/SUPPORTED_DEFAULT_COMMANDS = \[([\s\S]*?)\]/)
const slashCount = slashBlock ? (slashBlock[1].match(/"[^"]+"/g) || []).length : 0

const hookBlock = hooksSrc.match(/VALID_HOOK_TYPES = \[([\s\S]*?)\] as const/)
const hookCount = hookBlock ? (hookBlock[1].match(/"[^"]+"/g) || []).length : 0

assert.ok(upper.includes(pkg.version), `root README must include version ${pkg.version}`)
assert.ok(upper.includes(`**${toolCount}**`), `root README must cite **${toolCount}** tools`)
assert.ok(
	upper.includes(`**${readOnlyCount}**`) || upper.includes(`${readOnlyCount}`),
	`root README must cite ${readOnlyCount} read-only tools`,
)
assert.ok(
	upper.includes(`${providers.list.length}`) || upper.includes("providers-4"),
	`root README must cite ${providers.list.length} providers`,
)
assert.ok(
	upper.includes(`${slashCount}`) || upper.includes("Slash commands"),
	`root README must cite ${slashCount} slash commands`,
)
assert.ok(upper.includes(".dietcoderules/hooks"), "root README must cite correct hooks path .dietcoderules/hooks")
assert.ok(!upper.includes(".dietcode/hooks"), "root README must not cite stale .dietcode/hooks path")
assert.ok(upper.includes("plan_mode_respond"), "root README must document Plan mode")
assert.ok(upper.includes("act_mode_respond"), "root README must document Act mode")
assert.ok(upper.includes("~/.dietcode/data"), "root README must document local data path")
assert.ok(upper.includes("docs/papers/philosophy.md"), "root README must link philosophy paper")

const requiredSections = [
	"## Table of contents",
	"## About",
	"### By the numbers",
	"## Features",
	"## Installation",
	"## Quick start",
	"## Documentation",
	"## Governed subagent execution",
	"## Plan & Act modes",
	"## Built-in slash commands",
	"## Lifecycle hooks",
	"## Key VS Code settings",
	"## Architecture",
	"## Development",
	"### Quality gates",
	"## Troubleshooting",
	"## Getting help",
	"## Security",
	"## FAQ",
	"## Contributing",
	"## License",
]

for (const section of requiredSections) {
	assert.ok(upper.includes(section), `root README missing section: ${section}`)
}

const requiredLinks = [
	"docs/README.md",
	"docs/AGENT_STACK.md",
	"docs/papers/companion-brief.md",
	"docs/SECURITY_BEST_PRACTICES.md",
	"docs/MAINTAINER.md",
	"broccolidb/docs/README.md",
	"broccolidb/README.md",
	"CONTRIBUTING.md",
	"LICENSE",
	"SECURITY.md",
	"assets/docs/demo.gif",
	"changelogv3.md",
	"docs/customization/hooks.mdx",
	"docs/features/roadmap-steering.mdx",
	"docs/core-workflows/working-with-files.mdx",
	"docs/core-workflows/plan-and-act.mdx",
	"docs/ENTERPRISE_DEPLOYMENT.md",
	"docs/architecture/spider-v20-forensic-engine.md",
	"docs/MEMORY_AND_REASONING.md",
	"docs/customization/dietcodeignore.mdx",
]

for (const link of requiredLinks) {
	assert.ok(upper.includes(link), `root README missing link/path: ${link}`)
}

assert.ok(upper.includes("CardSorting.lumi-vscode"), "root README must cite VS Marketplace extension ID")
assert.ok(upper.includes("CardSorting.lumi"), "root README must cite Open VSX extension ID")
assert.ok(/openrouter|OpenRouter/.test(upper), "root README must mention OpenRouter")
assert.ok(upper.includes("```mermaid"), "root README must include mermaid diagrams")
assert.ok(upper.includes("PreToolUse"), "root README must document lifecycle hooks")
assert.ok(upper.includes("plan_mode_respond"), "root README must document Plan mode")
assert.ok(upper.includes("act_mode_respond"), "root README must document Act mode")
assert.ok(upper.includes("docs:check-all"), "root README must document docs:check-all")
assert.ok(upper.includes("~/.dietcode/data"), "root README must document local data path")
assert.ok(upper.includes("docs/papers/philosophy.md"), "root README must link philosophy paper")
assert.ok(upper.includes("lumi.roadmap.enabled"), "root README must document roadmap settings")

console.log(
	`docs:check-root-readme OK — v${pkg.version}, ${toolCount} tools, ${readOnlyCount} read-only, ${slashCount} slash, ${hookCount} hooks, ${providers.list.length} providers`,
)
