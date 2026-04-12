import { dbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

export interface AgentGitConfig {
  dbPath?: string;
}

export class Connection {
  constructor(config?: AgentGitConfig) {
    if (config?.dbPath) {
      setDbPath(config.dbPath);
    }
  }

  getPool() {
    return dbPool;
  }
}
