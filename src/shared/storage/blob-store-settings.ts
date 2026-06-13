/**
 * Blob store settings contract.
 *
 * NOTE: This pure-data interface lives in a leaf module (zero imports) so that
 * `adapters.ts` can consume it without importing `DietCodeBlobStorage.ts` —
 * which imports `adapters.ts` for `getStorageAdapter`. That mutual reference
 * formed the DietCodeBlobStorage ↔ adapters cycle. DietCodeBlobStorage
 * re-exports this type for backward compatibility.
 */
export interface BlobStoreSettings {
	bucket: string
	adapterType: "s3" | "r2" | string
	accessKeyId: string
	secretAccessKey: string
	region?: string
	endpoint?: string
	accountId?: string

	/** Interval between sync attempts in milliseconds (default: 30000 = 30s) */
	intervalMs?: number
	/** Maximum number of retries before giving up on an item (default: 5) */
	maxRetries?: number
	/** Batch size - how many items to process per interval (default: 10) */
	batchSize?: number
	/** Maximum queue size before eviction (default: 1000) */
	maxQueueSize?: number
	/** Maximum age for failed items in milliseconds (default: 7 days) */
	maxFailedAgeMs?: number
	/** Whether to backfill existing unsynced items on startup (default: false) */
	backfillEnabled?: boolean
}
