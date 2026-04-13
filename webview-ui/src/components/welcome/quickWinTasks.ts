export interface QuickWinTask {
	id: string
	title: string
	description: string
	icon?: string
	actionCommand: string
	prompt: string
	buttonText?: string
}

export const quickWinTasks: QuickWinTask[] = [
	{
		id: "codebase_audit",
		title: "Audit Codebase",
		description: "Analyze project structure, dependencies, and code quality",
		icon: "AuditIcon",
		actionCommand: "dietcode/auditCodebase",
		prompt: "Perform a comprehensive audit of this codebase. Analyze the project structure, identify key components, check for security vulnerabilities, and suggest improvements for better performance and maintainability.",
		buttonText: ">",
	},
	{
		id: "unit_tests",
		title: "Generate Unit Tests",
		description: "Create robust test suites for your existing components",
		icon: "TestIcon",
		actionCommand: "dietcode/generateTests",
		prompt: "Look at my existing components and logic, and generate a comprehensive set of unit tests using a popular testing framework like Vitest or Jest. Ensure edge cases are covered.",
		buttonText: ">",
	},
	{
		id: "nextjs_notetaking_app",
		title: "Build a Next.js App",
		description: "Create a beautiful notetaking app with Next.js and Tailwind",
		icon: "WebAppIcon",
		actionCommand: "dietcode/createNextJsApp",
		prompt: "Make a beautiful Next.js notetaking app, using Tailwind CSS for styling. Set up the basic structure and a simple UI for adding and viewing notes.",
		buttonText: ">",
	},
	{
		id: "terminal_cli_tool",
		title: "Craft a CLI Tool",
		description: "Develop a powerful terminal CLI to automate a cool task",
		icon: "TerminalIcon",
		actionCommand: "dietcode/createCliTool",
		prompt: "Make a terminal CLI tool using Node.js that organizes files in a directory by type, size, or date. It should have options to sort files into folders, show file statistics, find duplicates, and clean up empty directories. Include colorful output and progress indicators.",
		buttonText: ">",
	},
	{
		id: "snake_game",
		title: "Develop a Game",
		description: "Code a classic Snake game that runs in the browser.",
		icon: "GameIcon",
		actionCommand: "dietcode/createSnakeGame",
		prompt: "Make a classic Snake game using HTML, CSS, and JavaScript. The game should be playable in the browser, with keyboard controls for the snake, a scoring system, and a game over state.",
		buttonText: ">",
	},
]
