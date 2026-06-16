// [LAYER: CORE]
// @classification CAPABILITY
import type { ScratchpadService } from '../ScratchpadService.js';
import { capabilityHealth, type CapabilityHealth } from '../capability-health.js';

export class ScratchpadCapability {
  constructor(
    private readonly scratchpadService: ScratchpadService,
    private readonly assertOperational: (operation: string) => void,
    private readonly isStarted: () => boolean
  ) {}

  health(): CapabilityHealth {
    return capabilityHealth('scratchpad', this.isStarted(), ['ScratchpadService', 'StorageService']);
  }

  async write(filename: string, content: string): Promise<string> {
    this.assertOperational('scratchpad.write');
    return this.scratchpadService.write(filename, content);
  }

  async read(filename: string): Promise<string | null> {
    this.assertOperational('scratchpad.read');
    return this.scratchpadService.read(filename);
  }

  async list(): Promise<string[]> {
    this.assertOperational('scratchpad.list');
    return this.scratchpadService.list();
  }

  async clear(): Promise<void> {
    this.assertOperational('scratchpad.clear');
    return this.scratchpadService.clear();
  }
}
