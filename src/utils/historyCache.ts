import type { Adjustments } from './adjustments';

export interface HistoryCacheEntry {
  history: Adjustments[];
  historyIndex: number;
}

const MAX_ENTRIES = 20;

// Per-image undo history, keyed by image path (virtual copies use the
// same `?vc=` path suffix convention as globalImageCache). In-memory only
// (Phase 1); Phase 2 persists to the SQLite catalog and demotes this to L1.
class HistoryCache {
  private cache = new Map<string, HistoryCacheEntry>();

  get(key: string): HistoryCacheEntry | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  set(key: string, entry: HistoryCacheEntry): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= MAX_ENTRIES) {
      const lruKey = this.cache.keys().next().value;
      if (lruKey !== undefined) this.cache.delete(lruKey);
    }
    this.cache.set(key, entry);
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  deleteByPrefix(prefix: string): void {
    for (const key of [...this.cache.keys()]) {
      if (key === prefix || key.startsWith(prefix + '?vc=')) this.cache.delete(key);
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

export const globalHistoryCache = new HistoryCache();
