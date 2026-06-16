// [LAYER: CORE]
// @classification CAPABILITY
import type { StorageService } from '../../../infrastructure/storage/StorageService.js';

export class StorageCapability {
  constructor(
    private readonly storage: StorageService,
    private readonly assertOperational: (operation: string) => void
  ) {}

  async store(content: string): Promise<string> {
    this.assertOperational('store');
    return this.storage.storeContent(content);
  }

  async hydrate(hash: string): Promise<string | null> {
    this.assertOperational('hydrate');
    return this.storage.hydrateContent(hash);
  }
}
