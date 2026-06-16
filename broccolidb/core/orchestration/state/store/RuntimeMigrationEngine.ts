// [LAYER: CORE]
import type { RuntimeMode } from '../../runtime/types.js';
import { RUNTIME_GRAPH_SCHEMA_VERSION } from './types.js';
import type { SerializedRuntimeGraph } from './types.js';

const MIGRATIONS: Record<string, (graph: SerializedRuntimeGraph) => SerializedRuntimeGraph> = {
  '28.0.0': (graph) => ({
    ...graph,
    schemaVersion: RUNTIME_GRAPH_SCHEMA_VERSION,
  }),
};

export class RuntimeMigrationEngine {
  private migrationStatus = 'current';

  getStatus(): string {
    return this.migrationStatus;
  }

  migrate(graph: SerializedRuntimeGraph): SerializedRuntimeGraph {
    if (graph.schemaVersion === RUNTIME_GRAPH_SCHEMA_VERSION) {
      return graph;
    }

    const migrator = MIGRATIONS[graph.schemaVersion];
    if (!migrator) {
      this.migrationStatus = `unsupported:${graph.schemaVersion}`;
      throw new Error(`Unsupported runtime graph schema: ${graph.schemaVersion}`);
    }

    try {
      const migrated = migrator(graph);
      this.migrationStatus = `migrated:${graph.schemaVersion}->${RUNTIME_GRAPH_SCHEMA_VERSION}`;
      return migrated;
    } catch (error) {
      this.migrationStatus = 'migration_failed';
      throw error;
    }
  }

  verifyCompatibility(graph: SerializedRuntimeGraph): boolean {
    return graph.schemaVersion === RUNTIME_GRAPH_SCHEMA_VERSION || Boolean(MIGRATIONS[graph.schemaVersion]);
  }
}
