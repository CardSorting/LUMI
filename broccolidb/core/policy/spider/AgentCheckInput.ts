// [LAYER: CORE]
/**
 * Spider check/pipeline input schemas and fail-closed validation.
 * Mirrors OpenAPI request bodies, ESLint CLI option validation, and JSON Schema dry-runs.
 */
import type {
  SpiderCheckPhase,
  SpiderCheckPipelineRequest,
  SpiderCheckRequest,
  SpiderGatePolicy,
} from './report-types.js';
import { SpiderAuditError } from './spider-errors.js';

export const SPIDER_CHECK_PHASES = ['pre-edit', 'post-edit', 'ci', 'delta'] as const satisfies readonly SpiderCheckPhase[];

export const SPIDER_CHECK_INPUT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'SpiderCheckRequest',
  type: 'object',
  required: ['phase'],
  properties: {
    phase: { enum: [...SPIDER_CHECK_PHASES] },
    filePath: { type: 'string', minLength: 1 },
    filePaths: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 },
    scope: {
      oneOf: [
        { type: 'string', enum: ['all', 'changed-files'] },
        { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 },
      ],
    },
    bundleBudget: { type: 'object' },
    gatePolicy: { type: 'object' },
    gatePreset: { enum: ['ci', 'strict', 'advisory'] },
    includeTypes: { type: 'boolean' },
    includeRepairDirectives: { type: 'boolean' },
    neighborhoodDepth: { type: 'integer', minimum: 0, maximum: 3 },
    correlationId: { type: 'string', minLength: 1 },
    agentId: { type: 'string', minLength: 1 },
    taskId: { type: 'string', minLength: 1 },
  },
  allOf: [
    {
      if: { properties: { phase: { const: 'pre-edit' } } },
      then: {
        anyOf: [{ required: ['filePath'] }, { required: ['filePaths'] }],
      },
    },
  ],
} as const;

export const SPIDER_PIPELINE_INPUT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'SpiderCheckPipelineRequest',
  type: 'object',
  properties: {
    phases: {
      type: 'array',
      items: { enum: [...SPIDER_CHECK_PHASES] },
      minItems: 1,
    },
    workflowPreset: {
      enum: ['local-edit', 'ci-gate', 'pr-review', 'advisory-scan'],
    },
    stopOnFailure: { type: 'boolean', default: true },
    filePath: { type: 'string', minLength: 1 },
    filePaths: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 },
    scope: SPIDER_CHECK_INPUT_SCHEMA.properties.scope,
    gatePreset: SPIDER_CHECK_INPUT_SCHEMA.properties.gatePreset,
    correlationId: SPIDER_CHECK_INPUT_SCHEMA.properties.correlationId,
    neighborhoodDepth: SPIDER_CHECK_INPUT_SCHEMA.properties.neighborhoodDepth,
    includeTypes: { type: 'boolean' },
    includeRepairDirectives: { type: 'boolean' },
  },
  anyOf: [{ required: ['phases'] }, { required: ['workflowPreset'] }],
} as const;

export const SPIDER_WORKFLOW_PRESETS = {
  'local-edit': {
    description: 'rust-analyzer flycheck then post-edit cargo check',
    phases: ['pre-edit', 'post-edit'] as SpiderCheckPhase[],
    requires: ['filePath or filePaths'],
    defaultGatePreset: 'ci' as const,
  },
  'ci-gate': {
    description: 'GitHub Checks / SARIF CI hard-stop on changed files',
    phases: ['ci'] as SpiderCheckPhase[],
    defaultGatePreset: 'ci' as const,
  },
  'pr-review': {
    description: 'Pre-edit → CI strict gate → baseline delta regression',
    phases: ['pre-edit', 'ci', 'delta'] as SpiderCheckPhase[],
    requires: ['filePath or filePaths', 'setBaseline for delta'],
    defaultGatePreset: 'strict' as const,
  },
  'advisory-scan': {
    description: 'Non-blocking structural scan (report only)',
    phases: ['ci'] as SpiderCheckPhase[],
    defaultGatePreset: 'advisory' as const,
  },
} as const;

export type SpiderWorkflowPreset = keyof typeof SPIDER_WORKFLOW_PRESETS;

export interface SpiderValidationIssue {
  code: string;
  message: string;
  field?: string;
}

function toValidationIssue(error: unknown): SpiderValidationIssue {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('must be a non-null object')) {
    return { code: 'SPI-VAL-001', message, field: 'request' };
  }
  if (message.includes('check.phase invalid') || message.includes('pipeline phase invalid')) {
    return { code: 'SPI-VAL-002', message, field: 'phase' };
  }
  if (message.includes('pre-edit requires')) {
    return { code: 'SPI-VAL-003', message, field: 'filePath' };
  }
  if (message.includes('neighborhoodDepth')) {
    return { code: 'SPI-VAL-004', message, field: 'neighborhoodDepth' };
  }
  if (message.includes('gatePreset')) {
    return { code: 'SPI-VAL-005', message, field: 'gatePreset' };
  }
  if (message.includes('scope')) {
    return { code: 'SPI-VAL-006', message, field: 'scope' };
  }
  if (message.includes('correlationId')) {
    return { code: 'SPI-VAL-007', message, field: 'correlationId' };
  }
  if (message.includes('filePaths')) {
    return { code: 'SPI-VAL-008', message, field: 'filePaths' };
  }
  if (message.includes('requires phases or workflowPreset')) {
    return { code: 'SPI-VAL-009', message, field: 'phases' };
  }
  if (message.includes('workflowPreset invalid')) {
    return { code: 'SPI-VAL-010', message, field: 'workflowPreset' };
  }
  return { code: 'SPI-VAL-000', message };
}

/** Apply production defaults after validation — mirrors ESLint default option resolution. */
export function normalizeCheckRequest(request: SpiderCheckRequest): SpiderCheckRequest {
  const r = { ...request };
  if ((r.phase === 'ci' || r.phase === 'post-edit') && r.scope === undefined) {
    r.scope = 'changed-files';
  }
  if (r.phase === 'ci' && r.gatePreset === undefined && r.gatePolicy === undefined) {
    r.gatePreset = 'ci';
  }
  if (r.includeRepairDirectives === undefined) {
    r.includeRepairDirectives = true;
  }
  if (r.includeTypes === undefined) {
    r.includeTypes = r.phase !== 'pre-edit';
  }
  return r;
}

export function normalizeCheckPipelineRequest(request: SpiderCheckPipelineRequest): SpiderCheckPipelineRequest {
  const resolved = applyWorkflowPreset(request);
  return {
    ...resolved,
    includeRepairDirectives: resolved.includeRepairDirectives ?? true,
    includeTypes: resolved.includeTypes ?? false,
    scope: resolved.scope ?? 'changed-files',
  };
}

function validateSharedCheckFields(r: Partial<SpiderCheckRequest>): void {
  if (r.neighborhoodDepth !== undefined && (!Number.isInteger(r.neighborhoodDepth) || r.neighborhoodDepth < 0)) {
    throw new SpiderAuditError('check.neighborhoodDepth must be a non-negative integer');
  }
  if (r.gatePreset !== undefined && !['ci', 'strict', 'advisory'].includes(r.gatePreset)) {
    throw new SpiderAuditError('check.gatePreset must be ci | strict | advisory');
  }
  if (r.scope !== undefined) {
    if (typeof r.scope !== 'string' && !Array.isArray(r.scope)) {
      throw new SpiderAuditError('check.scope must be all | changed-files | string[]');
    }
    if (typeof r.scope === 'string' && !['all', 'changed-files'].includes(r.scope)) {
      throw new SpiderAuditError('check.scope must be all or changed-files');
    }
    if (Array.isArray(r.scope) && r.scope.some((s) => typeof s !== 'string' || !s.trim())) {
      throw new SpiderAuditError('check.scope file paths must be non-empty strings');
    }
  }
  if (r.correlationId !== undefined && (typeof r.correlationId !== 'string' || !r.correlationId.trim())) {
    throw new SpiderAuditError('check.correlationId must be a non-empty string');
  }
  if (
    r.filePaths !== undefined &&
    (!Array.isArray(r.filePaths) || r.filePaths.some((f) => typeof f !== 'string' || !f.trim()))
  ) {
    throw new SpiderAuditError('check.filePaths must be a non-empty string array');
  }
}

/** Fail-closed validation for check() requests. */
export function validateCheckRequest(request: unknown): asserts request is SpiderCheckRequest {
  if (!request || typeof request !== 'object') {
    throw new SpiderAuditError('SpiderCheckRequest must be a non-null object');
  }
  const r = request as SpiderCheckRequest;
  if (!SPIDER_CHECK_PHASES.includes(r.phase)) {
    throw new SpiderAuditError('check.phase invalid');
  }
  if (r.phase === 'pre-edit' && !r.filePath && !(r.filePaths && r.filePaths.length > 0)) {
    throw new SpiderAuditError('check pre-edit requires filePath or filePaths');
  }
  validateSharedCheckFields(r);
}

/** Fail-closed validation for runCheckPipeline() requests. */
export function validateCheckPipelineRequest(request: unknown): asserts request is SpiderCheckPipelineRequest {
  if (!request || typeof request !== 'object') {
    throw new SpiderAuditError('SpiderCheckPipelineRequest must be a non-null object');
  }
  const r = request as SpiderCheckPipelineRequest;
  if (r.workflowPreset !== undefined && !(r.workflowPreset in SPIDER_WORKFLOW_PRESETS)) {
    throw new SpiderAuditError('pipeline.workflowPreset invalid');
  }
  const phases = r.phases ?? (r.workflowPreset ? SPIDER_WORKFLOW_PRESETS[r.workflowPreset].phases : undefined);
  if (!phases || phases.length === 0) {
    throw new SpiderAuditError('pipeline requires phases or workflowPreset');
  }
  for (const phase of phases) {
    if (!SPIDER_CHECK_PHASES.includes(phase)) {
      throw new SpiderAuditError(`pipeline phase invalid: ${phase}`);
    }
  }
  if (phases.includes('pre-edit') && !r.filePath && !(r.filePaths && r.filePaths.length > 0)) {
    throw new SpiderAuditError('pipeline pre-edit requires filePath or filePaths');
  }
  validateSharedCheckFields(r);
}

export function applyWorkflowPreset(request: SpiderCheckPipelineRequest): SpiderCheckPipelineRequest {
  if (!request.workflowPreset) {
    return request;
  }
  const preset = SPIDER_WORKFLOW_PRESETS[request.workflowPreset];
  return {
    ...request,
    phases: request.phases?.length ? request.phases : [...preset.phases],
    gatePreset: request.gatePreset ?? preset.defaultGatePreset,
  };
}

export function safeValidateCheckRequest(
  request: unknown
):
  | { valid: true; request: SpiderCheckRequest; normalized: SpiderCheckRequest }
  | { valid: false; errors: string[]; issues: SpiderValidationIssue[] } {
  try {
    validateCheckRequest(request);
    const validated = request as SpiderCheckRequest;
    return { valid: true, request: validated, normalized: normalizeCheckRequest(validated) };
  } catch (error) {
    const issue = toValidationIssue(error);
    return { valid: false, errors: [issue.message], issues: [issue] };
  }
}

export function safeValidateCheckPipelineRequest(
  request: unknown
):
  | { valid: true; request: SpiderCheckPipelineRequest; normalized: SpiderCheckPipelineRequest }
  | { valid: false; errors: string[]; issues: SpiderValidationIssue[] } {
  try {
    validateCheckPipelineRequest(request);
    const validated = request as SpiderCheckPipelineRequest;
    const normalized = normalizeCheckPipelineRequest(validated);
    return { valid: true, request: validated, normalized };
  } catch (error) {
    const issue = toValidationIssue(error);
    return { valid: false, errors: [issue.message], issues: [issue] };
  }
}

export function getWorkflowPresets() {
  return SPIDER_WORKFLOW_PRESETS;
}
