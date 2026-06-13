import { Logger } from "../services/Logger"
import { getStorageAdapter, StorageAdapter } from "./adapters"
import type { BlobStoreSettings } from "./blob-store-settings"
import { DietCodeStorage } from "./DietCodeStorage"

// Re-export for backward compatibility; canonical home is ./blob-store-settings.
export type { BlobStoreSettings }

/**
 * S3/R2 blob storage implementation of DietCodeStorage.
 * Uses AWS S3 or Cloudflare R2 as the backend storage.
 */
export class DietCodeBlobStorage extends DietCodeStorage {
	override name = "DietCodeBlobStorage"

	private static store: DietCodeBlobStorage | null = null
	static get instance(): DietCodeBlobStorage {
		if (!DietCodeBlobStorage.store) {
			DietCodeBlobStorage.store = new DietCodeBlobStorage()
		}
		return DietCodeBlobStorage.store
	}

	private adapter: StorageAdapter | undefined
	private settings: BlobStoreSettings | undefined
	private initialized = false
	private _initializing = false

	/**
	 * Initialize the storage adapter with the given settings.
	 * Can be called multiple times - will reinitialize if settings change.
	 */
	public init(settings?: BlobStoreSettings) {
		if (!settings) {
			return
		}

		// Guard against concurrent initialization races — two callers passing
		// the settingsChanged check simultaneously would create two adapters,
		// with the second silently overwriting the first.
		if (this._initializing) {
			return
		}

		// Check if settings have changed (compare key fields)
		const settingsChanged =
			!this.settings ||
			this.settings.adapterType !== settings.adapterType ||
			this.settings.bucket !== settings.bucket ||
			this.settings.accessKeyId !== settings.accessKeyId ||
			this.settings.endpoint !== settings.endpoint ||
			this.settings.accountId !== settings.accountId

		// Skip if already initialized with same settings
		if (this.initialized && !settingsChanged) {
			return
		}

		this._initializing = true
		try {
			if (!DietCodeBlobStorage.isConfigured(settings)) {
				// Not configured - this is expected and not an error
				return
			}

			const adapter = getStorageAdapter(settings)
			if (adapter) {
				this.adapter = adapter
				this.settings = settings
				this.initialized = true
				Logger.log(`[DietCodeBlobStorage] Adapter created for ${settings.adapterType}`)
			}
		} catch (error) {
			// Log but don't throw - allow startup to continue
			Logger.error("[DietCodeBlobStorage] initialization failed:", error)
		} finally {
			this._initializing = false
		}
	}

	/**
	 * Check if the storage is properly initialized and ready to use.
	 */
	public isReady(): boolean {
		return this.initialized && this.adapter !== undefined
	}

	public static isConfigured(settings: BlobStoreSettings): boolean {
		const adapter = settings.adapterType
		if (adapter !== "s3" && adapter !== "r2") {
			return false
		}

		const hasRequiredVars = !!settings.bucket && !!settings.accessKeyId && !!settings.secretAccessKey

		if (adapter === "r2") {
			return hasRequiredVars && !!(settings.accountId || settings.endpoint)
		}

		return hasRequiredVars
	}

	protected async _get(key: string): Promise<string | undefined> {
		if (!this.isReady()) {
			return undefined
		}
		try {
			return await this.adapter?.read(key)
		} catch {
			// Silently return undefined on read errors
			return undefined
		}
	}

	protected async _store(key: string, value: string): Promise<void> {
		if (!this.isReady()) {
			// Silently fail if not configured - this is expected behavior
			return
		}
		await this.adapter?.write(key, value)
	}

	protected async _delete(key: string): Promise<void> {
		if (!this.isReady()) {
			// Silently fail if not configured - this is expected behavior
			return
		}
		await this.adapter?.remove(key)
	}
}

/**
 * Get the blob storage instance if S3/R2 storage is configured.
 * Returns null if not configured.
 */
export const blobStorage = DietCodeBlobStorage.instance
