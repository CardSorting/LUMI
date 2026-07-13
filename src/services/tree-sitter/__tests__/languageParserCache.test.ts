import { strict as assert } from "node:assert"
import { afterEach, describe, it } from "mocha"
import type Parser from "web-tree-sitter"
import {
	getLanguageParserCacheStats,
	loadRequiredLanguageParsers,
	resetLanguageParserCacheForTests,
	setLanguageParserRuntimeForTests,
} from "../languageParser"

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise
	})
	return { promise, resolve }
}

describe("tree-sitter grammar cache", () => {
	afterEach(() => resetLanguageParserCacheForTests())

	it("singleflights parser initialization, grammar loading, and query compilation", async () => {
		const languageReady = deferred<Parser.Language>()
		let initCalls = 0
		let loadCalls = 0
		let queryCalls = 0
		let parserCreations = 0
		const language = {
			query: () => {
				queryCalls++
				return {} as Parser.Query
			},
		} as unknown as Parser.Language

		setLanguageParserRuntimeForTests({
			init: async () => {
				initCalls++
			},
			loadLanguage: async () => {
				loadCalls++
				return languageReady.promise
			},
			createParser: () => {
				parserCreations++
				return { setLanguage: () => undefined } as unknown as Parser
			},
		})

		const first = loadRequiredLanguageParsers(["a.ts"])
		const second = loadRequiredLanguageParsers(["b.ts"])
		await Promise.resolve()
		await Promise.resolve()
		assert.equal(initCalls, 1)
		assert.equal(loadCalls, 1)

		languageReady.resolve(language)
		const [firstParsers, secondParsers] = await Promise.all([first, second])
		assert.notEqual(firstParsers.ts.parser, secondParsers.ts.parser)
		assert.equal(queryCalls, 1)
		assert.equal(parserCreations, 2)
		assert.deepEqual(getLanguageParserCacheStats(), {
			initialized: true,
			parserInitCalls: 1,
			grammarLoads: 1,
			grammarCacheHits: 1,
			cachedGrammars: 1,
		})
	})
})
