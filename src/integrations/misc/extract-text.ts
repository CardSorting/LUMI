import { isUtf8 } from "node:buffer"
import fs from "node:fs/promises"
import * as path from "node:path"
import ExcelJS from "exceljs"
import * as iconv from "iconv-lite"
import { isBinaryFile } from "isbinaryfile"
import * as chardet from "jschardet"
import mammoth from "mammoth"
// @ts-expect-error-next-line
import pdf from "pdf-parse/lib/pdf-parse"
import { formatBytes, MAX_CONTENT_SIZE_BYTES } from "@/shared/content-limits"
import { Logger } from "@/shared/services/Logger"
import { sanitizeNotebookForLLM } from "./notebook-utils"

const MAX_TEXT_FILE_BYTES = 20 * 1000 * 1024
const DEFAULT_TEXT_PREFIX_BYTES = MAX_CONTENT_SIZE_BYTES * 4 + 4
const TRUNCATION_NOTICE_RESERVE_BYTES = 512

export interface TextExtractionStats {
	fileOpens: number
	metadataCalls: number
	readOperations: number
	bytesRead: number
	bytesCopied: number
	utf8FastPath: boolean
	truncated: boolean
	durationMs: number
}

export interface TextExtractionOptions {
	signal?: AbortSignal
	maxReadBytes?: number
	onFirstBytes?: () => void
	onStats?: (stats: Readonly<TextExtractionStats>) => void
	now?: () => number
}

function abortError(): Error {
	const error = new Error("File read aborted")
	error.name = "AbortError"
	return error
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw abortError()
}

export async function detectEncoding(fileBuffer: Buffer, fileExtension?: string): Promise<string> {
	if (isUtf8(fileBuffer)) return "utf8"
	const detected: unknown = chardet.detect(fileBuffer)
	if (typeof detected === "string") {
		return detected
	}
	if (typeof detected === "object" && detected !== null && "encoding" in detected && typeof detected.encoding === "string") {
		return detected.encoding
	}
	if (fileExtension) {
		const isBinary = await isBinaryFile(fileBuffer).catch(() => false)
		if (isBinary) {
			throw new Error(`Cannot read text for file type: ${fileExtension}`)
		}
	}
	return "utf8"
}

export async function extractTextFromFile(filePath: string): Promise<string> {
	try {
		return await callTextExtractionFunctions(filePath)
	} catch (error) {
		if (isFileNotFoundError(error)) throw new Error(`File not found: ${filePath}`)
		throw error
	}
}

/**
 * Opens ordinary text files once, reads a bounded prefix, and automatically
 * truncates decoded content if it exceeds the context limit.
 */
export async function callTextExtractionFunctions(filePath: string, options: TextExtractionOptions = {}): Promise<string> {
	const now = options.now ?? performance.now.bind(performance)
	const startedAt = now()
	const stats: TextExtractionStats = {
		fileOpens: 0,
		metadataCalls: 0,
		readOperations: 0,
		bytesRead: 0,
		bytesCopied: 0,
		utf8FastPath: false,
		truncated: false,
		durationMs: 0,
	}
	const fileExtension = path.extname(filePath).toLowerCase()
	try {
		throwIfAborted(options.signal)
		let content: string
		let prefixWasBounded = false
		let totalFileBytes: number | undefined

		switch (fileExtension) {
			case ".pdf":
				content = await extractTextFromPDF(filePath, options, stats)
				break
			case ".docx":
				content = await extractTextFromDOCX(filePath)
				break
			case ".ipynb":
				content = await extractTextFromIPYNB(filePath, options, stats)
				break
			case ".xlsx":
				content = await extractTextFromExcel(filePath)
				break
			default: {
				const readResult = await readBoundedTextPrefix(filePath, options, stats)
				totalFileBytes = readResult.totalFileBytes
				prefixWasBounded = readResult.prefixWasBounded
				if (isUtf8(readResult.buffer)) {
					stats.utf8FastPath = true
					content = readResult.buffer.toString("utf8")
				} else {
					const encoding = await detectEncoding(readResult.buffer, fileExtension)
					content = iconv.decode(readResult.buffer, encoding)
				}
				stats.bytesCopied += readResult.buffer.byteLength + Buffer.byteLength(content, "utf8")
				break
			}
		}

		throwIfAborted(options.signal)
		if (prefixWasBounded && totalFileBytes !== undefined) {
			stats.truncated = true
			return formatBoundedTextPrefix(content, totalFileBytes, "file")
		}
		const contentBytes = Buffer.byteLength(content, "utf8")
		stats.truncated = contentBytes > MAX_CONTENT_SIZE_BYTES
		return stats.truncated ? formatBoundedTextPrefix(content, contentBytes, "content") : content
	} finally {
		stats.durationMs = Math.max(0, now() - startedAt)
		try {
			options.onStats?.({ ...stats })
		} catch {
			// Instrumentation is advisory and fail-open.
		}
	}
}

async function readBoundedTextPrefix(
	filePath: string,
	options: TextExtractionOptions,
	stats: TextExtractionStats,
): Promise<{ buffer: Buffer; totalFileBytes: number; prefixWasBounded: boolean }> {
	throwIfAborted(options.signal)
	stats.fileOpens++
	const handle = await fs.open(filePath, "r")
	try {
		stats.metadataCalls++
		const fileStat = await handle.stat()
		if (fileStat.size > MAX_TEXT_FILE_BYTES) throw new Error(`File is too large to read into context.`)

		const configuredReadLimit = options.maxReadBytes
		const requestedLimit =
			configuredReadLimit === undefined || !Number.isFinite(configuredReadLimit)
				? DEFAULT_TEXT_PREFIX_BYTES
				: Math.min(DEFAULT_TEXT_PREFIX_BYTES, Math.max(1, Math.floor(configuredReadLimit)))
		const bytesToRead = Math.min(fileStat.size, requestedLimit)
		const buffer = Buffer.allocUnsafe(bytesToRead)
		let offset = 0
		while (offset < bytesToRead) {
			throwIfAborted(options.signal)
			stats.readOperations++
			const read = await handle.read(buffer, offset, bytesToRead - offset, offset)
			if (read.bytesRead === 0) break
			if (offset === 0) {
				try {
					options.onFirstBytes?.()
				} catch {
					// Advisory first-byte telemetry must never fail a read.
				}
			}
			offset += read.bytesRead
			stats.bytesRead += read.bytesRead
		}
		throwIfAborted(options.signal)
		return {
			buffer: offset === buffer.byteLength ? buffer : buffer.subarray(0, offset),
			totalFileBytes: fileStat.size,
			prefixWasBounded: fileStat.size > offset,
		}
	} finally {
		await handle.close()
	}
}

function formatBoundedTextPrefix(content: string, totalBytes: number, source: "file" | "content"): string {
	const encodedContent = Buffer.from(content, "utf8")
	const visibleLimit = Math.max(1, MAX_CONTENT_SIZE_BYTES - TRUNCATION_NOTICE_RESERVE_BYTES)
	const visibleBuffer = sliceCompleteUtf8Prefix(encodedContent, visibleLimit)
	const visibleContent = visibleBuffer.toString("utf8")
	const notice = `\n\n---\n\n[FILE TRUNCATED: This ${source} is ${formatBytes(totalBytes)} but only a bounded ${formatBytes(visibleBuffer.byteLength)} UTF-8 prefix is shown. Use search_files to find specific patterns, or execute_command with grep/head/tail for targeted reading.]`
	return `${visibleContent}${notice}`
}

function sliceCompleteUtf8Prefix(content: Buffer, maximumBytes: number): Buffer {
	let end = Math.min(content.byteLength, maximumBytes)
	if (end === content.byteLength) return content
	while (end > 0 && (content[end] & 0xc0) === 0x80) end--
	return content.subarray(0, end)
}

function isFileNotFoundError(error: unknown): boolean {
	return (
		(typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") ||
		(error instanceof Error && error.message.includes("ENOENT"))
	)
}

async function extractTextFromPDF(filePath: string, options: TextExtractionOptions, stats: TextExtractionStats): Promise<string> {
	stats.fileOpens++
	stats.readOperations++
	const dataBuffer = await fs.readFile(filePath, { signal: options.signal })
	stats.bytesRead += dataBuffer.byteLength
	reportFirstBytes(options)
	const data = await pdf(dataBuffer)
	return data.text
}

async function extractTextFromDOCX(filePath: string): Promise<string> {
	const result = await mammoth.extractRawText({ path: filePath })
	return result.value
}

async function extractTextFromIPYNB(
	filePath: string,
	options: TextExtractionOptions,
	stats: TextExtractionStats,
): Promise<string> {
	stats.fileOpens++
	stats.readOperations++
	const fileBuffer = await fs.readFile(filePath, { signal: options.signal })
	stats.bytesRead += fileBuffer.byteLength
	reportFirstBytes(options)
	const encoding = await detectEncoding(fileBuffer)
	const data = iconv.decode(fileBuffer, encoding)

	// Strip all outputs to reduce context size - outputs aren't needed for understanding
	// notebook structure. For Jupyter commands, the specific cell's outputs are included
	// separately via sanitizeCellForLLM which preserves text outputs.
	return sanitizeNotebookForLLM(data, true)
}

function reportFirstBytes(options: TextExtractionOptions): void {
	try {
		options.onFirstBytes?.()
	} catch {
		// Advisory first-byte telemetry must never fail a read.
	}
}

/**
 * Format the data inside Excel cells
 */
function formatCellValue(cell: ExcelJS.Cell): string {
	const value = cell.value
	if (value === null || value === undefined) {
		return ""
	}

	// Handle error values (#DIV/0!, #N/A, etc.)
	if (typeof value === "object" && "error" in value) {
		return `[Error: ${value.error}]`
	}

	// Handle dates - ExcelJS can parse them as Date objects
	if (value instanceof Date) {
		return value.toISOString().split("T")[0] // Just the date part
	}

	// Handle rich text
	if (typeof value === "object" && "richText" in value) {
		return value.richText.map((rt) => rt.text).join("")
	}

	// Handle hyperlinks
	if (typeof value === "object" && "text" in value && "hyperlink" in value) {
		return `${value.text} (${value.hyperlink})`
	}

	// Handle formulas - get the calculated result
	if (typeof value === "object" && "formula" in value) {
		if ("result" in value && value.result !== undefined && value.result !== null) {
			return value.result.toString()
		}
		return `[Formula: ${value.formula}]`
	}

	return value.toString()
}

/**
 * Extract and format text from xlsx files
 */
async function extractTextFromExcel(filePath: string): Promise<string> {
	const workbook = new ExcelJS.Workbook()
	let excelText = ""

	try {
		await workbook.xlsx.readFile(filePath)

		workbook.eachSheet((worksheet, _sheetId) => {
			// Skip hidden sheets
			if (worksheet.state === "hidden" || worksheet.state === "veryHidden") {
				return
			}

			excelText += `--- Sheet: ${worksheet.name} ---\n`

			worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
				// Optional: limit processing for very large sheets
				if (rowNumber > 50000) {
					excelText += `[... truncated at row ${rowNumber} ...]\n`
					return false
				}

				const rowTexts: string[] = []
				let hasContent = false

				row.eachCell({ includeEmpty: true }, (cell, _colNumber) => {
					const cellText = formatCellValue(cell)
					if (cellText.trim()) {
						hasContent = true
					}
					rowTexts.push(cellText)
				})

				// Only add rows with actual content
				if (hasContent) {
					excelText += `${rowTexts.join("\t")}\n`
				}

				return true
			})

			excelText += "\n" // Blank line between sheets
		})

		return excelText.trim()
	} catch (error: unknown) {
		Logger.error(`Error extracting text from Excel ${filePath}:`, error)
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to extract text from Excel: ${errorMessage}`)
	}
}

/**
 * Helper function used to load file(s) and format them into a string
 */
export async function processFilesIntoText(files: string[]): Promise<string> {
	const fileContentsPromises = files.map(async (filePath) => {
		try {
			// Check if file exists and is binary
			//const isBinary = await isBinaryFile(filePath).catch(() => false)
			//if (isBinary) {
			//	return `<file_content path="${filePath.toPosix()}">\n(Binary file, unable to display content)\n</file_content>`
			//}
			const content = await extractTextFromFile(filePath)
			return `<file_content path="${filePath.toPosix()}">\n${content}\n</file_content>`
		} catch (error) {
			Logger.error(`Error processing file ${filePath}:`, error)
			const errorMessage = error instanceof Error ? error.message : String(error)
			return `<file_content path="${filePath.toPosix()}">\nError fetching content: ${errorMessage}\n</file_content>`
		}
	})

	const fileContents = await Promise.all(fileContentsPromises)

	const validFileContents = fileContents.filter((content) => content !== null).join("\n\n")

	if (validFileContents) {
		return `Files attached by the user:\n\n${validFileContents}`
	}

	// returns empty string if no files were loaded properly
	return ""
}
