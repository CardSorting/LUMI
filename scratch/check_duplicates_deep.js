import fs from "fs"

const content = fs.readFileSync("/Users/bozoegg/Downloads/codemarie-new/src/shared/api.ts", "utf8")

function findDuplicates(objectName) {
	const startIdx = content.indexOf(`export const ${objectName} = {`)
	if (startIdx === -1) return []

	let balance = 0
	let endIdx = -1
	for (let i = startIdx; i < content.length; i++) {
		if (content[i] === "{") balance++
		else if (content[i] === "}") {
			balance--
			if (balance === 0) {
				endIdx = i
				break
			}
		}
	}

	if (endIdx === -1) return []

	const text = content.substring(startIdx, endIdx + 1)
	const keys = []
	const lines = text.split("\n")
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
	return duplicates
}

const objects = ["vertexModels", "geminiModels", "anthropicModels", "openAiModels", "ollamaModels", "mistralModels", "groqModels"]
objects.forEach((obj) => {
	const dups = findDuplicates(obj)
	if (dups.length > 0) {
		console.log(`Duplicates in ${obj}:`, dups)
	}
})
