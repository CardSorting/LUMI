import { Anthropic } from "@anthropic-ai/sdk"
import * as path from "path"
import { extractImageContent } from "./extract-images"
import { callTextExtractionFunctions, type TextExtractionOptions } from "./extract-text"

export type FileContentResult = {
	text: string
	imageBlock?: Anthropic.ImageBlockParam
}

/**
 * Extract content from a file, handling both text and images
 * Extra logic for handling images based on whether the model supports images
 */
export async function extractFileContent(
	absolutePath: string,
	modelSupportsImages: boolean,
	options: TextExtractionOptions = {},
): Promise<FileContentResult> {
	options.signal?.throwIfAborted()
	const fileExtension = path.extname(absolutePath).toLowerCase()
	const imageExtensions = [".png", ".jpg", ".jpeg", ".webp"]
	const isImage = imageExtensions.includes(fileExtension)

	if (isImage && modelSupportsImages) {
		const imageResult = await extractImageContent(absolutePath, options.signal)
		if (options.signal?.aborted) throw options.signal.reason ?? new Error("Image read aborted")

		if (imageResult.success) {
			return {
				text: "Successfully read image",
				imageBlock: imageResult.imageBlock,
			}
		}
		if (imageResult.error.includes("ENOENT")) throw new Error(`File not found: ${absolutePath}`)
		throw new Error(imageResult.error)
	}
	if (isImage && !modelSupportsImages) {
		throw new Error(`Current model does not support image input`)
	}
	// Handle text files using existing extraction functions
	try {
		const textContent = await callTextExtractionFunctions(absolutePath, options)
		return {
			text: textContent,
		}
	} catch (error) {
		if (options.signal?.aborted) throw options.signal.reason ?? error
		if (error instanceof Error && error.name === "AbortError") throw error
		if (
			(typeof error === "object" &&
				error !== null &&
				"code" in error &&
				(error as NodeJS.ErrnoException).code === "ENOENT") ||
			(error instanceof Error && error.message.includes("ENOENT"))
		) {
			throw new Error(`File not found: ${absolutePath}`)
		}
		const errorMessage = error instanceof Error ? error.message : "Unknown error"
		throw new Error(`Error reading file: ${errorMessage}`)
	}
}
