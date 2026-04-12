import type { WorkspaceRoot } from "@shared/multi-root/types"
import * as childProcess from "child_process"
import * as fs from "fs"
import type { FzfResultItem } from "fzf"
import * as path from "path"
import * as readline from "readline"
import { WorkspaceRootManager } from "@/core/workspace"
import { HostProvider } from "@/hosts/host-provider"
import { GetOpenTabsRequest } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import { getBinaryLocation } from "@/utils/fs"

// Wrapper function for childProcess.spawn
export type SpawnFunction = typeof childProcess.spawn
export const getSpawnFunction = (): SpawnFunction => childProcess.spawn

export async function searchFilesWithKeyword(
	keyword: string,
	workspacePath: string,
	limit = 100,
	signal?: AbortSignal,
): Promise<string[]> {
	const rgPath = await getBinaryLocation("rg")

	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			return reject(new Error("Ripgrep search aborted"))
		}
		// Arguments for ripgrep to list files containing the keyword
		const args = [
			"-l", // --files-with-matches
			"-i", // case-insensitive
			"--follow",
			"--hidden",
			"-g",
			"!**/{node_modules,.git,.github,out,dist,__pycache__,.venv,.env,venv,env,.cache,tmp,temp}/**",
			keyword,
			workspacePath,
		]

		const rgProcess = getSpawnFunction()(rgPath, args)

		const onAbort = () => {
			rgProcess.kill()
			reject(new Error("Ripgrep search aborted"))
		}
		signal?.addEventListener("abort", onAbort)
		const rl = readline.createInterface({ input: rgProcess.stdout })

		const fileResults: string[] = []
		let count = 0

		rl.on("line", (line) => {
			if (count >= limit) {
				rl.close()
				rgProcess.kill()
				return
			}

			const relativePath = path.relative(workspacePath, line)
			fileResults.push(relativePath)
			count++
		})

		let errorOutput = ""
		rgProcess.stderr.on("data", (data) => {
			errorOutput += data.toString()
		})

		rl.on("close", () => {
			signal?.removeEventListener("abort", onAbort)
			if (errorOutput && fileResults.length === 0) {
				// Exit code 1 means no matches found, which is expected behavior
				if (!errorOutput.includes("No such file or directory")) {
					resolve([])
					return
				}
				reject(new Error(`ripgrep process error: ${errorOutput.trim()}`))
				return
			}
			resolve(fileResults)
		})

		rgProcess.on("error", (error) => {
			signal?.removeEventListener("abort", onAbort)
			reject(new Error(`ripgrep process error: ${error.message}`))
		})
	})
}

export async function searchSymbolInFiles(symbol: string, targetFiles: string[], workspacePath: string): Promise<string[]> {
	if (targetFiles.length === 0) return []

	const rgPath = await getBinaryLocation("rg")

	return new Promise((resolve) => {
		// Build pattern for common symbol definitions (class, function, const, interface, type)
		const pattern = `\\b(class|function|const|let|var|interface|type|enum)\\s+${symbol}\\b|\\b${symbol}\\s*[:=]`

		// ripgrep can search specific files by passing them as arguments
		const args = ["-l", "-i", "--word-regexp", pattern, ...targetFiles.map((f) => path.join(workspacePath, f))]

		const rgProcess = getSpawnFunction()(rgPath, args)
		const rl = readline.createInterface({ input: rgProcess.stdout })

		const matchedFiles: string[] = []

		rl.on("line", (line) => {
			const relativePath = path.relative(workspacePath, line)
			matchedFiles.push(relativePath)
		})

		rl.on("close", () => {
			resolve(matchedFiles)
		})

		rgProcess.on("error", () => {
			resolve([])
		})
	})
}

export interface FileSnippet {
	path: string
	snippets: string[]
}

export async function searchFilesWithSnippetsBatch(
	keywords: string[],
	workspacePath: string,
	fileLimitPerKeyword = 3,
	snippetLimitPerFile = 2,
	signal?: AbortSignal,
): Promise<Record<string, FileSnippet[]>> {
	if (keywords.length === 0) return {}
	const rgPath = await getBinaryLocation("rg")

	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			return reject(new Error("Ripgrep search aborted"))
		}
		const args = [
			"-i",
			"--column",
			"--line-number",
			"--no-heading",
			"--color",
			"never",
			"-C",
			"2",
			"--follow",
			"--hidden",
			"--max-columns",
			"300",
			"--max-columns-preview",
			"-g",
			"!**/{node_modules,.git,.github,out,dist,__pycache__,.venv,.env,venv,env,.cache,tmp,temp}/**",
		]

		for (const k of keywords) {
			args.push("-e", k)
		}
		args.push(workspacePath)

		const rgProcess = getSpawnFunction()(rgPath, args)

		const onAbort = () => {
			rgProcess.kill()
			reject(new Error("Ripgrep batch search aborted"))
		}
		signal?.addEventListener("abort", onAbort)

		const rl = readline.createInterface({ input: rgProcess.stdout })

		const keywordResults: Record<string, Map<string, string[]>> = {}
		keywords.forEach((k) => {
			keywordResults[k] = new Map()
		})

		const fileCountPerKeyword: Record<string, number> = {}
		keywords.forEach((k) => {
			fileCountPerKeyword[k] = 0
		})

		rl.on("line", (line) => {
			const match = line.match(/^([^:-]+)[:-]/)
			if (!match) return

			const absolutePath = match[1]
			const relativePath = path.relative(workspacePath, absolutePath)

			// Find which keywords matched this line (approximate since rg -e doesn't label lines per pattern)
			for (const k of keywords) {
				if (line.toLowerCase().includes(k.toLowerCase())) {
					const results = keywordResults[k]
					if (!results.has(relativePath)) {
						if (fileCountPerKeyword[k] >= fileLimitPerKeyword) continue
						results.set(relativePath, [])
						fileCountPerKeyword[k]++
					}

					const snippets = results.get(relativePath)
					if (snippets && snippets.length < snippetLimitPerFile * 5) {
						snippets.push(line)
					}
				}
			}
		})

		rgProcess.stderr.on("data", () => {
			/* Capture error output if needed for debugging */
		})

		rl.on("close", () => {
			signal?.removeEventListener("abort", onAbort)
			const finalResults: Record<string, FileSnippet[]> = {}
			for (const k of keywords) {
				finalResults[k] = Array.from(keywordResults[k].entries()).map(([path, snippets]) => ({
					path,
					snippets: snippets.slice(0, snippetLimitPerFile * 5),
				}))
			}
			resolve(finalResults)
		})

		rgProcess.on("error", (error) => {
			signal?.removeEventListener("abort", onAbort)
			reject(new Error(`ripgrep batch process error: ${error.message}`))
		})
	})
}

export async function executeRipgrepForFiles(
	workspacePath: string,
	limit = 5000,
	signal?: AbortSignal,
): Promise<{ path: string; type: "file" | "folder"; label?: string }[]> {
	const rgPath = await getBinaryLocation("rg")

	if (signal?.aborted) {
		throw new Error("Ripgrep file listing aborted")
	}

	return new Promise((resolve, reject) => {
		// Arguments for ripgrep to list files, follow symlinks, include hidden, and exclude common directories
		const args = [
			"--files",
			"--follow",
			"--hidden",
			"-g",
			"!**/{node_modules,.git,.github,out,dist,__pycache__,.venv,.env,venv,env,.cache,tmp,temp}/**",
			workspacePath,
		]

		// Spawn the ripgrep process with the specified arguments
		const rgProcess = getSpawnFunction()(rgPath, args)

		const onAbort = () => {
			rgProcess.kill()
			reject(new Error("Ripgrep file listing aborted"))
		}
		signal?.addEventListener("abort", onAbort)

		const rl = readline.createInterface({ input: rgProcess.stdout })

		// Array to store file results and Set to track unique directories
		const fileResults: { path: string; type: "file" | "folder"; label?: string }[] = []
		const dirSet = new Set<string>()
		let count = 0

		// Handle each line of output from ripgrep (each line is a file path)
		rl.on("line", (line) => {
			if (count >= limit) {
				rl.close()
				rgProcess.kill()
				return
			}

			// Convert absolute path to a relative path from workspace root
			const relativePath = path.relative(workspacePath, line)

			// Add file result to array
			fileResults.push({
				path: relativePath,
				type: "file",
				label: path.basename(relativePath),
			})

			// Extract and add parent directories to the set
			let dirPath = path.dirname(relativePath)
			while (dirPath && dirPath !== "." && dirPath !== "/") {
				dirSet.add(dirPath)
				dirPath = path.dirname(dirPath)
			}

			count++
		})

		// Capture any error output from ripgrep
		let errorOutput = ""
		rgProcess.stderr.on("data", (data) => {
			errorOutput += data.toString()
		})

		// When ripgrep finishes or is closed
		rl.on("close", () => {
			signal?.removeEventListener("abort", onAbort)
			if (errorOutput && fileResults.length === 0) {
				reject(new Error(`ripgrep process error: ${errorOutput.trim()}`))
				return
			}

			// Transform directory paths from Set into structured results
			const dirResults = Array.from(dirSet, (dirPath): { path: string; type: "folder"; label?: string } => ({
				path: dirPath,
				type: "folder",
				label: path.basename(dirPath),
			}))

			// Resolve combined results of files and directories
			resolve([...fileResults, ...dirResults])
		})

		// Handle process-level errors
		rgProcess.on("error", (error) => {
			signal?.removeEventListener("abort", onAbort)
			reject(new Error(`ripgrep process error: ${error.message}`))
		})
	})
}

// Get currently active/open files from VSCode tabs using hostbridge
async function getActiveFiles(): Promise<Set<string>> {
	const request = GetOpenTabsRequest.create({})
	const response = await HostProvider.window.getOpenTabs(request)
	return new Set(response.paths)
}

export async function searchWorkspaceFiles(
	query: string,
	workspacePath: string,
	limit = 20,
	selectedType?: "file" | "folder",
	workspaceName?: string,
): Promise<{ path: string; type: "file" | "folder"; label?: string; workspaceName?: string }[]> {
	try {
		// Get currently active files and convert to search format
		const activeFilePaths = await getActiveFiles()
		const activeFiles: { path: string; type: "file" | "folder"; label?: string }[] = []

		for (const filePath of activeFilePaths) {
			if (filePath.startsWith(workspacePath + path.sep) || filePath.startsWith(`${workspacePath}/`)) {
				const relativePath = path.relative(workspacePath, filePath)
				const normalizedPath = relativePath.replace(/\\/g, "/")
				activeFiles.push({
					path: normalizedPath,
					type: "file",
					label: path.basename(normalizedPath),
				})
			}
		}

		// Get all files and directories
		const allItems = await executeRipgrepForFiles(workspacePath, 5000)

		// Combine active files with all items, removing duplicates (like the old WorkspaceTracker)
		const combinedItems = [...activeFiles]
		for (const item of allItems) {
			if (!activeFiles.some((activeFile) => activeFile.path === item.path)) {
				combinedItems.push(item)
			}
		}

		// If no query, return the combined items
		if (!query.trim()) {
			const addWorkspaceName = (items: typeof combinedItems) =>
				workspaceName ? items.map((item) => ({ ...item, workspaceName })) : items

			if (selectedType === "file") {
				return addWorkspaceName(combinedItems.filter((item) => item.type === "file").slice(0, limit))
			}
			if (selectedType === "folder") {
				return addWorkspaceName(combinedItems.filter((item) => item.type === "folder").slice(0, limit))
			}
			return addWorkspaceName(combinedItems.slice(0, limit))
		}

		// Match Scoring - Prioritize the label (filename) by including it twice in the search string
		// Use multiple tiebreakers in order of importance: Match score, then length of match (shorter=better)
		// Get more (2x) results than needed for filtering, we pick the top half after sorting
		const fzfModule = await import("fzf")
		const fzf = new fzfModule.Fzf(combinedItems, {
			selector: (item: { label?: string; path: string }) => `${item.label || ""} ${item.label || ""} ${item.path}`,
			tiebreakers: [OrderbyMatchScore, fzfModule.byLengthAsc],
			limit: limit * 2,
		})

		const filteredResults = fzf.find(query).slice(0, limit)

		// Verify if the path exists and is actually a directory
		const verifiedResultsPromises = filteredResults.map(
			async ({ item }: { item: { path: string; type: "file" | "folder"; label?: string } }) => {
				const fullPath = path.join(workspacePath, item.path)
				let type = item.type

				try {
					const stats = await fs.promises.lstat(fullPath)
					type = stats.isDirectory() ? "folder" : "file"
				} catch {
					// Keep original type if path doesn't exist
				}

				return workspaceName ? { ...item, type, workspaceName } : { ...item, type }
			},
		)

		return await Promise.all(verifiedResultsPromises)
	} catch (error) {
		Logger.error("Error in searchWorkspaceFiles:", error)
		return []
	}
}

// Custom match scoring for results ordering
// Candidate score tiebreaker - fewer gaps between matched characters scores higher
export const OrderbyMatchScore = (a: FzfResultItem<unknown>, b: FzfResultItem<unknown>) => {
	const countGaps = (positions: Iterable<number>) => {
		let gaps = 0,
			prev = Number.NEGATIVE_INFINITY
		for (const pos of positions) {
			if (prev !== Number.NEGATIVE_INFINITY && pos - prev > 1) {
				gaps++
			}
			prev = pos
		}
		return gaps
	}

	return countGaps(a.positions) - countGaps(b.positions)
}

/**
 * Search for files across multiple workspace roots or a specific workspace
 * Similar to searchWorkspaceFiles but supports multiroot workspaces
 */
export async function searchWorkspaceFilesMultiroot(
	query: string,
	workspaceManager: WorkspaceRootManager,
	limit = 20,
	selectedType?: "file" | "folder",
	workspaceHint?: string,
): Promise<{ path: string; type: "file" | "folder"; label?: string; workspaceName?: string }[]> {
	try {
		const workspaceRoots = workspaceManager?.getRoots?.() || []

		if (workspaceRoots.length === 0) {
			return []
		}

		let workspacesToSearch: WorkspaceRoot[] = []

		// Search only the user-specified workspace (Ex input: @frontend:/query)
		if (workspaceHint) {
			const targetWorkspace = workspaceRoots.find((root: WorkspaceRoot) => root.name === workspaceHint)
			if (targetWorkspace) {
				workspacesToSearch = [targetWorkspace]
			} else {
				return []
			}
		} else {
			// Search all workspaces if no hint provided
			workspacesToSearch = workspaceRoots
		}

		// Execute parallel searches across workspaces
		const searchPromises = workspacesToSearch.map(async (workspace) => {
			try {
				const results = await searchWorkspaceFiles(query, workspace.path, limit, selectedType, workspace.name)
				return results
			} catch (error) {
				Logger.error(`[searchWorkspaceFilesMultiroot] Error searching workspace ${workspace.name}:`, error)
				return []
			}
		})

		// Wait for all searches to finish, fatten, add workspace prefixes if needed
		const allResults = await Promise.all(searchPromises)
		let flatResults = allResults.flat()
		if (workspacesToSearch.length > 1) {
			const pathCounts = new Map<string, number>()
			for (const result of flatResults) {
				pathCounts.set(result.path, (pathCounts.get(result.path) || 0) + 1)
			}

			flatResults = flatResults.map((result) => {
				const count = pathCounts.get(result.path) ?? 0
				if (count > 1 && result.workspaceName) {
					return {
						...result,
						label: `${result.workspaceName}:/${result.path}`,
					}
				}
				return result
			})
		}

		// Apply fuzzy matching across all results if needed
		if (query.trim() && flatResults.length > limit) {
			const fzfModule = await import("fzf")
			const fzf = new fzfModule.Fzf(flatResults, {
				selector: (item: { label?: string; path: string }) => `${item.label || ""} ${item.label || ""} ${item.path}`,
				tiebreakers: [OrderbyMatchScore, fzfModule.byLengthAsc],
			})
			flatResults = fzf
				.find(query)
				.slice(0, limit)
				.map((result) => result.item)
		} else {
			flatResults = flatResults.slice(0, limit)
		}

		return flatResults
	} catch (error) {
		Logger.error("[searchWorkspaceFilesMultiroot] Error in multiroot search:", error)
		return []
	}
}
