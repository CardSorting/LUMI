// [LAYER: CORE]
// @classification CAPABILITY
import type { StorageService } from '../../../infrastructure/storage/StorageService.js';
import { CapabilityBase } from '../CapabilityBase.js';
import {
  requireHash,
  requireNonEmptyString,
  type StorageHydrateInput,
  type StorageHydrateResult,
  type StorageStoreInput,
  type StorageStoreResult,
} from '../capability-types.js';

export class StorageCapability extends CapabilityBase {
  readonly name = 'storage';
  readonly dependencies = ['StorageService'] as const;

  constructor(
    private readonly storage: StorageService,
    assertStarted: (operation: string) => void,
    isStarted: () => boolean
  ) {
    super(assertStarted, isStarted);
  }

  async store(input: StorageStoreInput): Promise<StorageStoreResult> {
    return this.execute('store', async () => {
      const content = requireNonEmptyString(input.content, 'content');
      const namespace = input.namespace?.trim() || 'default';
      const hash = await this.storage.storeContent(content);
      return { hash, namespace };
    });
  }

  async hydrate(input: StorageHydrateInput): Promise<StorageHydrateResult> {
    return this.execute('hydrate', async () => {
      const hash = requireHash(input.hash, 'hash');
      const content = await this.storage.hydrateContent(hash);
      return { hash, content };
    });
  }
}
