import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import * as fs from "fs/promises"
import * as path from "path"
import { DietCodeDefaultTool } from "@/shared/tools"
import { generateLayerComment } from "@/utils/joy-zoning"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"

interface ScaffoldParams {
	name: string
	layer: string
	dir?: string
}

/**
 * SovereignScaffoldHandler: Born Sovereign.
 * Creates perfectly aligned files for specific JoyZoning layers.
 */
export class SovereignScaffoldHandler implements IToolHandler {
	readonly name = DietCodeDefaultTool.SOVEREIGN_SCAFFOLD

	getDescription(block: ToolUse): string {
		const params = block.params as unknown as ScaffoldParams
		return `[scaffold ${params.layer} module: ${params.name}]`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const params = block.params as unknown as ScaffoldParams
		const name = params.name
		const layer = (params.layer || "").toLowerCase()
		const dirHint = params.dir || "" // Optional subdirectory

		if (!name || !layer) {
			return await config.callbacks.sayAndCreateMissingParamError(this.name, !name ? "name" : "layer")
		}

		// 1. Determine destination path
		let baseDir = "src"
		switch (layer) {
			case "domain":
				baseDir = "src/domain"
				break
			case "core":
				baseDir = "src/core"
				break
			case "infrastructure":
				baseDir = "src/infrastructure"
				break
			case "plumbing":
				baseDir = "src/utils"
				break
			case "ui":
				baseDir = "src/ui"
				break
			default:
				return formatResponse.toolResult(`Unknown layer: ${layer}. Valid: domain, core, infrastructure, plumbing, ui`)
		}

		const fileName = `${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}.ts`
		const relPath = path.join(baseDir, dirHint, fileName)
		const absPath = path.resolve(config.cwd, relPath)

		// 2. Generate Template
		const interfaceName = this.toPascalCase(name)
		const tag = layer === "plumbing" ? "UTILS" : layer.toUpperCase()

		let content = generateLayerComment(relPath, tag) || ""

		if (layer === "domain") {
			content += `export interface ${interfaceName} {\n\t// Core Domain state and business rules\n\tid: string;\n}\n`
		} else if (layer === "core") {
			content += `/**\n * Orchestrates domain logic for ${name}\n */\nexport class ${interfaceName}Coordinator {\n\tconstructor() {}\n\n\tpublic async execute(): Promise<void> {\n\t\t// Orchestration here\n\t}\n}\n`
		} else if (layer === "infrastructure") {
			content += `/**\n * I/O Adapter for ${name}\n */\nexport class ${interfaceName}Adapter {\n\tconstructor() {}\n}\n`
		} else {
			content += `export const ${interfaceName}Utility = () => {\n\t// Utility logic\n};\n`
		}

		// 3. Write and Register
		try {
			await fs.mkdir(path.dirname(absPath), { recursive: true })
			await fs.writeFile(absPath, content, "utf-8")

			// Generate test file
			const testPath = relPath.replace(".ts", ".test.ts")
			const testAbsPath = path.resolve(config.cwd, testPath)

			const testContent =
				`import * as fs from "fs";\n` +
				`import * as path from "path";\n` +
				`import { SovereignValidator } from "../${baseDir.split("/").length > 1 ? "../" : ""}integrity/SovereignValidator";\n\n` +
				`describe("${interfaceName} Sovereignty", () => {\n` +
				`  it("should maintain structural integrity", () => {\n` +
				`    const content = fs.readFileSync(path.resolve(__dirname, "${fileName}"), "utf-8");\n` +
				`    const validator = new SovereignValidator(process.cwd());\n` +
				`    const result = validator.validate("${fileName}", content);\n` +
				`    if (!result.ok) {\n` +
				`      throw new Error("Architectural Violation: " + result.violations.join(", "));\n` +
				`    }\n` +
				`    console.log("✅ Integrity Score: " + result.score + "%");\n` +
				`  });\n` +
				`});\n`

			await fs.writeFile(testAbsPath, testContent, "utf-8")

			return formatResponse.toolResult(
				`✅ Sovereign module '${name}' created at ${relPath}.\n` +
					`✅ Self-verifying unit test created at ${testPath}.\n` +
					`Layer: ${layer.toUpperCase()}\n` +
					`Tag: [LAYER: ${tag}]`,
			)
		} catch (error) {
			return `Scaffolding failed: ${(error as Error)?.message}`
		}
	}

	private toPascalCase(str: string): string {
		return str
			.split(/[^a-z0-9]/i)
			.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
			.join("")
	}
}
