import * as path from "path"
import { Project } from "ts-morph"

/**
 * ImportFixer: Automates the rewriting of relative imports when files move between layers.
 * Ported and adapted from DietCode's high-sovereignty architecture.
 */
export class ImportFixer {
	private project = new Project()

	constructor(private projectRoot: string) {}

	/**
	 * Scans the project and fixes all relative imports that point to a moved file.
	 */
	public async fixImports(oldPath: string, newPath: string): Promise<void> {
		const absoluteOldPath = path.resolve(this.projectRoot, oldPath)
		const absoluteNewPath = path.resolve(this.projectRoot, newPath)

		// 1. Add all TS files in src to the project
		this.project.addSourceFilesAtPaths("src/**/*.ts")

		for (const sourceFile of this.project.getSourceFiles()) {
			let changed = false
			const imports = sourceFile.getImportDeclarations()

			for (const imp of imports) {
				const specifier = imp.getModuleSpecifierValue()
				if (!specifier.startsWith(".")) continue

				const resolvedImport = path.resolve(path.dirname(sourceFile.getFilePath()), specifier)

				// Normalize paths for comparison (without extension)
				const normOld = absoluteOldPath.replace(/\.ts$/, "")
				const normImport = resolvedImport.replace(/\.ts$/, "")

				if (normImport === normOld) {
					// Calculate new relative path
					let relativePath = path.relative(path.dirname(sourceFile.getFilePath()), absoluteNewPath)
					if (!relativePath.startsWith(".")) relativePath = `./${relativePath}`
					relativePath = relativePath.replace(/\.ts$/, "")

					imp.setModuleSpecifier(relativePath)
					changed = true
				}
			}

			if (changed) {
				await sourceFile.save()
			}
		}
	}

	/**
	 * Fixes outgoing imports within a file that has been moved.
	 */
	public async fixOutgoingImports(newPath: string, oldPath: string): Promise<void> {
		const absoluteOldPath = path.resolve(this.projectRoot, oldPath)
		const absoluteNewPath = path.resolve(this.projectRoot, newPath)

		const sourceFile = this.project.addSourceFileAtPath(absoluteNewPath)
		let changed = false

		for (const imp of sourceFile.getImportDeclarations()) {
			const specifier = imp.getModuleSpecifierValue()
			if (!specifier.startsWith(".")) continue

			// The import was relative to the OLD path. We need to resolve it relative to the old path,
			// then calculate its new relative path from the NEW path.
			const resolvedTarget = path.resolve(path.dirname(absoluteOldPath), specifier)

			let newRelative = path.relative(path.dirname(absoluteNewPath), resolvedTarget)
			if (!newRelative.startsWith(".")) newRelative = `./${newRelative}`
			newRelative = newRelative.replace(/\.ts$/, "")

			imp.setModuleSpecifier(newRelative)
			changed = true
		}

		if (changed) {
			await sourceFile.save()
		}
	}
}
