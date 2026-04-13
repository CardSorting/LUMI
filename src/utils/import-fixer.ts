import * as fs from "fs/promises"
import * as path from "path"
import * as ts from "typescript"

/**
 * ImportFixer: Automates the rewriting of relative imports when files move between layers.
 * Ported and adapted from DietCode's high-sovereignty architecture.
 */
export class ImportFixer {
	constructor(private projectRoot: string) {}

	/**
	 * Scans the project and fixes all relative imports that point to a moved file.
	 */
	public async fixImports(oldPath: string, newPath: string): Promise<void> {
		const absoluteOldPath = path.resolve(this.projectRoot, oldPath)
		const absoluteNewPath = path.resolve(this.projectRoot, newPath)

		// Get all TS files in src
		const files = await this.glob("src/**/*.ts")

		for (const file of files) {
			const absoluteSourcePath = path.resolve(this.projectRoot, file)
			const content = await fs.readFile(absoluteSourcePath, "utf-8")
			const sourceFile = ts.createSourceFile(absoluteSourcePath, content, ts.ScriptTarget.Latest, true)

			let changed = false
			let newContent = content

			ts.forEachChild(sourceFile, (node) => {
				if (ts.isImportDeclaration(node)) {
					const moduleSpecifier = node.moduleSpecifier
					if (ts.isStringLiteral(moduleSpecifier)) {
						const specifier = moduleSpecifier.text
						if (specifier.startsWith(".")) {
							const resolvedImport = path.resolve(path.dirname(absoluteSourcePath), specifier)

							// Normalize paths for comparison (without extension)
							const normOld = absoluteOldPath.replace(/\.ts$/, "")
							const normImport = resolvedImport.replace(/\.ts$/, "")

							if (normImport === normOld) {
								// Calculate new relative path
								let relativePath = path.relative(path.dirname(absoluteSourcePath), absoluteNewPath)
								if (!relativePath.startsWith(".")) relativePath = `./${relativePath}`
								relativePath = relativePath.replace(/\.ts$/, "")

								const start = moduleSpecifier.getStart(sourceFile) + 1 // +1 for quote
								const end = moduleSpecifier.getEnd() - 1 // -1 for quote
								newContent = newContent.substring(0, start) + relativePath + newContent.substring(end)
								changed = true
							}
						}
					}
				}
			})

			if (changed) {
				await fs.writeFile(absoluteSourcePath, newContent, "utf-8")
			}
		}
	}

	/**
	 * Fixes outgoing imports within a file that has been moved.
	 */
	public async fixOutgoingImports(newPath: string, oldPath: string): Promise<void> {
		const absoluteOldPath = path.resolve(this.projectRoot, oldPath)
		const absoluteNewPath = path.resolve(this.projectRoot, newPath)

		const content = await fs.readFile(absoluteNewPath, "utf-8")
		const sourceFile = ts.createSourceFile(absoluteNewPath, content, ts.ScriptTarget.Latest, true)

		let changed = false
		let newContent = content

		ts.forEachChild(sourceFile, (node) => {
			if (ts.isImportDeclaration(node)) {
				const moduleSpecifier = node.moduleSpecifier
				if (ts.isStringLiteral(moduleSpecifier)) {
					const specifier = moduleSpecifier.text
					if (specifier.startsWith(".")) {
						// The import was relative to the OLD path.
						const resolvedTarget = path.resolve(path.dirname(absoluteOldPath), specifier)

						let newRelative = path.relative(path.dirname(absoluteNewPath), resolvedTarget)
						if (!newRelative.startsWith(".")) newRelative = `./${newRelative}`
						newRelative = newRelative.replace(/\.ts$/, "")

						const start = moduleSpecifier.getStart(sourceFile) + 1
						const end = moduleSpecifier.getEnd() - 1
						newContent = newContent.substring(0, start) + newRelative + newContent.substring(end)
						changed = true
					}
				}
			}
		})

		if (changed) {
			await fs.writeFile(absoluteNewPath, newContent, "utf-8")
		}
	}

	private async glob(pattern: string): Promise<string[]> {
		// Minimal glob implementation for src/**/*.ts
		const results: string[] = []
		const scan = async (dir: string) => {
			const entries = await fs.readdir(dir, { withFileTypes: true })
			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name)
				if (entry.isDirectory()) {
					if (entry.name !== "node_modules" && !entry.name.startsWith(".")) {
						await scan(fullPath)
					}
				} else if (entry.name.endsWith(".ts")) {
					results.push(path.relative(this.projectRoot, fullPath))
				}
			}
		}
		const srcDir = path.resolve(this.projectRoot, "src")
		await scan(srcDir)
		return results
	}
}
