import ignore, { type Ignore } from 'ignore';
import type { FileTree } from './file-tree.js';

export class AgentIgnore {
  private ig: Ignore;

  constructor(rules: string) {
    // We instantiate ignore as a default import
    this.ig = ignore().add(rules);
  }

  /**
   * Loads the .agentignore rules from the root of the given branch.
   */
  static async load(files: FileTree, branch: string): Promise<AgentIgnore> {
    try {
      const entry = await files.readFile(branch, '.agentignore', { skipIgnore: true });
      return new AgentIgnore(entry.content);
    } catch {
      // If the file doesn't exist or cannot be read, assume no rules
      return new AgentIgnore('');
    }
  }

  /**
   * Checks whether the specified file path is restricted by .agentignore rules.
   */
  isIgnored(filePath: string): boolean {
    const normalized = filePath.replace(/^\/+/, '');
    if (!normalized || normalized === '.agentignore') return false;
    return this.ig.ignores(normalized);
  }
}
