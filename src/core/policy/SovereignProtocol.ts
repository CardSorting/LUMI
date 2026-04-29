/**
 * [LAYER: CORE]
 */
import { SafeNumber } from "../../shared/utils/SafeNumber"

export interface SovereignDiagnostics {
	buildHealth: number
	workloadLevel: string
	buildErrors: string[]
	lintWarnings: string[]
	hotspots: string[]
	refactorTurns?: number
	forensicVerified?: boolean
	karmaStatus?: string
	recursiveStabilization?: boolean
	safetyGuard?: string
	agenticThrashing?: { loop: boolean; doubtFiles: string[] } // V185: Fail-signal detection
	healthTrend?: number // V185: Success tracking
	fragilityIndex?: Record<string, number> // V186: Complexity telemetry
	namingIntegrity?: number // V186: identifier casing health
	activityLevel?: number // V187: Activity metric (formerly heartbeat)
	velocityMultiplier?: number // V100: 0.5x, 1.0x etc
	restorationActive?: boolean // V100: Recovery Buffer
	neuralFocus?: string[] // V188: Cognitive obsession tracking
	aestheticResilience?: number // V188: Noise filtering efficiency
	recoveryHint?: string // V188: Predictive restoration directive
	projectVelocity?: number // Bumping hardening
	syncDrift?: string // Bumping hardening (formerly merkleDrift)
	suggestedRepairs?: string[] // V202-B: Passive healing advisories
}

/**
 * SovereignProtocol: Unified authority for Sovereign Drafting (V12).
 * Centralizes templates, validation rules, and diagnostic synthesis.
 */
export namespace SovereignProtocol {
	export const V12_ID = "CORE_V12"
	export const GUIDANCE = "Keep building on this direction, verify and refine the details"
	export const MANTRA = "Discipline ensures project health."

	export const HEADERS = {
		AUDIT: "# STRATEGIC REVIEW",
		BREATH: "# STABILITY BREAK",
		AGILE: "# AGILE_MODE",
		ARCHITECT: "### 1. THE FOUNDATION",
		CRITIC: "### 2. THE QUALITY CHECK",
		SRE: "### 3. THE STABILITY GUARD",
		RESOLUTION: "## [FINAL STEPS]",
		DIAGNOSTICS: "## [PROJECT HEALTH]",
	}

	export const SEMANTIC_PATTERNS = {
		AUDIT: /# STRATEGIC REVIEW|# SOVEREIGN AUDIT/i,
		ARCHITECT: /### 1\. THE FOUNDATION|### 1\. THE ARCHITECT|## \[THE ARCHITECT\]|The Architect:/i,
		RESILIENCE: /### 2\. THE QUALITY CHECK|### 2\. THE CRITIC|## \[THE CRITIC\]|The Critic:/i,
		RESOLUTION: /## \[FINAL STEPS\]|## \[FINAL RESOLUTION\]|Final Resolution:/i,
	}

	/**
	 * V29: Implicit Agility Protection.
	 * Files in infrastructure or core are often too complex for full triad audits during minor fixes.
	 */
	export function isImplicitAgileSafe(filePath: string): boolean {
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
	export function generateAuditTemplate(taskName: string, diagnostics?: SovereignDiagnostics, forensicTrace?: string): string {
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
				(diagnostics.activityLevel !== undefined
					? `📈 **Activity Level (Churn)**: ${SafeNumber.format(diagnostics.activityLevel, 0)}% (${diagnostics.activityLevel > 80 ? "Stable" : diagnostics.activityLevel > 50 ? "High Churn" : "Extreme Churn"})\n`
					: "") +
				(diagnostics.projectVelocity
					? `🚀 **Project Velocity**: ${SafeNumber.format(diagnostics.projectVelocity, 2)}x\n`
					: "") +
				(diagnostics.aestheticResilience !== undefined
					? `🎨 **Aesthetic Resilience**: ${SafeNumber.format(diagnostics.aestheticResilience * 100, 1)}%\n`
					: "") +
				(diagnostics.velocityMultiplier && diagnostics.velocityMultiplier < 1.0
					? `🧘 **Velocity Multiplier Active**: ${diagnostics.velocityMultiplier}x accumulation (Refactor Mode)\n`
					: "") +
				(diagnostics.restorationActive
					? `🩹 **Supportive Healing Active**: Auto-repair is helping with critical fixes\n`
					: "") +
				(diagnostics.recursiveStabilization ? `🌊 **Deep Stability Healing Active** (Aligning dependencies)\n` : "") +
				(diagnostics.safetyGuard ? `🛡️ **Safety Guard Active**: ${diagnostics.safetyGuard}\n` : "") +
				`**Workload Level**: ${diagnostics.workloadLevel}\n\n` +
				`### Required Health Fixes:\n` +
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
					? `📈 **Success Trend**: +${SafeNumber.format(diagnostics.healthTrend, 1)}% (MANTRA: Double down on this concept!)\n`
					: diagnostics.healthTrend !== undefined && diagnostics.healthTrend < 0
						? `📉 **Recent File Changes**: ${SafeNumber.format(diagnostics.healthTrend, 1)}% (Strategic review and revision encouraged)\n`
						: "") +
				"\n" +
				`### Hotspots:\n` +
				diagnostics.hotspots.map((h) => `- ${h}`).join("\n") +
				"\n\n" +
				`## [STABILITY ANALYSIS]\n` +
				(diagnostics.namingIntegrity !== undefined
					? `⚖️ **Naming Consistency**: ${SafeNumber.format(diagnostics.namingIntegrity * 100, 1)}%\n`
					: "") +
				(diagnostics.syncDrift
					? `🌀 **Sync Status (Drift)**: Slight drift detected. Local hash: ${diagnostics.syncDrift.substring(0, 8)}...\n`
					: "✅ **Sync Status**: Files are fully synchronized.\n") +
				(diagnostics.neuralFocus && diagnostics.neuralFocus.length > 0
					? `🧠 **Current Focus**: ${diagnostics.neuralFocus.join(", ")}\n`
					: "") +
				(diagnostics.fragilityIndex
					? `🔴 **High-Complexity Areas**:\n` +
						Object.entries(diagnostics.fragilityIndex)
							.sort((a, b) => b[1] - a[1])
							.slice(0, 3)
							.map(([p, s]) => `  - ${p}: ${SafeNumber.format(s, 2)} (Complexity Index)`)
							.join("\n")
					: "") +
				(diagnostics.recoveryHint ? `\n💡 **HELPFUL TIP**: ${diagnostics.recoveryHint}\n` : "") +
				(diagnostics.suggestedRepairs && diagnostics.suggestedRepairs.length > 0
					? `\n🛠️ **Suggested Repairs**:\n` +
						diagnostics.suggestedRepairs.map((r) => `  - Run 'sovereign_integrity_sweep' for: ${r}`).join("\n") +
						"\n"
					: "") +
				"\n"
		}

		return (
			`${SovereignProtocol.HEADERS.AUDIT}: ${taskName}\n` +
			`Timestamp: ${new Date().toISOString()}\n` +
			`GUIDANCE: ${SovereignProtocol.GUIDANCE}\n\n` +
			diagnosticsBlock +
			`${SovereignProtocol.HEADERS.ARCHITECT} (Current Model)\n` +
			`- **Objective**: [Clearly state the goal of this turn]\n` +
			`- **Context**: [Summary of files read/investigated]\n` +
			`- **Assumptions**: [List of logical assumptions made]\n\n` +
			`### 2. POTENTIAL RISKS\n` +
			`- **Side Effects**: [Potential impact of the change]\n` +
			`- **Regression Risk**: [How could this affect the project?]\n\n` +
			`### 3. RECOMMENDED SOLUTION\n` +
			`- [ ] Step 1: ...\n` +
			`- [ ] Step 2: ...\n\n` +
			`### 4. INVESTIGATION TRACE\n` +
			`${forensicTrace || "No trace provided."}\n`
		)
	}

	/**
	 * V16: Generates a lightweight Sovereign Breath template for metabolic recovery.
	 */
	export function generateBreathTemplate(taskName: string, reason?: string): string {
		return (
			`${SovereignProtocol.HEADERS.BREATH}: ${taskName}\n` +
			`Timestamp: ${new Date().toISOString()}\n` +
			`Reason: ${reason || "High Activity Level"}\n\n` +
			`### [STABILITY STRATEGY]\n` +
			`- [ ] Calibrating activity levels for focused progress.\n` +
			`- [ ] Re-verifying project file synchronization.\n`
		)
	}
}
