/**
 * Utility to detect and mask sensitive data (API keys, tokens) in strings.
 * Use this before logging or displaying potentially sensitive information.
 */
export class SensitiveDataMasker {
	private constructor() {}
	private static readonly PATTERNS = [
		// Anthropic: sk-ant-api03-...
		/sk-ant-api03-[a-zA-Z0-9\-_]{80,}/g,
		// OpenAI: sk-...
		/sk-[a-zA-Z0-9]{40,}/g,
		// Google AI (Gemini): AIza...
		/AIza[a-zA-Z0-9\-_]{30,}/g,
		// AWS Access Key ID
		/(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g,
		// Generic Bearer Token
		/Bearer\s+[a-zA-Z0-9\-._~+/]+=*/g,
		// Azure API Key
		/[a-f0-9]{32}/g,
	]

	/**
	 * Mask sensitive information in a string.
	 * Replaces detected keys with a masked version (e.g., sk-an...****)
	 */
	public static mask(text: string | undefined): string {
		if (!text) return ""

		let maskedText = text
		for (const pattern of SensitiveDataMasker.PATTERNS) {
			maskedText = maskedText.replace(pattern, (match) => {
				if (match.length <= 8) return "****"
				return `${match.substring(0, 6)}...${match.substring(match.length - 4)} (masked)`
			})
		}

		return maskedText
	}
}
