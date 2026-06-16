// [LAYER: CORE]
// @classification CAPABILITY
import type { ScratchpadService } from '../ScratchpadService.js';
import { CapabilityBase } from '../CapabilityBase.js';
import type { IntentTracer } from '../IntentTracer.js';
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
  readonly name = 'scratchpad' as const;
  readonly dependencies = ['ScratchpadService', 'StorageService'] as const;

  constructor(
    private readonly scratchpadService: ScratchpadService,
    assertStarted: (operation: string) => void,
    isStarted: () => boolean,
    intentTracer: IntentTracer
  ) {
    super(assertStarted, isStarted, intentTracer);
  }

  async write(input: ScratchpadWriteInput): Promise<ScratchpadWriteResult> {
    return this.execute(
      'write',
      async () => {
        const path = await this.scratchpadService.write(
          requireNonEmptyString(input.filename, 'filename'),
          requireNonEmptyString(input.content, 'content')
        );
        return { path };
      },
      {
        input,
        inputSummary: { filename: input.filename, contentLength: input.content.length },
        expectedEffects: ['ScratchpadService.write', 'StorageService'],
        durability: 'durable',
        summarizeResult: (result) => ({ path: result.path }),
      }
    );
  }

  async read(input: ScratchpadReadInput): Promise<ScratchpadReadResult> {
    return this.execute(
      'read',
      async () => ({
        content: await this.scratchpadService.read(requireNonEmptyString(input.filename, 'filename')),
      }),
      {
        input,
        inputSummary: { filename: input.filename },
        expectedEffects: ['ScratchpadService.read', 'StorageService'],
        durability: 'buffered',
      }
    );
  }

  async list(): Promise<ScratchpadListResult> {
    return this.execute(
      'list',
      async () => ({ files: await this.scratchpadService.list() }),
      {
        expectedEffects: ['ScratchpadService.list'],
        durability: 'ephemeral',
        summarizeResult: (result) => ({ fileCount: result.files.length }),
      }
    );
  }

  async clear(): Promise<ScratchpadClearResult> {
    return this.execute(
      'clear',
      async () => {
        await this.scratchpadService.clear();
        return { cleared: true };
      },
      { expectedEffects: ['ScratchpadService.clear'], durability: 'durable' }
    );
  }
}
