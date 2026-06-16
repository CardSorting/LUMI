// [LAYER: CORE]
/**
 * CI artifact bundle — GitHub Actions / GitLab CI upload patterns.
 * Mirrors: $GITHUB_STEP_SUMMARY, ::annotation:: commands, SARIF upload, NDJSON artifacts.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SarifLog } from './AgentFormats.js';
import type { SpiderCheckResponse, SpiderCheckResult, SpiderScenarioResponse } from './report-types.js';
import { formatCheckFailure, formatScenarioFailure, toFailureNdjsonStream } from './AgentFailure.js';

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

  if (result.exitCode !== 0) {
    const failure = formatCheckFailure(response);
    files.push({
      name: 'failure-envelope',
      relativePath: 'spider-failure.json',
      content: JSON.stringify(failure, null, 2),
      mimeType: 'application/json',
    });
    files.push({
      name: 'failure-ndjson',
      relativePath: 'spider-failure.ndjson',
      content: toFailureNdjsonStream(failure),
      mimeType: 'application/x-ndjson',
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

/** CI artifacts from scenario response — includes scenario JSON + NDJSON stream. */
export function buildScenarioCiArtifacts(
  response: SpiderScenarioResponse,
  extras?: { schemaRegistryJson?: string }
): SpiderCiArtifacts {
  const checkResponse = response.checkResponse;
  const reportId =
    checkResponse?.wire?.reportId ??
    response.telemetry?.reportId?.toString() ??
    `spider-scenario-${response.scenario}-${Date.now()}`;

  const files: SpiderCiArtifactFile[] = [
    {
      name: 'scenario-response',
      relativePath: 'spider-scenario-response.json',
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

  if (response.ndjsonStream) {
    files.push({
      name: 'scenario-ndjson',
      relativePath: 'spider-scenario.ndjson',
      content: response.ndjsonStream,
      mimeType: 'application/x-ndjson',
    });
  }

  if (checkResponse) {
    files.push({
      name: 'check-response',
      relativePath: 'spider-check-response.json',
      content: JSON.stringify(checkResponse, null, 2),
      mimeType: 'application/json',
    });
    files.push({
      name: 'step-summary',
      relativePath: 'spider-step-summary.md',
      content: checkResponse.ci.githubStepSummary,
      mimeType: 'text/markdown',
    });
    files.push({
      name: 'annotations',
      relativePath: 'spider-annotations.txt',
      content: checkResponse.ci.githubAnnotations.join('\n'),
      mimeType: 'text/plain',
    });
    const wire = checkResponse.wire;
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
  }

  if (extras?.schemaRegistryJson) {
    files.push({
      name: 'schema-registry',
      relativePath: 'spider-schema-registry.json',
      content: extras.schemaRegistryJson,
      mimeType: 'application/json',
    });
  }

  if (response.exitCode !== 0) {
    const failure = formatScenarioFailure(response);
    files.push({
      name: 'failure-envelope',
      relativePath: 'spider-failure.json',
      content: JSON.stringify(failure, null, 2),
      mimeType: 'application/json',
    });
    files.push({
      name: 'failure-ndjson',
      relativePath: 'spider-failure.ndjson',
      content: toFailureNdjsonStream(failure),
      mimeType: 'application/x-ndjson',
    });
  }

  const phase = checkResponse?.phase ?? response.failedPhase ?? 'ci';
  const manifest = JSON.stringify(
    {
      schema: 'broccolidb.spider.ci-artifacts/v1',
      kind: 'scenario',
      scenario: response.scenario,
      reportId,
      exitCode: response.exitCode,
      phase,
      conclusion: checkResponse?.conclusion ?? (response.proceed ? 'success' : 'failure'),
      files: files.map((f) => ({ name: f.name, path: f.relativePath, mimeType: f.mimeType })),
    },
    null,
    2
  );

  return {
    reportId,
    exitCode: response.exitCode,
    phase,
    files,
    manifest,
  };
}
