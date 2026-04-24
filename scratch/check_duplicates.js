import fs from "fs"

const content = fs.readFileSync("/Users/bozoegg/Downloads/codemarie-new/src/shared/api.ts", "utf8")

const vertexModelsStart = content.indexOf("export const vertexModels = {")
const vertexModelsEnd = content.indexOf("} as const satisfies Record<string, ModelInfo>", vertexModelsStart)
const vertexModelsText = content.substring(vertexModelsStart, vertexModelsEnd + 1)

const keys = []
const lines = vertexModelsText.split("\n")
for (const line of lines) {
	const match = line.match(/^\s*"([^"]+)"\s*:/)
	if (match) {
		keys.push(match[1])
	}
}

const counts = {}
const duplicates = []
for (const key of keys) {
	counts[key] = (counts[key] || 0) + 1
	if (counts[key] === 2) {
		duplicates.push(key)
	}
}

console.log("Duplicates in vertexModels:", duplicates)

const geminiModelsStart = content.indexOf("export const geminiModels = {")
const geminiModelsEnd = content.indexOf("} as const satisfies Record<string, ModelInfo>", geminiModelsStart)
const geminiModelsText = content.substring(geminiModelsStart, geminiModelsEnd + 1)

const geminiKeys = []
const geminiLines = geminiModelsText.split("\n")
for (const line of geminiLines) {
	const match = line.match(/^\s*"([^"]+)"\s*:/)
	if (match) {
		geminiKeys.push(match[1])
	}
}

const geminiCounts = {}
const geminiDuplicates = []
for (const key of geminiKeys) {
	geminiCounts[key] = (geminiCounts[key] || 0) + 1
	if (geminiCounts[key] === 2) {
		geminiDuplicates.push(key)
	}
}

console.log("Duplicates in geminiModels:", geminiDuplicates)
