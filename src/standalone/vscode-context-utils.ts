import * as fs from "fs"
import type {
	EnvironmentVariableMutator,
	EnvironmentVariableMutatorOptions,
	EnvironmentVariableScope,
	EnvironmentVariableCollection as VSCodeEnvironmentVariableCollection,
} from "vscode"
import * as vscode from "vscode"
export class SecretStore implements vscode.SecretStorage {
	private data: JsonKeyValueStore<string>
	private readonly _onDidChange = new EventEmitter<vscode.SecretStorageChangeEvent>()

	constructor(filepath: string) {
		this.data = new JsonKeyValueStore(filepath)
	}

	readonly onDidChange: vscode.Event<vscode.SecretStorageChangeEvent> = this._onDidChange.event

	get(key: string): Thenable<string | undefined> {
		return Promise.resolve(this.data.get(key))
	}

	store(key: string, value: string): Thenable<void> {
		this.data.put(key, value)
		this._onDidChange.fire({ key })
		return Promise.resolve()
	}

	delete(key: string): Thenable<void> {
		this.data.delete(key)
		this._onDidChange.fire({ key })
		return Promise.resolve()
	}
}

// Create a class that implements Memento interface with the required setKeysForSync method
export class MementoStore implements vscode.Memento {
	private data: JsonKeyValueStore<unknown>
	private syncKeys = new Set<string>()

	constructor(filepath: string) {
		this.data = new JsonKeyValueStore(filepath)
	}
	keys(): readonly string[] {
		return Array.from(this.data.keys())
	}
	get<T>(key: string): T | undefined {
		return this.data.get(key) as T
	}
	update(key: string, value: unknown): Thenable<void> {
		if (value === undefined) {
			this.data.delete(key)
		} else {
			this.data.put(key, value)
		}
		return Promise.resolve()
	}
	setKeysForSync(keys: readonly string[]): void {
		this.syncKeys = new Set(keys)
	}
	getSyncedKeys(): readonly string[] {
		return Array.from(this.syncKeys)
	}
}

// Simple implementation of VSCode's EventEmitter
type EventCallback<T> = (e: T) => unknown
export class EventEmitter<T> {
	private listeners: EventCallback<T>[] = []

	event: vscode.Event<T> = (listener: EventCallback<T>) => {
		this.listeners.push(listener)
		return {
			dispose: () => {
				const index = this.listeners.indexOf(listener)
				if (index !== -1) {
					this.listeners.splice(index, 1)
				}
			},
		}
	}

	fire(data: T): void {
		for (const listener of this.listeners) {
			listener(data)
		}
	}
}

/** A simple key-value store for secrets backed by a JSON file. This is not secure, and it is not thread-safe. */
export class JsonKeyValueStore<T> {
	private data = new Map<string, T>()
	private filePath: string

	constructor(filePath: string) {
		this.filePath = filePath
		this.load()
	}

	get(key: string): T | undefined {
		return this.data.get(key)
	}

	put(key: string, value: T): void {
		this.data.set(key, value)
		this.save()
	}

	delete(key: string): void {
		this.data.delete(key)
		this.save()
	}
	keys(): Iterable<string> | ArrayLike<string> {
		return this.data.keys()
	}
	private load(): void {
		if (fs.existsSync(this.filePath)) {
			try {
				const data = JSON.parse(fs.readFileSync(this.filePath, "utf-8"))
				Object.entries(data).forEach(([k, v]) => {
					this.data.set(k, v as T)
				})
			} catch {
				this.data.clear()
			}
		}
	}
	private save(): void {
		// Use mode 0o600 to restrict file permissions to owner read/write only (fixes #7778)
		fs.writeFileSync(this.filePath, JSON.stringify(Object.fromEntries(this.data), null, 2), { mode: 0o600 })
	}
}

export class EnvironmentVariableCollection implements VSCodeEnvironmentVariableCollection {
	persistent = false
	description: string | undefined = undefined
	private readonly mutators = new Map<string, EnvironmentVariableMutator>()
	private readonly scopedCollections = new Map<EnvironmentVariableScope, EnvironmentVariableCollection>()

	replace(variable: string, value: string, options?: EnvironmentVariableMutatorOptions): void {
		this.setMutator(variable, value, vscode.EnvironmentVariableMutatorType.Replace, options)
	}
	append(variable: string, value: string, options?: EnvironmentVariableMutatorOptions): void {
		this.setMutator(variable, value, vscode.EnvironmentVariableMutatorType.Append, options)
	}
	prepend(variable: string, value: string, options?: EnvironmentVariableMutatorOptions): void {
		this.setMutator(variable, value, vscode.EnvironmentVariableMutatorType.Prepend, options)
	}
	get(variable: string): EnvironmentVariableMutator | undefined {
		return this.mutators.get(variable)
	}
	forEach(
		_callback: (variable: string, mutator: EnvironmentVariableMutator, collection: EnvironmentVariableCollection) => unknown,
		thisArg?: unknown,
	): void {
		for (const [variable, mutator] of this.mutators.entries()) {
			_callback.call(thisArg, variable, mutator, this)
		}
	}
	delete(variable: string): void {
		this.mutators.delete(variable)
	}
	clear(): void {
		this.mutators.clear()
	}
	[Symbol.iterator](): IterableIterator<[variable: string, mutator: EnvironmentVariableMutator]> {
		return this.mutators[Symbol.iterator]()
	}
	getScoped(scope: EnvironmentVariableScope): EnvironmentVariableCollection {
		let scoped = this.scopedCollections.get(scope)
		if (!scoped) {
			scoped = new EnvironmentVariableCollection()
			scoped.persistent = this.persistent
			scoped.description = this.description
			this.scopedCollections.set(scope, scoped)
		}
		return scoped
	}

	private setMutator(
		variable: string,
		value: string,
		type: vscode.EnvironmentVariableMutatorType,
		options?: EnvironmentVariableMutatorOptions,
	): void {
		this.mutators.set(variable, {
			type,
			value,
			options: options ?? {},
		})
	}
}

export function readJson(filePath: string): unknown {
	return JSON.parse(fs.readFileSync(filePath, "utf8"))
}
