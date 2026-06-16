// [LAYER: CORE]
/**
 * CI artifact bundle — GitHub Actions / GitLab CI upload patterns.
 * Mirrors: $GITHUB_STEP_SUMMARY, ::annotation:: commands, SARIF upload, NDJSON artifacts.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SarifLog } from './AgentFormats.js';
import type { SpiderCheckResponse, SpiderCheckResult } from './report-types.js';

export interface SpiderCiArtifactFile {
  name: string;
  relativePath: string;
  content: string;
  mimeType: string;
}

export interface SpiderCiArtifacts {
  reportId: string;
  exitCode: 0 | 1;
  phase: SpiderCheckResponse['phase'];
  files: SpiderCiArtifactFile[];
  manifest: string;
}

export function buildCiArtifacts(
  result: SpiderCheckResult,
  response: SpiderCheckResponse,
  sarif?: SarifLog,
  extras?: { schemaRegistryJson?: string }
): SpiderCiArtifacts {
  const reportId = result.wire?.reportId ?? response.wire?.reportId ?? `spider-${Date.now()}`;
  const files: SpiderCiArtifactFile[] = [
    {
      name: 'step-summary',
      relativePath: 'spider-step-summary.md',
      content: response.ci.githubStepSummary,
      mimeType: 'text/markdown',
    },
    {
      name: 'annotations',
      relativePath: 'spider-annotations.txt',
      content: response.ci.githubAnnotations.join('\n'),
      mimeType: 'text/plain',
    },
    {
      name: 'check-response',
      relativePath: 'spider-check-response.json',
      content: JSON.stringify(response, null, 2),
      mimeType: 'application/json',
    },
    {
      name: 'digest',
      relativePath: 'spider-digest.md',
      content: response.digest,
      mimeType: 'text/markdown',
    },
  ];

  const wire = response.wire ?? result.wire;
  if (wire) {
    files.push({
      name: 'wire',
      relativePath: 'spider-wire.json',
      content: JSON.stringify(wire, null, 2),
      mimeType: 'application/json',
    });
  }

  if (wire?.ndjsonStream) {
    files.push({
      name: 'ndjson',
      relativePath: 'spider-check.ndjson',
      content: wire.ndjsonStream,
      mimeType: 'application/x-ndjson',
    });
  }

  if (sarif) {
    files.push({
      name: 'sarif',
      relativePath: response.ci.sarif?.artifactName ?? `spider-${reportId}.sarif.json`,
      content: JSON.stringify(sarif, null, 2),
      mimeType: 'application/sarif+json',
    });
  }

  if (response.ci.githubCheckRun) {
    files.push({
      name: 'github-check-run',
      relativePath: 'spider-github-check-run.json',
      content: JSON.stringify(response.ci.githubCheckRun, null, 2),
      mimeType: 'application/json',
    });
  }

  if (extras?.schemaRegistryJson) {
    files.push({
      name: 'schema-registry',
      relativePath: 'spider-schema-registry.json',
      content: extras.schemaRegistryJson,
      mimeType: 'application/json',
    });
  }

  const manifest = JSON.stringify(
    {
      schema: 'broccolidb.spider.ci-artifacts/v1',
      reportId,
      exitCode: result.exitCode,
      phase: result.phase,
      conclusion: response.conclusion,
      files: files.map((f) => ({ name: f.name, path: f.relativePath, mimeType: f.mimeType })),
    },
    null,
    2
  );

  return {
    reportId,
    exitCode: result.exitCode,
    phase: result.phase,
    files,
    manifest,
  };
}

/** Write CI artifacts to directory — returns absolute paths written. */
export async function writeCiArtifactsToDir(outputDir: string, artifacts: SpiderCiArtifacts): Promise<string[]> {
  const written: string[] = [];
  await fs.mkdir(outputDir, { recursive: true });
  for (const file of artifacts.files) {
    const fullPath = path.join(outputDir, file.relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, file.content, 'utf8');
    written.push(fullPath);
  }
  const manifestPath = path.join(outputDir, 'spider-artifacts.manifest.json');
  await fs.writeFile(manifestPath, artifacts.manifest, 'utf8');
  written.push(manifestPath);
  return written;
}
