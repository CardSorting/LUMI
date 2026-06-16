// [LAYER: CORE]
/** Native MCP spider tool names — keep in sync with broccolidb/core/mcp.ts registrations. */
export const SPIDER_MCP_TOOL_NAMES = [
  'spider_get_catalog',
  'spider_validate_check_request',
  'spider_forensic_check',
  'spider_forensic_pipeline',
  'spider_restore_wire',
  'spider_export_ci_artifacts',
] as const;

export type SpiderMcpToolName = (typeof SPIDER_MCP_TOOL_NAMES)[number];
