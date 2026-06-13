import fs from "node:fs/promises"
import path from "node:path"

const SNAPSHOTS_DIR = path.join(process.cwd(), "src/core/prompts/system-prompt/__tests__/__snapshots__")

const REPLACEMENTS = [
	[
		" - In PLAN MODE, the goal is to gather information and get context to create a detailed plan for accomplishing the task, which the user will review and approve before they switch you to ACT MODE to implement the solution.",
		" - In PLAN MODE, the goal is to gather information and get context to create a detailed plan for accomplishing the task.\n - When you call plan_mode_respond with a finalized plan, the system automatically transitions to ACT MODE so you can implement it.",
	],
	[
		" - In PLAN MODE, the goal is to gather information and get context to create a detailed plan for accomplishing the task, which the user will review and approve before switching to ACT MODE to implement the solution.",
		" - In PLAN MODE, the goal is to gather information and get context to create a detailed plan for accomplishing the task.\n - When you call plan_mode_respond with a finalized plan, the system automatically transitions to ACT MODE so you can implement it.",
	],
	[
		"- While you are usually in ACT MODE, the user may switch to PLAN MODE in order to have a back and forth with you to plan how to best accomplish the task.",
		"- New tasks begin in PLAN MODE so you can explore and plan before making changes.",
	],
	[
		" - In PLAN MODE, once you have presented a plan to the user, you should request that the user switch you to ACT MODE so that you may proceed with implementation.",
		" - When you call plan_mode_respond with a finalized plan, the system automatically transitions to ACT MODE so you can implement it.",
	],
	["  **Switch me to ACT MODE to implement.**", "  **Implementation continues automatically after plan_mode_respond.**"],
	[
		"- Understand request → PLAN explore (read-only) → propose collaborative plan with options/risks/tests → ask if it matches → output: **Switch me to ACT MODE to implement.**",
		"- Understand request → PLAN explore (read-only) → propose collaborative plan with options/risks/tests → present via plan_mode_respond → system auto-transitions to ACT MODE for implementation.",
	],
	[
		"(Remember, you can explore the project with tools like read_file in PLAN MODE without the user having to toggle to ACT MODE.)",
		"(You can explore the project with tools like read_file while remaining in PLAN MODE.)",
	],
]

async function main() {
	const entries = await fs.readdir(SNAPSHOTS_DIR)
	let updated = 0

	for (const entry of entries) {
		if (!entry.endsWith(".snap")) continue
		const filePath = path.join(SNAPSHOTS_DIR, entry)
		let content = await fs.readFile(filePath, "utf8")
		const original = content

		for (const [from, to] of REPLACEMENTS) {
			content = content.split(from).join(to)
		}

		if (!content.includes("The system automatically manages PLAN and ACT mode transitions")) {
			content = content.replace(
				"ACT MODE V.S. PLAN MODE\n\nIn each user message",
				"ACT MODE V.S. PLAN MODE\n\nThe system automatically manages PLAN and ACT mode transitions. You do not need to ask the user to switch modes.\n\nIn each user message",
			)
		}

		if (content !== original) {
			await fs.writeFile(filePath, content, "utf8")
			updated += 1
			console.log(`Updated ${entry}`)
		}
	}

	console.log(`Done. Updated ${updated} snapshot files.`)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
