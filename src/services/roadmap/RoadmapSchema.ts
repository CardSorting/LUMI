export const REQUIRED_SECTIONS = [
	"1. Project Center of Gravity",
	"2. Roadmap Health",
	"3. Strategic Narrative",
	"4. Now",
	"5. Next",
	"6. Later",
	"7. Discovery",
	"8. Maintenance Gravity",
	"9. Centralization & Code Soup Audit",
	"10. Decision Log",
	"11. Recent Checkpoint",
	"12. Archive",
] as const

export const HEALTH_STATUSES = new Set([
	"Coherent",
	"Accelerating",
	"Drifting",
	"Fragmenting",
	"Blocked",
	"Overloaded",
	"Recovering",
])

export const SOUP_RISK_LEVELS = new Set(["Low", "Medium", "High"])
export const GRAVITY_IMPACTS = new Set(["Strengthens", "Neutral", "Weakens", "Unknown"])
export const CENTRALIZATION_EFFECTS = new Set(["Centralizes", "No Change", "Decentralizes"])
export const ENTROPY_RISKS = new Set(["Low", "Medium", "High"])

export const BOOTSTRAP_PLACEHOLDER_PHRASES = [
	"Describe from README and project evidence",
	"Define from README and project evidence",
	"Identify from README and config evidence.",
	"Derived from README and config evidence during bootstrap.",
	"Describe the main architectural shape from docs and code layout.",
	"Document from architecture docs and repo layout.",
	"List the primary flows agents and humans must preserve.",
	"Preserve primary agent and operator flows identified in README and recent commits.",
	"State where operational truth lives.",
	"List anti-goals that protect coherence.",
	"Describe what the project is becoming using README, architecture docs, and recent commits.",
	"Initial audit from evidence bundle.",
	"Evidence-backed initial audit — see code_soup_pre_audit in checkpoint payload.",
	"Document runtime, state, mutation, and diagnostic authority.",
	"Runtime and mutation authority documented in project docs; plugin/kernel trees are not project roots.",
	"Review recent git changes for isolated patterns.",
	"Confirm canonical patch and inspection paths are obvious.",
	"One recommendation to strengthen project gravity.",
	"Initial structure only — audit pending deeper pass.",
	"Initial roadmap bootstrap.",
	"Insufficient evidence during first pass.",
	"Clear center of gravity before feature sprawl.",
	"A fragmented patch surface without a documented center of gravity.",
	"Hermes workspace project root — ROADMAP.md lives beside source, not in plugin install trees.",
	"Run code_soup_pre_audit and document canonical paths.",
	"Document canonical paths from code_soup_pre_audit.",
	"No recent git activity in evidence.",
	"No recent git commits captured in evidence.",
	"Created initial ROADMAP.md from evidence.",
	"Populate Now with 1–3 evidence-backed items connected to center of gravity.",
	"Populated from code_soup_pre_audit during bootstrap.",
	"Enable long-horizon coherence under agent-assisted development.",
	"Strategic work routes through Now/Next/Later instead of ad-hoc task dumps.",
	"Adopt ROADMAP.md as the project steering surface.",
]

export interface ValidationIssue {
	severity: "error" | "warning"
	code: string
	message: string
	section?: string
}

export interface RoadmapValidation {
	valid: boolean
	schema_complete: boolean
	health_status?: string
	code_soup_risk?: string
	now_item_count: number
	issues: ValidationIssue[]
}

export function findBootstrapPlaceholders(content: string): ValidationIssue[] {
	const issues: ValidationIssue[] = []
	for (const phrase of BOOTSTRAP_PLACEHOLDER_PHRASES) {
		if (content.includes(phrase)) {
			issues.push({
				severity: "warning",
				code: "bootstrap_placeholder",
				message: `Replace template guidance still present: “${phrase}”`,
				section: "",
			})
		}
	}
	return issues
}

export function getSectionBody(content: string, sectionTitle: string): string {
	const escaped = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	const regex = new RegExp(`^##\\s+${escaped}\\s*$[\\r\\n]([\\s\\S]*?)(?=^##\\s+|\\Z)`, "m")
	const match = regex.exec(content)
	return match ? match[1] : ""
}

function countSubsections(sectionBody: string): number {
	const matches = sectionBody.match(/^###\s+\d+\.\s+/gm)
	return matches ? matches.length : 0
}

export function validateRoadmapContent(content: string): RoadmapValidation {
	const issues: ValidationIssue[] = []
	if (!content || !content.trim()) {
		return {
			valid: false,
			schema_complete: false,
			now_item_count: 0,
			issues: [{ severity: "error", code: "missing_file", message: "ROADMAP.md is empty or missing" }],
		}
	}

	const missingSections: string[] = []
	for (const section of REQUIRED_SECTIONS) {
		const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
		const regex = new RegExp(`^##\\s+${escaped}\\s*$`, "m")
		if (!regex.test(content)) {
			missingSections.push(section)
		}
	}

	const schema_complete = missingSections.length === 0
	for (const section of missingSections) {
		issues.push({
			severity: "error",
			code: "missing_section",
			message: `Missing required section: ${section}`,
			section,
		})
	}

	let healthStatus: string | undefined
	const healthBody = getSectionBody(content, "2. Roadmap Health")
	const statusMatch = /\*\*Status:\*\*\s*([A-Za-z]+)/.exec(healthBody)
	if (statusMatch) {
		const candidate = statusMatch[1].trim()
		// Case-insensitive match
		for (const status of HEALTH_STATUSES) {
			if (status.toLowerCase() === candidate.toLowerCase()) {
				healthStatus = status
				break
			}
		}
		if (!healthStatus) {
			issues.push({
				severity: "error",
				code: "invalid_health_status",
				message: `Invalid health status: ${candidate}`,
				section: "2. Roadmap Health",
			})
		}
	} else if (schema_complete) {
		issues.push({
			severity: "warning",
			code: "unparsed_health_status",
			message: "Could not parse **Status:** in section 2",
			section: "2. Roadmap Health",
		})
	}

	let codeSoupRisk: string | undefined
	const soupBody = getSectionBody(content, "9. Centralization & Code Soup Audit")
	const soupMatch = /\*\*Overall Code Soup Risk:\*\*\s*(Low|Medium|High)/i.exec(soupBody)
	if (soupMatch) {
		const label = soupMatch[1].trim()
		const capitalized = label.charAt(0).toUpperCase() + label.slice(1).toLowerCase()
		if (SOUP_RISK_LEVELS.has(capitalized)) {
			codeSoupRisk = capitalized
		}
	}
	if (schema_complete && !soupBody.trim()) {
		issues.push({
			severity: "error",
			code: "missing_code_soup_audit",
			message: "Section 9 (Centralization & Code Soup Audit) is mandatory",
			section: "9. Centralization & Code Soup Audit",
		})
	} else if (schema_complete && !codeSoupRisk) {
		issues.push({
			severity: "warning",
			code: "unparsed_code_soup_risk",
			message: "Could not parse **Overall Code Soup Risk:** in section 9",
			section: "9. Centralization & Code Soup Audit",
		})
	}

	const cogBody = getSectionBody(content, "1. Project Center of Gravity")
	if (schema_complete && !cogBody.toLowerCase().includes("must not become")) {
		issues.push({
			severity: "error",
			code: "missing_anti_goals",
			message: "Section 1 must include **What This Project Must Not Become:**",
			section: "1. Project Center of Gravity",
		})
	}

	const nowBody = getSectionBody(content, "4. Now")
	const now_item_count = countSubsections(nowBody)
	if (now_item_count > 5) {
		issues.push({
			severity: "warning",
			code: "now_overloaded",
			message: `Now has ${now_item_count} items — roadmap is overloaded (max 5)`,
			section: "4. Now",
		})
	}

	const errors = issues.filter((i) => i.severity === "error")
	const placeholders = findBootstrapPlaceholders(content)
	issues.push(...placeholders)

	return {
		valid: errors.length === 0,
		schema_complete,
		health_status: healthStatus,
		code_soup_risk: codeSoupRisk,
		now_item_count,
		issues,
	}
}

export function bootstrapSkeleton(params: {
	project_hint?: string
	strategic_narrative?: string
	operators_hint?: string
	canonical_architecture?: string
	canonical_workflows?: string
	runtime_center?: string
	anti_goals?: string
	health_summary?: string
	now_section?: string
	checkpoint_next_move?: string
	code_soup_risk?: string
	centralization_recommendation?: string
	recent_git_summary?: string
	changed_files?: string[]
}): string {
	const today = new Date().toISOString().split("T")[0]
	const hint = params.project_hint?.trim() || "Define from README and project evidence"
	const narrative = (params.strategic_narrative || hint).trim()
	const operators = params.operators_hint?.trim() || "Derived from README and config evidence during bootstrap."
	const architecture = params.canonical_architecture?.trim() || "Document from architecture docs and repo layout."
	const workflows =
		params.canonical_workflows?.trim() || "Preserve primary agent and operator flows identified in README and recent commits."
	const runtime =
		params.runtime_center?.trim() || "Workspace project root — ROADMAP.md lives beside source, not in plugin install trees."
	const must_not = params.anti_goals?.trim() || "A fragmented patch surface without a documented center of gravity."
	const health = params.health_summary?.trim() || "Initial roadmap bootstrap."
	const risk = params.code_soup_risk || "Low"
	const centralize = params.centralization_recommendation?.trim() || "Document canonical paths from code_soup_pre_audit."
	const git_summary = params.recent_git_summary?.trim() || "No recent git activity in evidence."
	const drift_lines =
		params.changed_files && params.changed_files.length > 0
			? params.changed_files
					.slice(0, 8)
					.map((f) => `- ${f}`)
					.join("\n")
			: "- None captured"
	const now_block = params.now_section?.trim() || ""
	const next_move =
		params.checkpoint_next_move?.trim() || "Populate Now with 1–3 evidence-backed items connected to center of gravity."

	return `# ROADMAP.md

## 1. Project Center of Gravity

**Core Purpose:**  
${hint}

**Primary Users / Operators:**  
${operators}

**Canonical Architecture:**  
${architecture}

**Canonical Workflows:**  
${workflows}

**Primary Runtime / Operational Center:**  
${runtime}

**What This Project Must Not Become:**  
${must_not}

## 2. Roadmap Health

**Status:** Coherent

**Summary:**  
${health}

**Why This Status:**  
- ROADMAP.md created from gathered evidence
- Schema established for long-horizon steering

**Primary Risk:**  
Insufficient evidence during first pass.

**Primary Opportunity:**  
Clear center of gravity before feature sprawl.

## 3. Strategic Narrative

${narrative}

## 4. Now

${now_block}

## 5. Next

## 6. Later

## 7. Discovery

## 8. Maintenance Gravity

### Hotspots

| Area | Symptom | Risk | Recommended Action |
|---|---|---|---|
| | | Low | |

### Repeated Friction

### Documentation Gaps

### Agent Confusion Points

## 9. Centralization & Code Soup Audit

**Overall Code Soup Risk:** ${risk}

### Canonical Path Integrity

**Assessment:**  
Evidence-backed initial audit — see code_soup_pre_audit in checkpoint payload.

### Authority Boundaries

**Assessment:**  
Runtime and mutation authority documented in project docs; plugin/kernel trees are not project roots.

### Structural Drift

**Assessment:**  
Recent changes from git evidence:
${drift_lines}

### Agent Coherence

**Assessment:**  
${git_summary}

### Centralization Recommendation

${centralize}

## 10. Decision Log

### ${today} — Initial roadmap bootstrap

**Decision:**  
Adopt ROADMAP.md as the project steering surface.

**Reason:**  
Enable long-horizon coherence under agent-assisted development.

**Impact:**  
Strategic work routes through Now/Next/Later instead of ad-hoc task dumps.

**Follow-up:**  
Run roadmap checkpoints after meaningful direction changes.

## 11. Recent Checkpoint

**Date:** ${today}

**Checkpoint Summary:**  
Created initial ROADMAP.md from evidence.

**Moved:**  
- None

**Added:**  
- Full 12-section schema

**Updated:**  
- None

**Archived:**  
- None

**Code Soup Risk:** ${risk}  
Populated from code_soup_pre_audit during bootstrap.

**Recommended Next Move:**  
${next_move}

## 12. Archive
`
}
