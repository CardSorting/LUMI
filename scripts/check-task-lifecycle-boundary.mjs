#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import process from "node:process"

const root = process.cwd()
const sourceRoot = path.join(root, "src")
const allowedProjectionWriter = path.normalize("src/core/task/lifecycle/TaskLifecycleFunnel.ts")
const allowedPersistence = path.normalize("src/core/task/lifecycle/TaskLifecyclePersistence.ts")
const allowedSchemaBootstrap = path.normalize("src/infrastructure/db/Config.ts")
const allowedAuthorityBindings = new Set([
	allowedProjectionWriter,
	path.normalize("src/core/task/index.ts"),
	path.normalize("src/core/task/tools/subagent/SubagentRunner.ts"),
])

const forbiddenWrites = [
	{
		label: "direct cancellation-state mutation",
		pattern: /\b(?:taskState|state)\.(?:abort|abandoned|didFinishAbortingStream)\s*=(?!=)/,
	},
	{
		label: "direct terminal-state mutation",
		pattern: /\b(?:taskState|state)\.isTerminalState\s*=(?!=)/,
	},
	{
		label: "direct generation replacement",
		pattern: /\b(?:taskState|state)\.executionGeneration\s*=(?!=)/,
	},
	{
		label: "direct lifecycle record projection write",
		pattern: /\.lifecycleFunnelRecordJson\s*=/,
		allow: new Set([allowedProjectionWriter]),
	},
	{
		label: "direct lifecycle event projection write",
		pattern: /\.lifecycleFunnelEventJson\s*=/,
		allow: new Set([allowedProjectionWriter]),
	},
	{
		label: "direct lifecycle history projection write",
		pattern: /\.lifecycleFunnelHistory\s*=/,
		allow: new Set([allowedProjectionWriter]),
	},
	{
		label: "internal lifecycle persistence import outside the funnel",
		pattern: /from\s+["'][^"']*TaskLifecyclePersistence["']/,
		allow: new Set([allowedProjectionWriter]),
	},
	{
		label: "test-only lifecycle authority in production",
		pattern: /\bcreateInMemoryTaskLifecycleFunnel\b/,
		allow: new Set([allowedProjectionWriter]),
	},
	{
		label: "lifecycle authority construction outside the canonical funnel",
		pattern: /\bnew\s+TaskLifecycleFunnel\s*\(/,
		allow: new Set([allowedProjectionWriter]),
	},
	{
		label: "lifecycle authority binding outside approved task adapters",
		pattern: /\bbindTaskLifecycleAuthority\b/,
		allow: allowedAuthorityBindings,
	},
	{
		label: "lifecycle persistence write outside the persistence adapter",
		pattern:
			/(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+task_lifecycle_(?:records|events|sequence)/i,
		allow: new Set([allowedPersistence, allowedSchemaBootstrap]),
	},
]

function walk(directory) {
	const files = []
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === "generated" || entry.name === "dist") continue
		const absolute = path.join(directory, entry.name)
		if (entry.isDirectory()) {
			files.push(...walk(absolute))
		} else if (entry.isFile() && /\.(?:ts|tsx|js|mjs)$/.test(entry.name)) {
			files.push(absolute)
		}
	}
	return files
}

const violations = []
for (const absolute of walk(sourceRoot)) {
	const relative = path.normalize(path.relative(root, absolute))
	if (relative.includes(`${path.sep}__tests__${path.sep}`) || /\.(?:test|spec)\.[^.]+$/.test(relative)) continue
	const contents = fs.readFileSync(absolute, "utf8")
	const lines = contents.split(/\r?\n/)
	for (const rule of forbiddenWrites) {
		if (rule.allow?.has(relative)) continue
		for (let index = 0; index < lines.length; index++) {
			if (rule.pattern.test(lines[index])) {
				violations.push(`${relative}:${index + 1}: ${rule.label}`)
			}
		}
	}
}

if (violations.length > 0) {
	console.error("Task lifecycle authority boundary violations:")
	for (const violation of violations) console.error(`- ${violation}`)
	process.exit(1)
}

console.log("Task lifecycle boundary check passed.")
