import { gateEditInstruction } from "./RoadmapAutoGovernance"
import type { RoadmapConfig } from "./RoadmapConfig"
import { getRoadmapConfig } from "./RoadmapConfig"
import type { RoadmapValidation } from "./RoadmapSchema"
import { findBootstrapPlaceholders } from "./RoadmapSchema"
import { isWorkspaceSkillInstalled } from "./RoadmapSkillInstall"

export interface GateClosedEntry {
	id: string
	label: string
	why: string
	fix: string
	safe_to_apply: boolean
	blocks_kanban_complete: boolean
}

export interface GateInputs {
	config: RoadmapConfig
	workspace: string
	roadmap_path: string
	roadmap_present: boolean
	validation: RoadmapValidation | null
	freshness: Record<string, unknown>
	workspace_state: Record<string, unknown>
	bootstrap_complete: boolean | null
	bootstrap_placeholder_count: number | null
	project_fingerprint: Record<string, unknown>
	evidence_roadmap: Record<string, unknown>
	workspace_skill_installed: boolean
}

export interface GateState {
	enabled: boolean
	workspace: string
	roadmap_present: boolean
	schema_valid: boolean
	schema_complete: boolean
	checkpoint_fresh: boolean
	checkpoint_stale: boolean
	stale_reason: string
	stale_summary: string
	kanban_complete_allowed: boolean
	closed_gates: GateClosedEntry[]
	open_gates: string[]
	closed_gate_count: number
	blocking_gate_count: number
	blocking_gates: GateClosedEntry[]
	checkpoint_allowed: boolean
	preferred_command: string
	validation_pending: boolean
	bootstrap_complete: boolean
	bootstrap_placeholder_count: number
	workspace_state: Record<string, unknown>
	temporal_validity?: Record<string, any>
}

type GateCheckFn = (inputs: GateInputs) => boolean

interface GateCheckDef {
	id: string
	label: string
	isOpen: GateCheckFn
	whyClosed: string
	fix: string
	safe: boolean
	blocksKanbanComplete: boolean
}

const GATE_CHECKS: GateCheckDef[] = [
	{
		id: "roadmap_enabled",
		label: "Roadmap feature enabled",
		isOpen: (i) => i.config.enabled,
		whyClosed: "dietcode.roadmap.enabled is false",
		fix: "Set MIRA_ROADMAP_ENABLED=true or dietcode.roadmap.enabled in config",
		safe: true,
		blocksKanbanComplete: false,
	},
	{
		id: "workspace_safe",
		label: "Project workspace (not plugin install tree)",
		isOpen: (i) => !!i.workspace && !isQuarantinedWorkspace(i.workspace),
		whyClosed: "ROADMAP.md must live in the project workspace, not the extension/plugin directory",
		fix: "Open your project workspace root in the editor",
		safe: true,
		blocksKanbanComplete: true,
	},
	{
		id: "roadmap_present",
		label: "ROADMAP.md exists",
		isOpen: (i) => i.roadmap_present,
		whyClosed: "No steering surface at workspace root",
		fix: "roadmap(action='checkpoint') to bootstrap ROADMAP.md",
		safe: true,
		blocksKanbanComplete: false,
	},
	{
		id: "workspace_skill_installed",
		label: "Auto-rolling roadmap skill installed",
		isOpen: (i) => i.workspace_skill_installed,
		whyClosed: "optional-skills/dietcode/auto-rolling-roadmap/SKILL.md missing",
		fix: "roadmap(action='doctor') or restart task (auto_install_skills)",
		safe: true,
		blocksKanbanComplete: false,
	},
	{
		id: "schema_valid",
		label: "ROADMAP.md schema valid",
		isOpen: (i) => {
			if (!i.roadmap_present) return true
			return i.validation ? i.validation.valid : i.workspace_state.schema_valid !== false
		},
		whyClosed: "Schema validation failed — checkpoint pass incomplete",
		fix: "Repair ROADMAP.md schema — validation runs automatically at attempt_completion",
		safe: true,
		blocksKanbanComplete: false,
	},
	{
		id: "validation_current",
		label: "ROADMAP.md validated after last edit",
		isOpen: (i) => !i.roadmap_present || !i.workspace_state.validation_pending,
		whyClosed: "ROADMAP.md changed since last schema validation",
		fix: "Validation runs automatically at attempt_completion — repair ROADMAP.md if still blocked",
		safe: true,
		blocksKanbanComplete: true,
	},
	{
		id: "checkpoint_fresh",
		label: "Recent checkpoint fresh",
		isOpen: (i) => !i.roadmap_present || !i.freshness.stale,
		whyClosed: "Checkpoint stale vs project activity or missing date",
		fix: "Update the Recent Checkpoint section in ROADMAP.md to reflect current work",
		safe: true,
		blocksKanbanComplete: true,
	},
	{
		id: "bootstrap_complete",
		label: "Bootstrap placeholders filled",
		isOpen: (i) => !i.roadmap_present || i.bootstrap_complete !== false,
		whyClosed: "ROADMAP.md still contains unfilled bootstrap/template guidance phrases",
		fix: "Bootstrap autofill runs automatically at attempt_completion — edit remaining placeholders in ROADMAP.md",
		safe: true,
		blocksKanbanComplete: false,
	},
]

const QUARANTINE_MARKERS = ["codemarie-new/dist", "dietcode-plugin", ".vscode/extensions"]

export function isQuarantinedWorkspace(workspace: string): boolean {
	const normalized = workspace.replace(/\\/g, "/").toLowerCase()
	return QUARANTINE_MARKERS.some((marker) => normalized.includes(marker.replace(/\\/g, "/").toLowerCase()))
}

export function evaluateGateChecks(inputs: GateInputs): { closed: GateClosedEntry[]; open: string[] } {
	const closed: GateClosedEntry[] = []
	const open: string[] = []
	const brief = String(inputs.project_fingerprint.steering_brief || inputs.project_fingerprint.steering_identity || "")

	for (const check of GATE_CHECKS) {
		if (check.isOpen(inputs)) {
			open.push(check.id)
			continue
		}

		let why = check.whyClosed
		let fix = check.fix

		if (check.id === "bootstrap_complete" && brief) {
			why = `${brief}: ${inputs.bootstrap_placeholder_count ?? "some"} unfilled bootstrap template phrase(s) remain`
		} else if (check.id === "schema_valid" && inputs.bootstrap_complete === false) {
			fix = "Bootstrap autofill runs automatically at attempt_completion — edit remaining placeholders in ROADMAP.md"
			if (brief) {
				why = `${brief}: schema validation failed — bootstrap placeholders may still remain`
			}
		} else if (check.id === "schema_valid" && brief) {
			fix = `Repair ROADMAP.md schema for ${brief}`
		}

		closed.push({
			id: check.id,
			label: check.label,
			why,
			fix: gateEditInstruction(check.id, fix),
			safe_to_apply: check.safe,
			blocks_kanban_complete: check.blocksKanbanComplete,
		})
	}

	return { closed, open }
}

export function blockingClosedGates(closed: GateClosedEntry[], cfg: RoadmapConfig): GateClosedEntry[] {
	const blocking: GateClosedEntry[] = []
	for (const gate of closed) {
		const gateId = gate.id
		if (gateId === "schema_valid" && cfg.block_kanban_on_invalid_schema) {
			blocking.push(gate)
			continue
		}
		if (!gate.blocks_kanban_complete) continue
		if (gateId === "checkpoint_fresh" && !cfg.warn_on_stale_before_complete) continue
		if (gateId === "validation_current" && !cfg.block_kanban_on_validation_pending) continue
		if (gateId === "bootstrap_complete" && !cfg.block_kanban_on_bootstrap_incomplete) continue
		blocking.push(gate)
	}
	return blocking
}

export function preferredGateCommand(inputs: GateInputs, isValid: boolean): string {
	if (inputs.workspace_state.validation_pending) return "validates automatically at attempt_completion"
	if (inputs.bootstrap_complete === false) return "bootstrap autofill runs automatically at attempt_completion"
	if (inputs.freshness.stale) return "update Recent Checkpoint (section 11) in ROADMAP.md"
	if (!isValid) return "repair ROADMAP.md schema — roadmap(action='explain_gate') for diagnostics"
	return "roadmap(action='guide')"
}

export async function buildGateStateFromInputs(inputs: GateInputs): Promise<GateState> {
	const cfg = inputs.config
	const { closed, open } = evaluateGateChecks(inputs)
	const blocking = blockingClosedGates(closed, cfg)
	const isValid = inputs.validation ? inputs.validation.valid : inputs.workspace_state.schema_valid !== false
	const validationPending = !!inputs.workspace_state.validation_pending
	const bootstrapComplete = inputs.bootstrap_complete !== false
	const bootstrapCount = inputs.bootstrap_placeholder_count ?? 0

	return {
		enabled: cfg.enabled,
		workspace: inputs.workspace,
		roadmap_present: inputs.roadmap_present,
		schema_valid: isValid,
		schema_complete: (inputs.evidence_roadmap.sections_missing as string[] | undefined)?.length === 0,
		checkpoint_fresh: !inputs.freshness.stale,
		checkpoint_stale: !!inputs.freshness.stale,
		stale_reason: String(inputs.freshness.reason || ""),
		stale_summary: String(inputs.freshness.summary || ""),
		kanban_complete_allowed: !cfg.enabled || blocking.length === 0,
		closed_gates: closed,
		open_gates: open,
		closed_gate_count: closed.length,
		blocking_gate_count: blocking.length,
		blocking_gates: blocking,
		checkpoint_allowed: !cfg.enabled || blocking.length === 0,
		preferred_command: preferredGateCommand(inputs, isValid),
		validation_pending: validationPending,
		bootstrap_complete: bootstrapComplete,
		bootstrap_placeholder_count: bootstrapCount,
		workspace_state: inputs.workspace_state,
		temporal_validity: inputs.freshness.temporal_validity as any,
	}
}

export async function collectGateInputs(params: {
	workspace: string
	evidence: Record<string, unknown>
	validation: RoadmapValidation | null
	freshness: Record<string, unknown>
	workspaceState: Record<string, unknown>
	roadmapPresent: boolean
}): Promise<GateInputs> {
	const cfg = getRoadmapConfig()
	const text = String(params.evidence._roadmap_text || "")
	const placeholders = text ? findBootstrapPlaceholders(text) : []
	const bootstrapPlaceholderCount = placeholders.length

	return {
		config: cfg,
		workspace: params.workspace,
		roadmap_path: `${params.workspace}/ROADMAP.md`,
		roadmap_present: params.roadmapPresent,
		validation: params.validation,
		freshness: params.freshness,
		workspace_state: params.workspaceState,
		bootstrap_complete: params.roadmapPresent ? bootstrapPlaceholderCount === 0 : null,
		bootstrap_placeholder_count: params.roadmapPresent ? bootstrapPlaceholderCount : null,
		project_fingerprint: (params.evidence.project_fingerprint || {}) as Record<string, unknown>,
		evidence_roadmap: (params.evidence.roadmap || {}) as Record<string, unknown>,
		workspace_skill_installed: await isWorkspaceSkillInstalled(params.workspace),
	}
}
