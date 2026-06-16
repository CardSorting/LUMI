// [LAYER: CORE]
/**
 * Intent-routing summaries for Spider capability operations (BroccoliDB v25).
 */
export type SpiderIntentKind =
  | 'forensic-check'
  | 'check-pipeline'
  | 'preflight'
  | 'batch-preflight'
  | 'audit-gate'
  | 'wire-restore'
  | 'structural-mutation'
  | 'spider';

export function buildSpiderInputSummary(operation: string, input?: unknown): Record<string, unknown> {
  const base: Record<string, unknown> = {
    spiderOperation: operation,
    forensic: true,
  };

  if (!input || typeof input !== 'object') {
    return { ...base, intentKind: 'spider' satisfies SpiderIntentKind };
  }

  const obj = input as Record<string, unknown>;

  if (Array.isArray(obj.phases)) {
    return {
      ...base,
      intentKind: 'check-pipeline' satisfies SpiderIntentKind,
      phases: obj.phases,
      stopOnFailure: obj.stopOnFailure ?? true,
    };
  }

  if (obj.phase) {
    return {
      ...base,
      intentKind: 'forensic-check' satisfies SpiderIntentKind,
      phase: obj.phase,
      filePath: obj.filePath,
      scope: obj.scope,
      correlationId: obj.correlationId,
    };
  }

  if (Array.isArray(obj.filePaths)) {
    return {
      ...base,
      intentKind: 'batch-preflight' satisfies SpiderIntentKind,
      fileCount: obj.filePaths.length,
    };
  }

  if (typeof obj.filePath === 'string') {
    return {
      ...base,
      intentKind: 'preflight' satisfies SpiderIntentKind,
      filePath: obj.filePath,
    };
  }

  if (obj.scope !== undefined) {
    return {
      ...base,
      intentKind: 'audit-gate' satisfies SpiderIntentKind,
      scope: obj.scope,
    };
  }

  if (obj.wire !== undefined || obj.reportId !== undefined) {
    return {
      ...base,
      intentKind: 'wire-restore' satisfies SpiderIntentKind,
      reportId: obj.reportId,
    };
  }

  return { ...base, intentKind: 'spider' satisfies SpiderIntentKind };
}

export function summarizeSpiderIntentResult(
  operation: string,
  result: unknown
): Record<string, unknown> {
  if (!result || typeof result !== 'object') {
    return { spiderOperation: operation };
  }
  const r = result as Record<string, unknown>;

  if ('phases' in r && Array.isArray(r.phases)) {
    return {
      spiderOperation: operation,
      pipelineExitCode: r.exitCode,
      phaseCount: r.phases.length,
      failedPhase: r.failedPhase ?? null,
    };
  }

  if ('$schema' in r && r.$schema === 'broccolidb.spider.check-response/v1') {
    return {
      spiderOperation: operation,
      phase: r.phase,
      exitCode: r.exitCode,
      conclusion: r.conclusion,
      errors: (r.summary as { errors?: number } | undefined)?.errors ?? 0,
    };
  }

  if ('wire' in r && r.wire && typeof r.wire === 'object') {
    const wire = r.wire as { exitCode?: number; proceed?: boolean; phase?: string };
    return {
      spiderOperation: operation,
      phase: wire.phase ?? r.phase,
      exitCode: wire.exitCode ?? r.exitCode,
      proceed: wire.proceed ?? r.proceed,
    };
  }

  if ('digest' in r && 'telemetry' in r) {
    return {
      spiderOperation: operation,
      exitCode: r.exitCode,
      proceed: r.proceed,
      restored: true,
    };
  }

  if ('phase' in r && 'exitCode' in r) {
    return {
      spiderOperation: operation,
      phase: r.phase,
      exitCode: r.exitCode,
      proceed: r.proceed,
    };
  }

  return { spiderOperation: operation };
}
