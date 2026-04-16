/**
 * [LAYER: CORE]
 */

export interface SovereignDiagnostics {
	buildHealth: number
	metabolicPressure: string
	buildErrors: string[]
	lintWarnings: string[]
	hotspots: string[]
	refactorTurns?: number
	forensicVerified?: boolean
	karmaStatus?: string
	recursiveStabilization?: boolean
	metabolicVelocity?: number
	immuneResponse?: string
	agenticThrashing?: { loop: boolean; doubtFiles: string[] } // V185: Fail-signal detection
	healthTrend?: number // V185: Success tracking
	fragilityIndex?: Record<string, number> // V186: CCI surgical telemetry
	namingIntegrity?: number // V186: identifier casing health
	merkleDrift?: string // V186: Substrate sync detection
	vitalityPulse?: number // V187: 💓 Heartbeat metric
	resonanceDamping?: number // V100: 0.5x, 1.0x etc
	restorationActive?: boolean // V100: Recovery Buffer
	neuralFocus?: string[] // V188: Cognitive obsession tracking
	aestheticResilience?: number // V188: Noise filtering efficiency
	recoveryHint?: string // V188: Predictive restoration directive
}

/**
 * SovereignProtocol: Unified authority for Sovereign Drafting (V12).
 * Centralizes templates, validation rules, and diagnostic synthesis.
 */
export class SovereignProtocol {
	public static readonly V12_ID = "SOVEREIGN_V12"
	public static readonly MANTRA = "Double down on this concept, audit and revise in its entirety"

	public static readonly HEADERS = {
		AUDIT: "# SOVEREIGN AUDIT",
		BREATH: "# SOVEREIGN BREATH",
		AGILE: "# SOVEREIGN_AGILE",
		ARCHITECT: "### 1. THE ARCHITECT",
		CRITIC: "### 2. THE CRITIC",
		SRE: "### 3. THE SRE",
		RESOLUTION: "## [FINAL RESOLUTION]",
		DIAGNOSTICS: "## [SYSTEM DIAGNOSTICS]",
	}

	public static readonly SEMANTIC_PATTERNS = {
		AUDIT: /# SOVEREIGN AUDIT/i,
		ARCHITECT: /### 1\. THE ARCHITECT|## \[THE ARCHITECT\]|The Architect:/i,
		RESILIENCE: /### 2\. THE CRITIC|## \[THE CRITIC\]|The Critic:/i,
		RESOLUTION: /## \[FINAL RESOLUTION\]|Final Resolution:/i,
	}

	/**
	 * V29: Implicit Agility Protection.
	 * Files in infrastructure or core are often too complex for full triad audits during minor fixes.
	 */
	public static isImplicitAgileSafe(filePath: string): boolean {
		return (
			filePath.includes("/infrastructure/") ||
			filePath.includes("/core/policy/") ||
			filePath.includes(".agents/") ||
			filePath.endsWith(".md") ||
			filePath.endsWith(".json")
		)
	}

	/**
	 * Generates a full Sovereign Audit template with optional diagnostics.
	 */
	public static generateAuditTemplate(taskName: string, diagnostics?: SovereignDiagnostics, forensicTrace?: string): string {
		let diagnosticsBlock = ""
		if (diagnostics) {
			diagnosticsBlock =
				`## [BUILD STATUS]\n` +
				`**Build Health**: ${diagnostics.buildHealth}/100\n` +
				(diagnostics.forensicVerified ? `✅ **Physical Build Verified** (TSC Pruning Active)\n` : "") +
				(diagnostics.refactorTurns
					? `🏗️ **Refactor Window Active**: ${diagnostics.refactorTurns} turns remaining\n`
					: "") +
				(diagnostics.karmaStatus ? `✨ **Karma Status**: ${diagnostics.karmaStatus}\n` : "") +
				(diagnostics.vitalityPulse !== undefined
					? `💓 **Vitality Pulse**: ${diagnostics.vitalityPulse.toFixed(0)}% (${diagnostics.vitalityPulse > 80 ? "Stable" : diagnostics.vitalityPulse > 50 ? "Strained" : "Flatlining"})\n`
					: "") +
				(diagnostics.metabolicVelocity
					? `🚀 **Metabolic Velocity**: ${diagnostics.metabolicVelocity.toFixed(2)}x\n`
					: "") +
				(diagnostics.aestheticResilience !== undefined
					? `🎨 **Aesthetic Resilience**: ${(diagnostics.aestheticResilience * 100).toFixed(1)}%\n`
					: "") +
				(diagnostics.resonanceDamping && diagnostics.resonanceDamping < 1.0
					? `🧘 **Cognitive Resonance Active**: ${diagnostics.resonanceDamping}x pressure accumulation (Refactor Mode)\n`
					: "") +
				(diagnostics.restorationActive
					? `🩹 **Restoration Buffer Active**: Immunity granted for build-critical repairs\n`
					: "") +
				(diagnostics.recursiveStabilization ? `🌊 **Wave-Front Healing Active** (Dependency Stabilization)\n` : "") +
				(diagnostics.immuneResponse ? `🛡️ **Immune Response Active**: ${diagnostics.immuneResponse}\n` : "") +
				`**Metabolic Pressure**: ${diagnostics.metabolicPressure}\n\n` +
				`### Critical Build Errors:\n` +
				(diagnostics.buildErrors.length > 0
					? diagnostics.buildErrors.map((v) => `- ${v}`).join("\n")
					: "- [CLEAN BUILD]") +
				"\n\n" +
				`### Linter Warnings:\n` +
				(diagnostics.lintWarnings.length > 0
					? diagnostics.lintWarnings.map((v) => `- ${v}`).join("\n")
					: "- [ZERO SMELLS]") +
				"\n\n" +
				`### Agentic Health (V185):\n` +
				(diagnostics.agenticThrashing?.loop
					? `⚠️ **Thrashing Signal**: Recursive reading loop detected across ${diagnostics.agenticThrashing.doubtFiles.length} files. Pivoting required.\n`
					: "✅ **Cognitive Focus**: Investigative resonance is stable.\n") +
				(diagnostics.healthTrend !== undefined && diagnostics.healthTrend > 0
					? `📈 **Success Trend**: +${diagnostics.healthTrend.toFixed(1)}% (MANTRA: Double down on this concept!)\n`
					: diagnostics.healthTrend !== undefined && diagnostics.healthTrend < 0
						? `📉 **Structural Drift**: ${diagnostics.healthTrend.toFixed(1)}% (Audit and revise in its entirety)\n`
						: "") +
				"\n" +
				`### Hotspots:\n` +
				diagnostics.hotspots.map((h) => `- ${h}`).join("\n") +
				"\n\n" +
				`## [STRUCTURAL FORENSICS (V186-V188)]\n` +
				(diagnostics.namingIntegrity !== undefined
					? `⚖️ **Naming Integrity**: ${(diagnostics.namingIntegrity * 100).toFixed(1)}%\n`
					: "") +
				(diagnostics.merkleDrift
					? `🌀 **Merkle Resonance**: Drift detected. Substrate hash: ${diagnostics.merkleDrift.substring(0, 8)}...\n`
					: "✅ **Merkle Resonance**: Substrate is physically synchronized.\n") +
				(diagnostics.neuralFocus && diagnostics.neuralFocus.length > 0
					? `🧠 **Neural Focus**: ${diagnostics.neuralFocus.join(", ")}\n`
					: "") +
				(diagnostics.fragilityIndex
					? `🔴 **Fragility Clusters**:\n` +
						Object.entries(diagnostics.fragilityIndex)
							.sort((a, b) => b[1] - a[1])
							.slice(0, 3)
							.map(([p, s]) => `  - ${p}: ${s.toFixed(2)} (CCI)`)
							.join("\n")
					: "") +
				(diagnostics.recoveryHint ? `\n💡 **RECOVERY HINT**: ${diagnostics.recoveryHint}\n` : "") +
				"\n"
		}

		return (
			`${SovereignProtocol.HEADERS.AUDIT}: ${taskName}\n` +
			`Timestamp: ${new Date().toISOString()}\n` +
			`MANTRA: ${SovereignProtocol.MANTRA}\n\n` +
			diagnosticsBlock +
			`${SovereignProtocol.HEADERS.ARCHITECT} (Mental Model)\n` +
			`- **Objective**: [Clearly state the goal of this turn]\n` +
			`- **Context**: [Summary of files read/investigated]\n` +
			`- **Assumptions**: [List of logical assumptions made]\n\n` +
			`### 2. THE PATHOGEN (Risks)\n` +
			`- **Side Effects**: [Potential blast radius of the change]\n` +
			`- **Regression Risk**: [How could this break the build?]\n\n` +
			`### 3. THE CURE (Implementation Plan)\n` +
			`- [ ] Step 1: ...\n` +
			`- [ ] Step 2: ...\n\n` +
			`### 4. FORENSIC TRACE\n` +
			`${forensicTrace || "No trace provided."}\n`
		)
	}

	/**
	 * V16: Generates a lightweight Sovereign Breath template for metabolic recovery.
	 */
	public static generateBreathTemplate(taskName: string, reason?: string): string {
		return (
			`${SovereignProtocol.HEADERS.BREATH}: ${taskName}\n` +
			`Timestamp: ${new Date().toISOString()}\n` +
			`Reason: ${reason || "Metabolic Inflammation"}\n\n` +
			`### [METABOLIC STRATEGY]\n` +
			`- [ ] Resetting metabolic pressure for high-velocity focus.\n` +
			`- [ ] Re-synchronizing physical substrate hashes.\n`
		)
	}
}
