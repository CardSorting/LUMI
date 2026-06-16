// [LAYER: CORE]
// @classification CAPABILITY
import type { InvariantEngine } from '../InvariantEngine.js';

export class AuditCapability {
  constructor(
    private readonly invariantEngine: InvariantEngine,
    private readonly assertOperational: (operation: string) => void
  ) {}

  async auditInvariants(): Promise<string[]> {
    this.assertOperational('auditInvariants');
    return this.invariantEngine.auditInvariants();
  }
}
