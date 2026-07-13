import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { DietCodeIgnoreController } from "@core/ignore/DietCodeIgnoreController"
import { listFiles } from "@services/glob/list-files"
import { Logger } from "@/shared/services/Logger"
import { type LanguageParser, loadRequiredLanguageParsers } from "./languageParser"

export interface DefinitionScanOptions {
	signal?: AbortSignal
	readConcurrency?: number
	targetExists?: boolean
	onFirstResult?: () => void
	onFileRead?: (bytes: number) => void
}

const SOURCE_EXTENSIONS = new Set(
	["js", "jsx", "ts", "tsx", "py", "rs", "go", "c", "h", "cpp", "hpp", "cs", "rb", "java", "php", "swift", "kt"].map(
		(extension) => `.${extension}`,
	),
)

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason ?? new Error("Definition scan aborted")
}

async function mapBounded<T, R>(
	values: readonly T[],
	concurrency: number,
	map: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(values.length)
	let cursor = 0
	const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
		while (cursor < values.length) {
			const index = cursor++
			results[index] = await map(values[index], index)
		}
	})
	await Promise.all(workers)
	return results
}

export async function parseSourceCodeForDefinitionsTopLevel(
	dirPath: string,
	dietcodeIgnoreController?: DietCodeIgnoreController,
	options: DefinitionScanOptions = {},
): Promise<string> {
	throwIfAborted(options.signal)
	if (options.targetExists !== true) {
		try {
			const stat = await fs.stat(path.resolve(dirPath))
			if (!stat.isDirectory()) return "This directory does not exist or you do not have permission to access it."
		} catch {
			return "This directory does not exist or you do not have permission to access it."
		}
	}

	const [allFiles] = await listFiles(dirPath, false, 200, { signal: options.signal })
	throwIfAborted(options.signal)
	const filesToParse = allFiles.filter((file) => SOURCE_EXTENSIONS.has(path.extname(file))).slice(0, 50)
	const allowedFiles = dietcodeIgnoreController
		? filesToParse.filter((file) => dietcodeIgnoreController.validateAccess(file))
		: filesToParse
	if (allowedFiles.length === 0) return "No source code definitions found."

	const languageParsers = await loadRequiredLanguageParsers(allowedFiles)
	const readConcurrency = Math.max(1, Math.min(8, options.readConcurrency ?? 8))
	const contents = await mapBounded(allowedFiles, readConcurrency, async (filePath) => {
		throwIfAborted(options.signal)
		const content = await fs.readFile(filePath, "utf8")
		options.onFileRead?.(Buffer.byteLength(content))
		return content
	})

	const resultParts: string[] = []
	for (let index = 0; index < allowedFiles.length; index++) {
		throwIfAborted(options.signal)
		const definitions = parseFileContent(allowedFiles[index], contents[index], languageParsers)
		if (!definitions) continue
		if (resultParts.length === 0) options.onFirstResult?.()
		resultParts.push(`${path.relative(dirPath, allowedFiles[index]).toPosix()}\n${definitions}\n`)
	}
	return resultParts.length > 0 ? resultParts.join("") : "No source code definitions found."
}

function parseFileContent(filePath: string, fileContent: string, languageParsers: LanguageParser): string | null {
	const extension = path.extname(filePath).toLowerCase().slice(1)
	const { parser, query } = languageParsers[extension] || {}
	if (!parser || !query) return `Unsupported file type: ${filePath}`

	const output: string[] = []
	try {
		const tree = parser.parse(fileContent)
		if (!tree?.rootNode) return null
		const captures = query.captures(tree.rootNode)
		captures.sort((left, right) => left.node.startPosition.row - right.node.startPosition.row)
		const lines = fileContent.split("\n")
		let lastLine = -1
		for (const capture of captures) {
			const { node, name } = capture
			const startLine = node.startPosition.row
			if (lastLine !== -1 && startLine > lastLine + 1) output.push("|----\n")
			if (name.includes("name") && lines[startLine]) output.push(`│${lines[startLine]}\n`)
			lastLine = node.endPosition.row
		}
	} catch (error) {
		Logger.log(`Error parsing file: ${error}\n`)
	}
	return output.length > 0 ? `|----\n${output.join("")}|----\n` : null
}
