export interface QuickWinTask {
	id: string
	title: string
	description: string
	icon?: string
	actionCommand: string
	prompt: string
	buttonText?: string
}

/** Short chip labels for narrow panels — description only in tooltip/title. */
export const quickWinTasks: QuickWinTask[] = [
	{
		id: "explain_project",
		title: "Explain project",
		description: "Plain-English overview of your workspace",
		icon: "AuditIcon",
		actionCommand: "dietcode/auditCodebase",
		prompt: "Look through this workspace and explain what this project does in plain language. Summarize the main parts and how they fit together.",
	},
	{
		id: "fix_something",
		title: "Fix a problem",
		description: "Get step-by-step help with a bug or issue",
		icon: "TestIcon",
		actionCommand: "dietcode/generateTests",
		prompt: "I'd like help fixing an issue in this project. Ask me what isn't working, then investigate and walk me through a fix.",
	},
	{
		id: "add_feature",
		title: "Add a feature",
		description: "Plan and build something new",
		icon: "WebAppIcon",
		actionCommand: "dietcode/createNextJsApp",
		prompt: "I want to add a feature to this project. Ask what I have in mind, then help me plan and implement it step by step.",
	},
	{
		id: "learn_codebase",
		title: "Walkthrough",
		description: "Guided tour of code you're curious about",
		icon: "GameIcon",
		actionCommand: "dietcode/createSnakeGame",
		prompt: "Give me a guided walkthrough of this codebase. Ask which file or area I care about, then explain it clearly.",
	},
]
