// [LAYER: CORE]
/**
 * Central JSON Schema registry — mirrors OpenAPI components.schemas and SARIF $schema URIs.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { SPIDER_AGENT_TOOL_SCHEMA } from './AgentToolkit.js';
import { SPIDER_CHECK_INPUT_SCHEMA, SPIDER_PIPELINE_INPUT_SCHEMA } from './AgentCheckInput.js';
import { SPIDER_CHECK_OUTPUT_SCHEMA } from './AgentResponse.js';
import { SPIDER_SCENARIO_OUTPUT_SCHEMA } from './AgentScenarioResponse.js';
import { SPIDER_WIRE_OUTPUT_SCHEMA } from './AgentWireRestore.js';

export const SPIDER_SCHEMA_IDS = {
  schemaRegistry: 'broccolidb.spider.schema-registry/v1',
  agentCatalog: 'broccolidb.spider.agent-catalog/v1',
  checkInput: 'broccolidb.spider.check-request/v1',
  checkOutput: 'broccolidb.spider.check-response/v1',
  pipelineInput: 'broccolidb.spider.check-pipeline-request/v1',
  scenarioOutput: 'broccolidb.spider.scenario-response/v1',
  wireOutput: 'broccolidb.spider.wire/v2',
  toolSchema: 'broccolidb.spider.tool-schema/v1',
} as const;

export function getSpiderSchemaRegistry() {
  return {
    $schema: SPIDER_SCHEMA_IDS.schemaRegistry,
    ids: { ...SPIDER_SCHEMA_IDS },
    schemas: {
      [SPIDER_SCHEMA_IDS.checkInput]: {
        ...SPIDER_CHECK_INPUT_SCHEMA,
        $id: SPIDER_SCHEMA_IDS.checkInput,
      },
      [SPIDER_SCHEMA_IDS.checkOutput]: {
        ...SPIDER_CHECK_OUTPUT_SCHEMA,
        $id: SPIDER_SCHEMA_IDS.checkOutput,
      },
      [SPIDER_SCHEMA_IDS.pipelineInput]: {
        ...SPIDER_PIPELINE_INPUT_SCHEMA,
        $id: SPIDER_SCHEMA_IDS.pipelineInput,
      },
      [SPIDER_SCHEMA_IDS.scenarioOutput]: {
        ...SPIDER_SCENARIO_OUTPUT_SCHEMA,
        $id: SPIDER_SCHEMA_IDS.scenarioOutput,
      },
      [SPIDER_SCHEMA_IDS.wireOutput]: {
        ...SPIDER_WIRE_OUTPUT_SCHEMA,
        $id: SPIDER_SCHEMA_IDS.wireOutput,
      },
      [SPIDER_SCHEMA_IDS.toolSchema]: {
        ...SPIDER_AGENT_TOOL_SCHEMA,
        $id: SPIDER_SCHEMA_IDS.toolSchema,
      },
    },
  };
}

/** Write schema registry + per-schema files — CI bootstrap without running an audit. */
export async function writeSchemaRegistryToDir(outputDir: string): Promise<string[]> {
  const registry = getSpiderSchemaRegistry();
  const written: string[] = [];
  await fs.mkdir(outputDir, { recursive: true });

  const registryPath = path.join(outputDir, 'spider-schema-registry.json');
  await fs.writeFile(registryPath, JSON.stringify(registry, null, 2), 'utf8');
  written.push(registryPath);

  for (const [id, schema] of Object.entries(registry.schemas)) {
    const fileName = `${id.replace(/^broccolidb\./, '').replace(/\//g, '-')}.json`;
    const schemaPath = path.join(outputDir, fileName);
    await fs.writeFile(schemaPath, JSON.stringify(schema, null, 2), 'utf8');
    written.push(schemaPath);
  }

  return written;
}
