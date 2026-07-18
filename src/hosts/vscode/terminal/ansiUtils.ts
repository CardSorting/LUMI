export function ansiRegex({ onlyFirst = false } = {}) {
	// Valid string terminator sequences are BEL, ESC\, and 0x9c
	const ST = "(?:\\u0007|\\u001B\\u005C|\\u009C)"
	const pattern = [
		`[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?${ST})`,
		"(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))",
	].join("|")

	return new RegExp(pattern, onlyFirst ? undefined : "g")
}

export function stripAnsi(string: string): string {
	return string.replace(ansiRegex(), "")
}

export function resolveCarriageReturns(text: string): string {
	if (!text.includes("\r")) {
		return text
	}
	const lines = text.split("\n")
	const resolvedLines = lines.map((line) => {
		if (!line.includes("\r")) return line
		const parts = line.split("\r")
		let result = ""
		for (const part of parts) {
			result = part + result.slice(part.length)
		}
		return result
	})
	return resolvedLines.join("\n")
}
