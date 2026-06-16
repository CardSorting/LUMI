#!/usr/bin/env node
/**
 * Batch-update agent workspace docs (docs/ excluding broccolidb paths).
 * User-facing DietCode/Cline/MIRA -> LUMI; fix common stale links.
 */
import fs from "node:fs/promises"
import path from "node:path"

const DOCS_ROOT = path.join(process.cwd(), "docs")

const SKIP_FILES = new Set([
	"docs/README.md", // already rewritten
	"docs/PROJECT_MAP.md",
	"docs/architecture/current.md",
	"docs/DOCS_GUIDE.md",
	"docs/SYSTEM_COMMUNICATION.md",
	"docs/home.mdx",
	"docs/getting-started/what-is-dietcode.mdx",
	"docs/getting-started/quick-start.mdx",
	"docs/getting-started/installing-dietcode.mdx",
	"docs/getting-started/glossary.mdx",
	"docs/tools-reference/all-dietcode-tools.mdx",
	"docs/core-features/model-selection-guide.mdx",
	"docs/REWRITE_PLAN.md",
])

const REPLACEMENTS = [
	[/DietCode's/g, "LUMI's"],
	[/DietCode is/g, "LUMI is"],
	[/DietCode can/g, "LUMI can"],
	[/DietCode will/g, "LUMI will"],
	[/DietCode uses/g, "LUMI uses"],
	[/DietCode has/g, "LUMI has"],
	[/DietCode offers/g, "LUMI offers"],
	[/DietCode acts/g, "LUMI acts"],
	[/DietCode operates/g, "LUMI operates"],
	[/DietCode runs/g, "LUMI runs"],
	[/DietCode connects/g, "LUMI connects"],
	[/DietCode communicates/g, "LUMI communicates"],
	[/DietCode reads/g, "LUMI reads"],
	[/DietCode writes/g, "LUMI writes"],
	[/DietCode helps/g, "LUMI helps"],
	[/DietCode gives/g, "LUMI gives"],
	[/DietCode provides/g, "LUMI provides"],
	[/DietCode supports/g, "LUMI supports"],
	[/DietCode extension/g, "LUMI extension"],
	[/DietCode icon/g, "LUMI icon"],
	[/DietCode sidebar/g, "LUMI sidebar"],
	[/DietCode panel/g, "LUMI panel"],
	[/DietCode chat/g, "LUMI chat"],
	[/DietCode Settings/g, "LUMI Settings"],
	[/DietCode settings/g, "LUMI settings"],
	[/DietCode Documentation/g, "LUMI Documentation"],
	[/What is DietCode\?/g, "What is LUMI?"],
	[/Install DietCode/g, "Install LUMI"],
	[/Installing DietCode/g, "Installing LUMI"],
	[/All DietCode Tools/g, "All LUMI Tools"],
	[/search \*\*DietCode\*\*/g, "search **LUMI**"],
	[/Search for DietCode/g, "Search for LUMI"],
	[/Click the DietCode/g, "Click the LUMI"],
	[/Open DietCode/g, "Open LUMI"],
	[/with DietCode/g, "with LUMI"],
	[/using DietCode/g, "using LUMI"],
	[/from DietCode/g, "from LUMI"],
	[/in DietCode/g, "in LUMI"],
	[/to DietCode/g, "to LUMI"],
	[/for DietCode/g, "for LUMI"],
	[/about DietCode/g, "about LUMI"],
	[/Get DietCode/g, "Get LUMI"],
	[/Meet DietCode/g, "Meet LUMI"],
	[/Authorize DietCode/g, "Authorize LUMI"],
	[/Authorizing with DietCode/g, "Authorizing with LUMI"],
	[/Cline Documentation/g, "LUMI Documentation"],
	[/Install Cline/g, "Install LUMI"],
	[/Cline is/g, "LUMI is"],
	[/Cline can/g, "LUMI can"],
	[/MIRA sidebar/g, "LUMI sidebar"],
	[/Interface \(MIRA\)/g, "Interface (LUMI)"],
	[/\/SYSTEM_ARCHITECTURE/g, "/PROJECT_MAP"],
	[/\/SOVEREIGN_GUIDE/g, "/SECURITY_BEST_PRACTICES"],
	[/\/PATHOGEN_REGISTRY/g, "/STABILITY_REPORT"],
	[/\/JOYZONING_SOVEREIGNTY_3_0/g, "/CODEBASE_STANDARDS"],
	[/\/COGNITIVE_PRIMITIVES/g, "/MEMORY_AND_REASONING"],
	[/\/SUBAGENT_PROTOCOLS/g, "/WORKING_WITH_SUBAGENTS"],
	[/\/HOSTBRIDGE_PROTOBUS/g, "/SYSTEM_COMMUNICATION"],
	[/\/UX_PROJECTION_LAYER/g, "/USER_INTERFACE_DESIGN"],
]

async function walk(dir, files = []) {
	for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
		const full = path.join(dir, ent.name)
		if (ent.isDirectory()) {
			if (ent.name === "broccolidb") continue
			await walk(full, files)
		} else if (/\.(md|mdx)$/.test(ent.name)) {
			files.push(full)
		}
	}
	return files
}

function relFromRoot(full) {
	return path.relative(process.cwd(), full).replace(/\\/g, "/")
}

async function main() {
	const files = await walk(DOCS_ROOT)
	let changed = 0
	for (const file of files) {
		const rel = relFromRoot(file)
		if (SKIP_FILES.has(rel)) continue
		let content = await fs.readFile(file, "utf8")
		const original = content
		for (const [pattern, replacement] of REPLACEMENTS) {
			content = content.replace(pattern, replacement)
		}
		// Title/sidebarTitle in frontmatter: "DietCode" -> "LUMI" when it's product reference
		content = content.replace(/^(title|sidebarTitle|description): "(.*?)DietCode(.*?)"/gm, (m, key, pre, post) => {
			if (pre.includes("DietCode") || post.includes("DietCode")) {
				return `${key}: "${(pre + post).replace(/DietCode/g, "LUMI")}"`
			}
			return m
		})
		if (content !== original) {
			await fs.writeFile(file, content)
			changed++
		}
	}
	console.log(`Updated ${changed} files`)
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
