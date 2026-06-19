/**
 * [LAYER: CORE]
 * Bounded summaries for JoyRide execution artifacts.
 */

import { Buffer } from "node:buffer"

export interface JoyRideCommandOutputSummary {
	text: string
	originalBytes: number
	summaryBytes: number
	truncated: boolean
}

export function summarizeJoyRideCommandOutput(output: string, maxChars = 12_000): JoyRideCommandOutputSummary {
	const originalBytes = Buffer.byteLength(output, "utf8")
	if (output.length <= maxChars) {
		return {
			text: output,
			originalBytes,
			summaryBytes: originalBytes,
			truncated: false,
		}
	}

	const headLength = Math.max(0, Math.floor(maxChars * 0.65))
	const tailLength = Math.max(0, maxChars - headLength)
	const text = `${output.slice(0, headLength)}\n\n[JoyRide summary truncated ${output.length - maxChars} chars]\n\n${output.slice(
		-tailLength,
	)}`

	return {
		text,
		originalBytes,
		summaryBytes: Buffer.byteLength(text, "utf8"),
		truncated: true,
	}
}
