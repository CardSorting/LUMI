#!/usr/bin/env node
/**
 * Cross-check README + companion-brief metrics against live source files.
 */
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

function countEnumTools(src) {
	const block = src.match(/export enum DietCodeDefaultTool[\s\S]*?^}/m)
	assert.ok(block, "DietCodeDefaultTool enum not found")
	return (block[0].match(/^\s+\w+\s*=/gm) || []).length
}

function countReadOnly(src) {
	const m = src.match(/export const READ_ONLY_TOOLS = \[([\s\S]*?)\] as const/)
	return m ? (m[1].match(/DietCodeDefaultTool\.\w+/g) || []).length : 0
}

function countSlashCommands(src) {
	const m = src.match(/SUPPORTED_DEFAULT_COMMANDS = \[([\s\S]*?)\]/)
	return m ? (m[1].match(/"[^"]+"/g) || []).length : 0
}

function countHooks(src) {
	const m = src.match(/VALID_HOOK_TYPES = \[([\s\S]*?)\] as const/)
	return m ? (m[1].match(/"[^"]+"/g) || []).length : 0
}

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"))
const providers = JSON.parse(fs.readFileSync(path.join(repoRoot, "src/shared/providers/providers.json"), "utf8"))
const toolsSrc = fs.readFileSync(path.join(repoRoot, "src/shared/tools.ts"), "utf8")
const slashSrc = fs.readFileSync(path.join(repoRoot, "src/core/slash-commands/index.ts"), "utf8")
const hooksSrc = fs.readFileSync(path.join(repoRoot, "src/core/hooks/utils.ts"), "utf8")
const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8")
const brief = fs.readFileSync(path.join(repoRoot, "docs/papers/companion-brief.md"), "utf8")

const metrics = {
	version: pkg.version,
	tools: countEnumTools(toolsSrc),
	readOnly: countReadOnly(toolsSrc),
	providers: providers.list.length,
	slash: countSlashCommands(slashSrc),
	hooks: countHooks(hooksSrc),
}

const checks = [
	[`version ${metrics.version}`, readme.includes(metrics.version) && brief.includes(metrics.version)],
	[`${metrics.tools} tools`, readme.includes(`**${metrics.tools}**`) && brief.includes(`**${metrics.tools}**`)],
	[`${metrics.readOnly} read-only`, readme.includes(`**${metrics.readOnly}**`) && brief.includes(`**${metrics.readOnly}**`)],
	[`${metrics.providers} providers`, readme.includes(`${metrics.providers}`) && brief.includes(`**${metrics.providers}**`)],
	[`${metrics.slash} slash`, readme.includes(`${metrics.slash}`) && brief.includes(`**${metrics.slash}**`)],
	[`${metrics.hooks} hooks`, readme.includes(`${metrics.hooks}`) && brief.includes(`**${metrics.hooks}**`)],
]

assert.ok(
	readme.includes(`version-${metrics.version}`) || readme.includes(`v${metrics.version}`),
	`README badge must match version ${metrics.version}`,
)

const failed = checks.filter(([, ok]) => !ok).map(([label]) => label)
assert.strictEqual(failed.length, 0, `README/companion-brief metrics out of sync with codebase: ${failed.join(", ")}`)

console.log(
	`docs:check-readme-metrics OK — v${metrics.version}, ${metrics.tools} tools, ${metrics.readOnly} read-only, ${metrics.slash} slash, ${metrics.hooks} hooks, ${metrics.providers} providers`,
)
