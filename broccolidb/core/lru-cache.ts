export class LRUCache<K, V> {
  private capacity: number;
  private cache: Map<K, V>;
  private _hits = 0;
  private _misses = 0;

  constructor(capacity: number) {
    if (capacity <= 0) throw new Error('Capacity must be greater than 0');
    this.capacity = capacity;
    this.cache = new Map<K, V>();
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) {
      this._misses++;
      return undefined;
    }
    this._hits++;
    // Refresh the key by removing and re-adding it
    const val = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, val);
    return val;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      // Refresh existing key
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // Evict least recently used (first item in insertion order)
      const lruKey = this.cache.keys().next().value;
      if (lruKey !== undefined) {
        this.cache.delete(lruKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this._hits = 0;
    this._misses = 0;
  }

  get size(): number {
    return this.cache.size;
  }

  get hits(): number {
    return this._hits;
  }

  get misses(): number {
    return this._misses;
  }
}
