/**
 * VSCode namespace shim for CLI mode
 * Provides minimal stubs for VSCode types and enums used by the codebase
 */

import { existsSync, readFileSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import pino, { type Logger } from "pino"
import { URI } from "vscode-uri"
import { CodemarieFileStorage } from "@/shared/storage"
import { printError, printInfo, printWarning } from "./utils/display"
import { CLINE_CLI_DIR } from "./utils/path"

export { URI } from "vscode-uri"
export { CodemarieFileStorage } from "@/shared/storage"

export const CLI_LOG_FILE = path.join(CLINE_CLI_DIR.log, "codemarie-cli.1.log")

/**
 * Safely read and parse a JSON file, returning a default value on failure
 */
export function readJson<T = unknown>(filePath: string, defaultValue: T = {} as T): T {
	try {
		if (existsSync(filePath)) {
			return JSON.parse(readFileSync(filePath, "utf8"))
		}
	} catch {
		// Return default if file doesn't exist or is invalid
	}
	return defaultValue
}

/**
 * Mock environment variable collection for non-VSCode environments
 */
export class EnvironmentVariableCollection {
	private variables = new Map<string, { value: string; type: string }>()
	persistent = true
	description = "CLI Environment Variables"

	entries() {
		return this.variables.entries()
	}

	replace(variable: string, value: string) {
		this.variables.set(variable, { value, type: "replace" })
	}

	append(variable: string, value: string) {
		this.variables.set(variable, { value, type: "append" })
	}

	prepend(variable: string, value: string) {
		this.variables.set(variable, { value, type: "prepend" })
	}

	get(variable: string) {
		return this.variables.get(variable)
	}

	forEach(callback: (variable: string, mutator: { value: string; type: string }, collection: this) => void) {
		this.variables.forEach((mutator, variable) => {
			callback(variable, mutator, this)
		})
	}

	delete(variable: string) {
		return this.variables.delete(variable)
	}

	clear() {
		this.variables.clear()
	}

	getScoped(_scope: unknown) {
		return this
	}
}

// ============================================================================
// VSCode enums
// ============================================================================

export enum ExtensionMode {
	Production = 1,
	Development = 2,
	Test = 3,
}

export enum ExtensionKind {
	UI = 1,
	Workspace = 2,
}

export enum FileType {
	Unknown = 0,
	File = 1,
	Directory = 2,
	SymbolicLink = 64,
}

export enum DiagnosticSeverity {
	Error = 0,
	Warning = 1,
	Information = 2,
	Hint = 3,
}

export enum EndOfLine {
	LF = 1,
	CRLF = 2,
}

export enum UIKind {
	Desktop = 1,
	Web = 2,
}

export enum ViewColumn {
	Active = -1,
	Beside = -2,
	One = 1,
	Two = 2,
	Three = 3,
	Four = 4,
	Five = 5,
	Six = 6,
	Seven = 7,
	Eight = 8,
	Nine = 9,
}

export enum ColorThemeKind {
	Light = 1,
	Dark = 2,
	HighContrast = 3,
	HighContrastLight = 4,
}

const outputChannelLoggers = new Map<string, Logger>()

function getOutputChannelLogger(channelName: string): Logger {
	let logger = outputChannelLoggers.get(channelName)
	if (!logger) {
		const transport = pino.transport({
			target: "pino-roll",
			options: {
				name: channelName,
				file: CLI_LOG_FILE.replace(".1", ""),
				mkdir: true,
				frequency: "daily",
				limit: { count: 5 },
			},
		})
		logger = pino({ timestamp: pino.stdTimeFunctions.isoTime }, transport)
		outputChannelLoggers.set(channelName, logger)
	}
	return logger
}

export class Position {
	constructor(
		public readonly line: number,
		public readonly character: number,
	) {}

	compareTo(other: Position): number {
		return this.line - other.line || this.character - other.character
	}

	isAfter(other: Position): boolean {
		return this.compareTo(other) > 0
	}

	isAfterOrEqual(other: Position): boolean {
		return this.compareTo(other) >= 0
	}

	isBefore(other: Position): boolean {
		return this.compareTo(other) < 0
	}

	isBeforeOrEqual(other: Position): boolean {
		return this.compareTo(other) <= 0
	}

	isEqual(other: Position): boolean {
		return this.compareTo(other) === 0
	}

	translate(lineDelta = 0, characterDelta = 0): Position {
		return new Position(this.line + lineDelta, this.character + characterDelta)
	}

	with(line?: number, character?: number): Position {
		return new Position(line ?? this.line, character ?? this.character)
	}
}

export class Range {
	public readonly start: Position
	public readonly end: Position

	constructor(start: Position, end: Position)
	constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number)
	constructor(
		startOrStartLine: Position | number,
		endOrStartCharacter: Position | number,
		endLine?: number,
		endCharacter?: number,
	) {
		if (typeof startOrStartLine === "number") {
			this.start = new Position(startOrStartLine, endOrStartCharacter as number)
			this.end = new Position(endLine ?? 0, endCharacter ?? 0)
		} else {
			this.start = startOrStartLine
			this.end = endOrStartCharacter as Position
		}
	}

	get isEmpty(): boolean {
		return this.start.isEqual(this.end)
	}

	get isSingleLine(): boolean {
		return this.start.line === this.end.line
	}

	contains(positionOrRange: Position | Range): boolean {
		if (positionOrRange instanceof Range) {
			return this.contains(positionOrRange.start) && this.contains(positionOrRange.end)
		}
		return positionOrRange.isAfterOrEqual(this.start) && positionOrRange.isBeforeOrEqual(this.end)
	}

	isEqual(other: Range): boolean {
		return this.start.isEqual(other.start) && this.end.isEqual(other.end)
	}

	intersection(range: Range): Range | undefined {
		const start = this.start.isAfter(range.start) ? this.start : range.start
		const end = this.end.isBefore(range.end) ? this.end : range.end
		return start.isAfter(end) ? undefined : new Range(start, end)
	}

	union(other: Range): Range {
		const start = this.start.isBefore(other.start) ? this.start : other.start
		const end = this.end.isAfter(other.end) ? this.end : other.end
		return new Range(start, end)
	}

	with(start?: Position, end?: Position): Range {
		return new Range(start ?? this.start, end ?? this.end)
	}
}

export class Selection extends Range {
	public readonly anchor: Position
	public readonly active: Position

	constructor(anchor: Position, active: Position)
	constructor(anchorLine: number, anchorCharacter: number, activeLine: number, activeCharacter: number)
	constructor(
		anchorOrAnchorLine: Position | number,
		activeOrAnchorCharacter: Position | number,
		activeLine?: number,
		activeCharacter?: number,
	) {
		const anchor =
			typeof anchorOrAnchorLine === "number"
				? new Position(anchorOrAnchorLine, activeOrAnchorCharacter as number)
				: anchorOrAnchorLine
		const active =
			typeof anchorOrAnchorLine === "number"
				? new Position(activeLine ?? 0, activeCharacter ?? 0)
				: (activeOrAnchorCharacter as Position)
		const isForward = anchor.isBefore(active)
		super(isForward ? anchor : active, isForward ? active : anchor)
		this.anchor = anchor
		this.active = active
	}

	get isReversed(): boolean {
		return this.anchor.isAfter(this.active)
	}
}

export interface CancellationToken {
	readonly isCancellationRequested: boolean
	readonly onCancellationRequested: (listener: (e: unknown) => unknown) => { dispose(): void }
}

export class CancellationTokenSource {
	private _token = new (class implements CancellationToken {
		private _isCancelled = false
		private _emitter = new EventEmitter<void>()

		get isCancellationRequested() {
			return this._isCancelled
		}
		get onCancellationRequested() {
			return this._emitter.event
		}

		cancel() {
			if (!this._isCancelled) {
				this._isCancelled = true
				this._emitter.fire(undefined)
			}
		}

		dispose() {
			this._emitter.dispose()
		}
	})()

	get token(): CancellationToken {
		return this._token
	}

	cancel(): void {
		this._token.cancel()
	}

	dispose(): void {
		this._token.dispose()
	}
}

export class EventEmitter<T> {
	private listeners: Array<(e: T) => void> = []

	event = (listener: (e: T) => void) => {
		this.listeners.push(listener)
		return {
			dispose: () => {
				const idx = this.listeners.indexOf(listener)
				if (idx >= 0) this.listeners.splice(idx, 1)
			},
		}
	}

	fire(data: T): void {
		this.listeners.forEach((listener) => {
			listener(data)
		})
	}

	dispose(): void {
		this.listeners.length = 0
	}
}

export class Disposable {
	constructor(private callOnDispose: () => void) {}

	static from(...disposables: { dispose(): unknown }[]): Disposable {
		return new Disposable(() => {
			disposables.forEach((d) => {
				d.dispose()
			})
		})
	}

	dispose(): void {
		this.callOnDispose()
	}
}

const noop = () => {}
const noopDisposable = { dispose: noop }

export const workspace = {
	get workspaceFolders() {
		const workspacePath = process.env.CLINE_WORKSPACE_DIR || process.cwd()
		return [
			{
				uri: URI.file(workspacePath),
				name: path.basename(workspacePath),
				index: 0,
			},
		]
	},
	getWorkspaceFolder: (uri: URI) => {
		const folders = workspace.workspaceFolders
		return folders.find((f) => uri.fsPath.startsWith(f.uri.fsPath))
	},
	onDidChangeWorkspaceFolders: () => noopDisposable,
	fs: {
		readFile: async (uri: URI): Promise<Uint8Array> => {
			return new Uint8Array(await fs.readFile(uri.fsPath))
		},
		writeFile: async (uri: URI, content: Uint8Array): Promise<void> => {
			await fs.writeFile(uri.fsPath, Buffer.from(content))
		},
		delete: async (uri: URI, options?: { recursive?: boolean; useTrash?: boolean }): Promise<void> => {
			await fs.rm(uri.fsPath, { recursive: options?.recursive, force: true })
		},
		stat: async (uri: URI) => {
			const stats = await fs.stat(uri.fsPath)
			return {
				type: stats.isDirectory()
					? FileType.Directory
					: stats.isFile()
						? FileType.File
						: stats.isSymbolicLink()
							? FileType.SymbolicLink
							: FileType.Unknown,
				size: stats.size,
				ctime: stats.ctimeMs,
				mtime: stats.mtimeMs,
			}
		},
		readDirectory: async (uri: URI): Promise<[string, FileType][]> => {
			const entries = await fs.readdir(uri.fsPath, { withFileTypes: true })
			return entries.map((e) => [
				e.name,
				e.isDirectory()
					? FileType.Directory
					: e.isFile()
						? FileType.File
						: e.isSymbolicLink()
							? FileType.SymbolicLink
							: FileType.Unknown,
			]) as [string, FileType][]
		},
		createDirectory: async (uri: URI): Promise<void> => {
			await fs.mkdir(uri.fsPath, { recursive: true })
		},
		rename: async (source: URI, target: URI): Promise<void> => {
			await fs.rename(source.fsPath, target.fsPath)
		},
		copy: async (source: URI, target: URI, options?: { overwrite: boolean }): Promise<void> => {
			await fs.cp(source.fsPath, target.fsPath, { recursive: true, force: options?.overwrite })
		},
	},
}

export const window = {
	showInformationMessage: async <T extends string>(message: string, ...items: T[]): Promise<T | undefined> => {
		printInfo(message)
		if (items.length === 0) {
			return undefined
		}

		try {
			const prompts = (await import("prompts")).default
			const { value } = await prompts({
				type: "select",
				name: "value",
				message: "Select an option:",
				choices: items.map((item) => ({ title: item, value: item })),
				initial: 0,
			})
			return value
		} catch {
			return undefined
		}
	},
	showWarningMessage: async <T extends string>(message: string, ...items: T[]): Promise<T | undefined> => {
		printWarning(message)
		if (items.length === 0) {
			return undefined
		}

		try {
			const prompts = (await import("prompts")).default
			const { value } = await prompts({
				type: "select",
				name: "value",
				message: "Select an option:",
				choices: items.map((item) => ({ title: item, value: item })),
				initial: 0,
			})
			return value
		} catch {
			return undefined
		}
	},
	showErrorMessage: async <T extends string>(message: string, ...items: T[]): Promise<T | undefined> => {
		printError(message)
		if (items.length === 0) {
			return undefined
		}

		try {
			const prompts = (await import("prompts")).default
			const { value } = await prompts({
				type: "select",
				name: "value",
				message: "Select an option:",
				choices: items.map((item) => ({ title: item, value: item })),
				initial: 0,
			})
			return value
		} catch {
			return undefined
		}
	},
	createOutputChannel: (name: string) => {
		const logger = getOutputChannelLogger(name)
		const { SensitiveDataMasker } = require("@shared/utils/SensitiveDataMasker")
		const log = (text: string) => logger.info({ channel: name }, SensitiveDataMasker.mask(text))
		return { appendLine: log, append: log, clear: noop, show: noop, hide: noop, dispose: noop }
	},
	terminals: [] as unknown[],
	activeTerminal: undefined as unknown,
	createTerminal: (_options?: unknown) => ({
		name: "CLI Terminal",
		processId: Promise.resolve(process.pid),
		sendText: (text: string) => printInfo(`[${new Date().toISOString()}] [Terminal] ${text}`),
		show: noop,
		hide: noop,
		dispose: noop,
	}),
	activeTextEditor: undefined,
	visibleTextEditors: [],
	onDidChangeActiveTextEditor: () => noopDisposable,
	onDidChangeVisibleTextEditors: () => noopDisposable,
	onDidChangeTextEditorSelection: () => noopDisposable,
	onDidChangeTextEditorVisibleRanges: () => noopDisposable,
	onDidChangeTextEditorOptions: () => noopDisposable,
	onDidChangeTextEditorViewColumn: () => noopDisposable,
	tabGroups: {
		all: [],
		activeTabGroup: { tabs: [], activeTab: undefined, isActive: true, viewColumn: ViewColumn.One },
		onDidChangeTabs: () => noopDisposable,
		onDidChangeTabGroups: () => noopDisposable,
	},
}

const commandHandlers = new Map<string, (...args: unknown[]) => unknown>()

export const commands = {
	registerCommand: (command: string, callback: (...args: unknown[]) => unknown, thisArg?: unknown) => {
		commandHandlers.set(command, callback.bind(thisArg))
		return {
			dispose: () => {
				commandHandlers.delete(command)
			},
		}
	},
	executeCommand: async <T = unknown>(command: string, ...rest: unknown[]): Promise<T | undefined> => {
		const handler = commandHandlers.get(command)
		if (handler) {
			return handler(...rest) as T
		}
		return undefined
	},
}

export const env = {
	appName: "Codemarie CLI",
	appRoot: path.resolve(__dirname, ".."),
	language: "en",
	shell: process.env.SHELL || "/bin/sh",
	uiKind: UIKind.Desktop,
	uriScheme: "codemarie",
	clipboard: {
		readText: async () => {
			try {
				const { execSync } = await import("node:child_process")
				if (process.platform === "darwin") {
					return execSync("pbpaste").toString()
				}
				if (process.platform === "win32") {
					return execSync("powershell.exe -command Get-Clipboard").toString()
				}
				if (process.platform === "linux") {
					return execSync("xclip -selection clipboard -o || xsel --clipboard --output").toString()
				}
			} catch (error) {
				printWarning(`Failed to read from clipboard: ${error instanceof Error ? error.message : String(error)}`)
			}
			return ""
		},
		writeText: async (value: string) => {
			try {
				const { spawn } = await import("node:child_process")
				if (process.platform === "darwin") {
					const child = spawn("pbcopy")
					child.stdin.write(value)
					child.stdin.end()
				} else if (process.platform === "win32") {
					const child = spawn("powershell.exe", ["-command", "Set-Clipboard"])
					child.stdin.write(value)
					child.stdin.end()
				} else if (process.platform === "linux") {
					try {
						const child = spawn("xclip", ["-selection", "clipboard"])
						child.stdin.write(value)
						child.stdin.end()
					} catch {
						const child = spawn("xsel", ["--clipboard", "--input"])
						child.stdin.write(value)
						child.stdin.end()
					}
				}
			} catch (error) {
				printWarning(`Failed to write to clipboard: ${error instanceof Error ? error.message : String(error)}`)
			}
		},
	},
	openExternal: async (uri: URI) => {
		const { openExternal } = await import("@/utils/env")
		return openExternal(uri.toString())
	},
	isTelemetryEnabled: true,
	onDidChangeTelemetryEnabled: () => noopDisposable,
}

export interface Memento {
	get<T>(key: string): T | undefined
	get<T>(key: string, defaultValue: T): T
	update(key: string, value: unknown): Thenable<void>
	keys(): readonly string[]
	setKeysForSync(keys: string[]): void
}

export interface SecretStorageChangeEvent {
	readonly key: string
}

export interface SecretStorage {
	get(key: string): Thenable<string | undefined>
	store(key: string, value: string): Thenable<void>
	delete(key: string): Thenable<void>
	readonly onDidChange: (listener: (e: SecretStorageChangeEvent) => void) => { dispose(): void }
}

export class MementoShim implements Memento {
	constructor(private storage: CodemarieFileStorage) {}
	get<T>(key: string): T | undefined
	get<T>(key: string, defaultValue: T): T
	get<T>(key: string, defaultValue?: T): T | undefined {
		return this.storage.get(key, defaultValue)
	}
	update(key: string, value: unknown): Thenable<void> {
		return this.storage.update(key, value)
	}
	keys(): readonly string[] {
		return this.storage.keys()
	}
	setKeysForSync(_keys: string[]): void {
		// No-op for CLI
	}
}

export class SecretStorageShim implements SecretStorage {
	private storage: CodemarieFileStorage
	private _onDidChange = new EventEmitter<SecretStorageChangeEvent>()
	readonly onDidChange = this._onDidChange.event

	constructor(filePath: string) {
		this.storage = new CodemarieFileStorage(filePath, "SecretStorage", { fileMode: 0o600 })
	}

	get(key: string): Thenable<string | undefined> {
		return Promise.resolve(this.storage.get(key))
	}

	store(key: string, value: string): Thenable<void> {
		this.storage.set(key, value)
		this._onDidChange.fire({ key })
		return Promise.resolve()
	}

	delete(key: string): Thenable<void> {
		this.storage.delete(key)
		this._onDidChange.fire({ key })
		return Promise.resolve()
	}
}

export interface ExtensionContext {
	readonly subscriptions: { dispose(): void }[]
	readonly workspaceState: Memento
	readonly globalState: Memento & { setKeysForSync(keys: string[]): void }
	readonly secrets: SecretStorage
	readonly extensionUri: URI
	readonly extensionPath: string
	readonly environmentVariableCollection: EnvironmentVariableCollection
	readonly extensionMode: ExtensionMode
	readonly logUri: URI
	readonly storageUri: URI
	readonly globalStorageUri: URI
	readonly storagePath: string
	readonly globalStoragePath: string
	readonly logPath: string
	readonly extension: Extension<unknown>
	asAbsolutePath(relativePath: string): string
}

export class ExtensionContextShim implements ExtensionContext {
	readonly subscriptions: { dispose(): void }[] = []
	readonly workspaceState: Memento
	readonly globalState: Memento & { setKeysForSync(keys: string[]): void }
	readonly secrets: SecretStorage
	readonly extensionUri: URI
	readonly extensionPath: string
	readonly environmentVariableCollection: EnvironmentVariableCollection
	readonly extensionMode: ExtensionMode = ExtensionMode.Production
	readonly logUri: URI
	readonly storageUri: URI
	readonly globalStorageUri: URI
	readonly storagePath: string
	readonly globalStoragePath: string
	readonly logPath: string
	readonly extension: Extension<unknown>

	constructor() {
		const storageDir = CLINE_CLI_DIR.storage
		const globalStatePath = path.join(storageDir, "globalState.json")
		const workspaceStatePath = path.join(storageDir, "workspaceState.json")
		const secretsPath = path.join(storageDir, "secrets.json")

		this.globalState = new MementoShim(new CodemarieFileStorage(globalStatePath, "GlobalState"))
		this.workspaceState = new MementoShim(new CodemarieFileStorage(workspaceStatePath, "WorkspaceState"))
		this.secrets = new SecretStorageShim(secretsPath)

		// extensionPath should point to the root of the project/package
		this.extensionPath = path.resolve(__dirname, "..")
		this.extensionUri = URI.file(this.extensionPath)
		this.environmentVariableCollection = new EnvironmentVariableCollection()
		this.logUri = URI.file(CLINE_CLI_DIR.log)
		this.globalStorageUri = URI.file(storageDir)
		this.storageUri = URI.file(path.join(storageDir, "workspace"))
		this.storagePath = this.storageUri.fsPath
		this.globalStoragePath = this.globalStorageUri.fsPath
		this.logPath = this.logUri.fsPath
		this.extension = {
			id: "saoudrizwan.claude-dev",
			extensionUri: this.extensionUri,
			extensionPath: this.extensionPath,
			isActive: true,
			packageJSON: require("../package.json"),
			extensionKind: ExtensionKind.UI,
			exports: undefined,
			activate: async () => undefined,
		}
	}

	asAbsolutePath(relativePath: string): string {
		return path.resolve(this.extensionPath, relativePath)
	}

	dispose() {
		this.subscriptions.forEach((s) => {
			s.dispose()
		})
	}
}

export interface Extension<T> {
	readonly id: string
	readonly extensionUri: URI
	readonly extensionPath: string
	readonly isActive: boolean
	readonly packageJSON: unknown
	readonly extensionKind: ExtensionKind
	readonly exports: T
	activate(): Promise<T>
}

// ============================================================================
// Shutdown event for graceful cleanup
// ============================================================================

/**
 * Event emitter for app shutdown notification.
 * Components can listen to this to clean up UI before process exit.
 */
export const shutdownEvent = new EventEmitter<void>()
