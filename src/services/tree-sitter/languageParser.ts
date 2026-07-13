import * as path from "node:path"
import Parser from "web-tree-sitter"
import {
	cppQuery,
	cQuery,
	csharpQuery,
	goQuery,
	javaQuery,
	javascriptQuery,
	kotlinQuery,
	phpQuery,
	pythonQuery,
	rubyQuery,
	rustQuery,
	swiftQuery,
	typescriptQuery,
} from "./queries"

export interface LanguageParser {
	[key: string]: {
		parser: Parser
		query: Parser.Query
	}
}

type LoadedGrammar = { language: Parser.Language; query: Parser.Query }
type LanguageParserRuntime = {
	init: () => Promise<void>
	loadLanguage: (wasmPath: string) => Promise<Parser.Language>
	createParser: () => Parser
}

const defaultRuntime: LanguageParserRuntime = {
	init: () => Parser.init(),
	loadLanguage: (wasmPath) => Parser.Language.load(wasmPath),
	createParser: () => new Parser(),
}
let runtime = defaultRuntime

const grammarByExtension = new Map<string, Promise<LoadedGrammar>>()
let parserInitialization: Promise<void> | undefined
let parserInitCalls = 0
let grammarLoads = 0
let grammarCacheHits = 0

function initializeParser(): Promise<void> {
	if (!parserInitialization) {
		parserInitCalls++
		parserInitialization = runtime.init().catch((error) => {
			parserInitialization = undefined
			throw error
		})
	}
	return parserInitialization
}

function grammarSpec(extension: string): { languageName: string; querySource: string } {
	switch (extension) {
		case "js":
		case "jsx":
			return { languageName: "javascript", querySource: javascriptQuery }
		case "ts":
			return { languageName: "typescript", querySource: typescriptQuery }
		case "tsx":
			return { languageName: "tsx", querySource: typescriptQuery }
		case "py":
			return { languageName: "python", querySource: pythonQuery }
		case "rs":
			return { languageName: "rust", querySource: rustQuery }
		case "go":
			return { languageName: "go", querySource: goQuery }
		case "cpp":
		case "hpp":
			return { languageName: "cpp", querySource: cppQuery }
		case "c":
		case "h":
			return { languageName: "c", querySource: cQuery }
		case "cs":
			return { languageName: "c_sharp", querySource: csharpQuery }
		case "rb":
			return { languageName: "ruby", querySource: rubyQuery }
		case "java":
			return { languageName: "java", querySource: javaQuery }
		case "php":
			return { languageName: "php", querySource: phpQuery }
		case "swift":
			return { languageName: "swift", querySource: swiftQuery }
		case "kt":
			return { languageName: "kotlin", querySource: kotlinQuery }
		default:
			throw new Error(`Unsupported language: ${extension}`)
	}
}

async function loadGrammar(extension: string): Promise<LoadedGrammar> {
	const cached = grammarByExtension.get(extension)
	if (cached) {
		grammarCacheHits++
		return cached
	}

	const loading = (async () => {
		await initializeParser()
		const { languageName, querySource } = grammarSpec(extension)
		grammarLoads++
		const language = await runtime.loadLanguage(path.join(__dirname, `tree-sitter-${languageName}.wasm`))
		return { language, query: language.query(querySource) }
	})().catch((error) => {
		grammarByExtension.delete(extension)
		throw error
	})
	grammarByExtension.set(extension, loading)
	return loading
}

/**
 * Load each WASM grammar/query once per extension host. Parser instances remain
 * invocation-local because web-tree-sitter parsers are mutable and must not be
 * shared by concurrent definition scans.
 */
export async function loadRequiredLanguageParsers(filesToParse: string[]): Promise<LanguageParser> {
	const extensions = [...new Set(filesToParse.map((file) => path.extname(file).toLowerCase().slice(1)))].sort()
	const grammars = await Promise.all(extensions.map(async (extension) => [extension, await loadGrammar(extension)] as const))
	const parsers: LanguageParser = {}
	for (const [extension, grammar] of grammars) {
		const parser = runtime.createParser()
		parser.setLanguage(grammar.language)
		parsers[extension] = { parser, query: grammar.query }
	}
	return parsers
}

export function getLanguageParserCacheStats(): {
	initialized: boolean
	parserInitCalls: number
	grammarLoads: number
	grammarCacheHits: number
	cachedGrammars: number
} {
	return {
		initialized: Boolean(parserInitialization),
		parserInitCalls,
		grammarLoads,
		grammarCacheHits,
		cachedGrammars: grammarByExtension.size,
	}
}

export function resetLanguageParserCacheForTests(): void {
	grammarByExtension.clear()
	parserInitialization = undefined
	parserInitCalls = 0
	grammarLoads = 0
	grammarCacheHits = 0
	runtime = defaultRuntime
}

export function setLanguageParserRuntimeForTests(overrides: LanguageParserRuntime): void {
	resetLanguageParserCacheForTests()
	runtime = overrides
}
