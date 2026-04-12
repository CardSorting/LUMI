import fsSync from "node:fs"
import os from "node:os"
import path from "node:path"
import { CodemarieFileStorage } from "./CodemarieFileStorage"
import { CodemarieMemento } from "./CodemarieStorage"

/**
 * The storage backend context object used by StateManager and other components.
 * Global, workspace and secret key-value storage goes through this component.
 *
 * This replaces the previous pattern of passing VSCode's ExtensionContext around
 * for storage access. All platforms (VSCode, CLI, JetBrains) use the same
 * file-backed implementation.
 */
export interface StorageContext {
	/** Global state — settings, task history references, UI state, etc. */
	readonly globalState: CodemarieMemento

	// TODO: Privatize this field after StorageContext becomes class with a reset method.
	/**
	 * The backing store for global state. Prefer `globalState` when possible.
	 *
	 * This split exists because CLI needs to intercept the CodemarieMemento interface to global state,
	 * but state resets need to write through to the backing store.
	 */
	readonly globalStateBackingStore: CodemarieFileStorage

	/** Secrets — API keys and other sensitive values. File uses restricted permissions (0o600). */
	readonly secrets: CodemarieFileStorage<string>

	/** Workspace-scoped state — per-project toggles, rules, etc. */
	readonly workspaceState: CodemarieFileStorage

	/** The resolved path to the data directory (~/.codemarie/data) */
	readonly dataDir: string

	/** The resolved path to the workspace storage directory (contains workspaceState.json) */
	readonly workspaceStoragePath: string
}

export interface StorageContextOptions {
	/**
	 * Override the Codemarie home directory. Defaults to CODEMARIE_DIR env var or ~/.codemarie.
	 */
	codemarieDir?: string

	/**
	 * The workspace/project directory path. Used to compute a hash-based
	 * workspace storage subdirectory. Defaults to process.cwd().
	 */
	workspacePath?: string

	/**
	 * Explicit workspace storage directory override.
	 * When set, this path is used directly instead of computing a hash.
	 * Used by JetBrains (via WORKSPACE_STORAGE_DIR env var).
	 *
	 * TODO: Unify JetBrains workspace path scheme with the hash-based approach
	 * once the JetBrains client side is cleaned up.
	 */
	workspaceStorageDir?: string
}

const SETTINGS_SUBFOLDER = "data"

/**
 * Create a short deterministic hash of a string for use in directory names.
 * Produces an up-to-8-character hex string.
 */
function hashString(str: string): string {
	let hash = 0
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i)
		hash = (hash << 5) - hash + char
		hash = hash & hash // Convert to 32-bit integer
	}
	return Math.abs(hash).toString(16).substring(0, 8)
}

/**
 * Creates a StorageContext backed by JSON files on disk.
 *
 * All path computation is contained here — callers should not
 * construct paths to these storage files themselves.
 *
 * File layout:
 *   ~/.codemarie/data/globalState.json    — global state
 *   ~/.codemarie/data/secrets.json        — secrets (mode 0o600)
 *   ~/.codemarie/data/workspaces/<hash>/workspaceState.json — per-workspace state
 *
 * @param opts Configuration options for path resolution
 * @returns A StorageContext ready for use by StateManager
 */
export function createStorageContext(opts: StorageContextOptions = {}): StorageContext {
	const codemarieDir =
		opts.codemarieDir || process.env.CODEMARIE_DIR || process.env.CLINE_DIR || path.join(os.homedir(), ".codemarie")
	const dataDir = path.join(codemarieDir, SETTINGS_SUBFOLDER)

	// Resolve workspace storage directory
	let workspaceDir: string
	if (opts.workspaceStorageDir) {
		// Explicit override (JetBrains via env var, or test overrides)
		workspaceDir = opts.workspaceStorageDir
	} else {
		// Hash-based workspace isolation (CLI, VSCode)
		const workspacePath = opts.workspacePath || process.cwd()
		const workspaceHash = hashString(workspacePath)
		workspaceDir = path.join(dataDir, "workspaces", workspaceHash)
	}

	// Ensure directories exist
	fsSync.mkdirSync(dataDir, { recursive: true })
	fsSync.mkdirSync(workspaceDir, { recursive: true })

	const globalState = new CodemarieFileStorage(path.join(dataDir, "globalState.json"), "GlobalState")

	return {
		globalState,
		globalStateBackingStore: globalState,
		secrets: new CodemarieFileStorage<string>(path.join(dataDir, "secrets.json"), "Secrets", {
			fileMode: 0o600, // Owner read/write only — protects API keys
		}),
		workspaceState: new CodemarieFileStorage(path.join(workspaceDir, "workspaceState.json"), "WorkspaceState"),
		dataDir,
		workspaceStoragePath: workspaceDir,
	}
}
