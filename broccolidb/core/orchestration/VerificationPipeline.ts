// [LAYER: CORE]
import { randomUUID } from 'node:crypto';
import type {
  SpiderAuditOptions,
  SpiderFinding,
  SpiderGateResult,
  SpiderReport,
  SpiderReportDiff,
} from '../policy/spider/report-types.js';
import type { RepairExecution, VerificationResult } from './types.js';
import type { ExecutionTrace } from './ExecutionTrace.js';

export interface SpiderVerificationPort {
  audit(options?: SpiderAuditOptions): Promise<SpiderReport>;
  gate(options?: SpiderAuditOptions): Promise<SpiderGateResult>;
  diffSinceLast(report?: SpiderReport): SpiderReportDiff | null;
}

export interface InvariantPort {
  auditInvariants(): Promise<string[]>;
}

function findingKey(f: SpiderFinding): string {
  return `${f.diagnosticId}:${f.filePath}:${f.message}`;
}

export class VerificationPipeline {
  constructor(
    private readonly spider: SpiderVerificationPort,
    private readonly invariants: InvariantPort,
    private readonly trace: ExecutionTrace
  ) {}

  async verify(input: {
    execution: RepairExecution;
    sessionId: string;
    baselineReport?: SpiderReport;
  }): Promise<VerificationResult> {
    this.trace.emit(input.sessionId, 'verification_started', {
      executionId: input.execution.executionId,
    });

    const started = Date.now();
    const postAudit = await this.spider.audit({
      scope: 'changed-files',
      includeTypes: true,
      includeRepairDirectives: true,
    });
    const gate = await this.spider.gate({ scope: 'changed-files' });
    const invariantViolations = await this.invariants.auditInvariants();
    const diff = this.spider.diffSinceLast(postAudit);

    const baseline = input.baselineReport;
    let introducedFindings: SpiderFinding[] = [];
    let resolvedFindings: SpiderFinding[] = [];

    if (baseline) {
      const baselineKeys = new Set(baseline.findings.map(findingKey));
      const postKeys = new Set(postAudit.findings.map(findingKey));
      introducedFindings = postAudit.findings.filter((f) => !baselineKeys.has(findingKey(f)));
      resolvedFindings = baseline.findings.filter((f) => !postKeys.has(findingKey(f)));
    } else if (diff) {
      const toFinding = (entry: (typeof diff.introduced)[number]): SpiderFinding => ({
        findingId: entry.findingId,
        diagnosticId: entry.diagnosticId,
        severity: 'ERROR',
        label: entry.diagnosticId,
        filePath: entry.filePath,
        evidence: [],
        message: entry.message,
      });
      introducedFindings = diff.introduced.map(toFinding);
      resolvedFindings = diff.resolved.map(toFinding);
    }

    const driftStatus =
      postAudit.diskParity?.some((p) => p.driftStatus === 'drifted' || p.driftStatus === 'missing')
        ? 'drifted'
        : 'clean';

    const passed =
      gate.exitCode === 0 &&
      invariantViolations.length === 0 &&
      driftStatus === 'clean' &&
      introducedFindings.filter((f) => f.severity === 'ERROR').length === 0;

    const result: VerificationResult = {
      verificationId: randomUUID(),
      sessionId: input.sessionId,
      executionId: input.execution.executionId,
      passed,
      introducedFindings,
      resolvedFindings,
      remainingFindings: postAudit.findings,
      driftStatus,
      gateStatus: gate.exitCode === 0 ? 'pass' : 'fail',
      invariantViolations,
      diff,
      gate,
      verifiedAt: Date.now(),
    };

    this.trace.emit(input.sessionId, 'verification_completed', {
      verificationId: result.verificationId,
      passed,
      latencyMs: Date.now() - started,
      introduced: introducedFindings.length,
      resolved: resolvedFindings.length,
    });

    return result;
  }
}
