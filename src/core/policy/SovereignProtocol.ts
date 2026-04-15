/**
 * [LAYER: CORE]
 */

export interface SovereignDiagnostics {
	integrityScore: number
	metabolicPressure: string
	violations: string[]
	hotspots: string[]
}

/**
 * SovereignProtocol: Unified authority for Sovereign Drafting (V12).
 * Centralizes templates, validation rules, and diagnostic synthesis.
 */
export class SovereignProtocol {
	public static readonly V12_ID = "SOVEREIGN_V12"
	public static readonly MANTRA = "Double down on this concept, audit and revise in its entirety"

	/**
	 * Generates a full Sovereign Audit template with optional diagnostics.
	 */
	public static generateAuditTemplate(taskName: string, diagnostics?: SovereignDiagnostics, forensicTrace?: string): string {
		let diagnosticsBlock = ""
		if (diagnostics) {
			diagnosticsBlock =
				`## [SYSTEM DIAGNOSTICS]\n` +
				`**Integrity Score**: ${diagnostics.integrityScore}/100\n` +
				`**Metabolic Pressure**: ${diagnostics.metabolicPressure}\n\n` +
				`### Structural Antigens:\n` +
				diagnostics.violations.map((v) => `- ${v}`).join("\n") +
				"\n\n" +
				`### Active Hotspots:\n` +
				diagnostics.hotspots.map((h) => `- ${h}`).join("\n") +
				"\n\n"
		}

		const forensics = forensicTrace ? `${forensicTrace}\n\n` : ""

		return (
			`# SOVEREIGN AUDIT: ${taskName}\n\n` +
			diagnosticsBlock +
			forensics +
			`## [TRIAD PROBES]\n` +
			`### 1. THE ARCHITECT (Boundary Probe)\n` +
			`- **Vulnerability**: [Where is the layer boundary or axiom most vulnerable to leakage?]\n` +
			`- **Proof**: [Evidence of isolation and cited file paths using ~ notation]\n\n` +
			`### 2. THE CRITIC (Assumption Probe)\n` +
			`- **Weak Point**: [What single assumption if proven wrong would lead to regression?]\n` +
			`- **Hardening**: [Specific architectural fix or guardrail applied]\n\n` +
			`### 3. THE SRE (Atomic Probe)\n` +
			`- **Failure Path**: [What is the recovery path to atomic consistency during failure?]\n` +
			`- **Resilience**: [Implementation of error boundaries and state recovery logic]\n\n` +
			`## [FINAL RESOLUTION]\n` +
			`- **Synthesis**: [Summary of hardening applied (min 60 chars)]\n` +
			`- **MANTRA**: ${SovereignProtocol.MANTRA}\n`
		)
	}

	/**
	 * Generates a lightweight Sovereign Breath template.
	 */
	public static generateBreathTemplate(justification: string, hotspot?: string): string {
		return (
			`# SOVEREIGN BREATH: ${justification}\n\n` +
			`- **Objective**: [Briefly describe the target fix]\n` +
			`- **Constraint**: [Why is this safe to perform despite systemic pressure?]\n` +
			(hotspot ? `- **Hotspot**: ${hotspot}\n` : "") +
			`- **Protocol**: ${SovereignProtocol.V12_ID}\n`
		)
	}

	/**
	 * Standardized section headers for validation.
	 */
	public static readonly HEADERS = {
		AUDIT: "# SOVEREIGN AUDIT",
		BREATH: "# SOVEREIGN BREATH",
		ARCHITECT: "### 1. THE ARCHITECT",
		CRITIC: "### 2. THE CRITIC",
		SRE: "### 3. THE SRE",
		DIAGNOSTICS: "## [SYSTEM DIAGNOSTICS]",
		FORENSICS: "## [FORENSIC TRACE]",
		RESOLUTION: "## [FINAL RESOLUTION]",
		MANTRA: "**MANTRA**",
	}
}
