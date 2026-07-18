#!/usr/bin/env node
/**
 * Guard the handler adapter boundary and catch missing runtime imports.
 *
 * Catches patterns that esbuild production builds do not typecheck:
 * - DietCodeDefaultTool enum value use without a value import
 * - Handler classes instantiated in ToolExecutorCoordinator without import
 * - telemetryService use in handlers without import
 * - approval settings, approval decisions, permits, and consent prompts leaking into handlers
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { globby } from "globby"

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const coordinatorPath = path.join(repoRoot, "src/core/task/tools/ToolExecutorCoordinator.ts")
const handlersDir = path.join(repoRoot, "src/core/task/tools/handlers")

const issues = []

function hasImport(src, symbol) {
	const re = new RegExp(`import\\s+(?:type\\s+)?\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s+from|import\\s+${symbol}\\s+from`)
	return re.test(src)
}

function auditFile(file, checks) {
	const src = fs.readFileSync(file, "utf8")
	const rel = path.relative(repoRoot, file)

	if (checks.dietCodeTool && /DietCodeDefaultTool\.[A-Z_]+/.test(src) && !hasImport(src, "DietCodeDefaultTool")) {
		issues.push(`${rel}: uses DietCodeDefaultTool values without import`)
	}

	if (checks.telemetry && /telemetryService\./.test(src) && !hasImport(src, "telemetryService")) {
		issues.push(`${rel}: uses telemetryService without import`)
	}

	if (checks.approvalBoundary) {
		const forbiddenApprovalAuthority = [
			[/\bautoApprovalSettings\b/, "reads approval settings"],
			[/\b(?:autoApprover|shouldAutoApproveTool|recordApprovalDecision|recordUserDecision)\b/, "owns an approval decision"],
			[/\bshowNotificationForApproval\b/, "runs approval UI independently"],
			[/\b(?:issue|reinterpret|validate)Permit\b/i, "owns or reinterprets an execution permit"],
		]
		for (const [pattern, message] of forbiddenApprovalAuthority) {
			if (pattern.test(src)) issues.push(`${rel}: ${message}; declare ApprovalIntent and defer to ExecutionFunnel`)
		}

		const semanticPromptAdapters = new Set(["AskFollowupQuestionToolHandler.ts", "AttemptCompletionHandler.ts"])
		if (/callbacks\.ask\s*\(/.test(src) && !semanticPromptAdapters.has(path.basename(file))) {
			issues.push(
				`${rel}: prompts the user outside a semantic input adapter; approval prompting belongs to ExecutionFunnel`,
			)
		}
	}
}

// All handler modules
for (const name of fs.readdirSync(handlersDir)) {
	if (!name.endsWith(".ts") || name.includes(".test.")) {
		continue
	}
	auditFile(path.join(handlersDir, name), { dietCodeTool: true, telemetry: true, approvalBoundary: true })
}

// Coordinator must import every handler it instantiates
const coordinator = fs.readFileSync(coordinatorPath, "utf8")
const instantiated = [...coordinator.matchAll(/\bnew ([A-Z][A-Za-z0-9]*Handler)\b/g)].map((m) => m[1])
for (const cls of new Set(instantiated)) {
	if (cls === "SharedToolHandler") {
		continue
	}
	if (!hasImport(coordinator, cls)) {
		issues.push(`${path.relative(repoRoot, coordinatorPath)}: instantiates ${cls} without import`)
	}
}

// Every tool in toolUseNames must have a coordinator factory (or explicit undefined)
const toolsSrc = fs.readFileSync(path.join(repoRoot, "src/shared/tools.ts"), "utf8")
const enumBlock = toolsSrc.match(/export enum DietCodeDefaultTool[\s\S]*?^}/m)
assert.ok(enumBlock, "DietCodeDefaultTool enum not found")
const toolIds = [...enumBlock[0].matchAll(/^\s*([A-Z_]+)\s*=/gm)].map((m) => m[1])
for (const id of toolIds) {
	if (!coordinator.includes(`DietCodeDefaultTool.${id}`)) {
		issues.push(`${path.relative(repoRoot, coordinatorPath)}: missing factory for DietCodeDefaultTool.${id}`)
	}
}

// Repo-wide DietCodeDefaultTool value imports (excluding type-only files is ok if no value use)
const tsFiles = await globby("src/**/*.ts", { cwd: repoRoot, gitignore: true })

for (const rel of tsFiles) {
	if (rel === "src/shared/tools.ts") {
		continue
	}
	const file = path.join(repoRoot, rel)
	const src = fs.readFileSync(file, "utf8")
	if (!/DietCodeDefaultTool\.[A-Z_]+/.test(src)) {
		continue
	}
	if (!hasImport(src, "DietCodeDefaultTool")) {
		issues.push(`${rel}: uses DietCodeDefaultTool values without import`)
	}
}

if (issues.length > 0) {
	console.error("[check-handler-imports] failed:\n")
	for (const issue of issues) {
		console.error(`  - ${issue}`)
	}
	process.exit(1)
}

console.log("[check-handler-imports] ok")
