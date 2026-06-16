// [LAYER: CORE]
// @classification CAPABILITY
import type { ScratchpadService } from '../ScratchpadService.js';
import { CapabilityBase } from '../CapabilityBase.js';
import {
  requireNonEmptyString,
  type ScratchpadClearResult,
  type ScratchpadListResult,
  type ScratchpadReadInput,
  type ScratchpadReadResult,
  type ScratchpadWriteInput,
  type ScratchpadWriteResult,
} from '../capability-types.js';

export class ScratchpadCapability extends CapabilityBase {
  readonly name = 'scratchpad';
  readonly dependencies = ['ScratchpadService', 'StorageService'] as const;

  constructor(
    private readonly scratchpadService: ScratchpadService,
    assertStarted: (operation: string) => void,
    isStarted: () => boolean
  ) {
    super(assertStarted, isStarted);
  }

  async write(input: ScratchpadWriteInput): Promise<ScratchpadWriteResult> {
    return this.execute('write', async () => {
      const path = await this.scratchpadService.write(
        requireNonEmptyString(input.filename, 'filename'),
        requireNonEmptyString(input.content, 'content')
      );
      return { path };
    });
  }

  async read(input: ScratchpadReadInput): Promise<ScratchpadReadResult> {
    return this.execute('read', async () => ({
      content: await this.scratchpadService.read(requireNonEmptyString(input.filename, 'filename')),
    }));
  }

  async list(): Promise<ScratchpadListResult> {
    return this.execute('list', async () => ({ files: await this.scratchpadService.list() }));
  }

  async clear(): Promise<ScratchpadClearResult> {
    return this.execute('clear', async () => {
      await this.scratchpadService.clear();
      return { cleared: true };
    });
  }
}
