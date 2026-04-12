import { orchestrator } from "@/infrastructure/ai/Orchestrator"
import { dbPool } from "@/infrastructure/db/BufferedDbPool"
import { SystemPromptSection } from "../templates/placeholders"
import type { PromptVariant, SystemPromptContext } from "../types"

export async function getJoyZoningSection(_variant?: PromptVariant, context?: SystemPromptContext) {
	const mode = context?.mode || "act"

	// Attempt to inject live audit context from the orchestration layer
	// Timeout-guarded: prompt building must never be blocked by slow DB
	let auditContext = ""
	try {
		const contextPromise = (async () => {
			const activeStreams = await orchestrator.getActiveStreams()
			if (activeStreams.length === 0) return ""

			const latestStream = activeStreams[activeStreams.length - 1]

			// Proactive Layer Awareness: Inject context for the file currently under mutation
			const affectedFiles = await dbPool.getActiveAffectedFiles()
			let layerHint = ""
			if (affectedFiles.size > 0) {
				const [firstFilePath] = Array.from(affectedFiles.keys())
				const { FluidPolicyEngine } = await import("../../../policy/FluidPolicyEngine")
				const tempEngine = new FluidPolicyEngine(process.cwd())
				layerHint = `\n\n📌 Active layer context:\n${tempEngine.getFileLayerContext(firstFilePath)}\nKeep this in mind for your next change.`
			}

			const compressed = await orchestrator.getCompressedContext(latestStream.id)
			const digest = JSON.parse(compressed)

			const parts: string[] = []
			// Check for recent audit failures to trigger self-correction
			const tasks = await orchestrator.getStreamTasks(latestStream.id)
			const lastFailure = [...tasks]
				.reverse()
				.find((t) => t.status === "failed" && t.description === "Architectural Audit Failure")
			if (lastFailure) {
				parts.push(
					`⚠️ Your previous commit had an architectural issue:\n${lastFailure.result}\nPlease address this in your next change.`,
				)
			}

			if (digest.completedTasks > 0 || digest.failedTasks > 0) {
				parts.push(`Tasks: ${digest.completedTasks} completed, ${digest.failedTasks} failed`)
			}
			if (digest.uniqueViolations && digest.uniqueViolations.length > 0) {
				parts.push(`⚠️ Recent Violations: ${digest.uniqueViolations.slice(0, 3).join("; ")}`)
			}

			// Include error history if available
			const failureReason = await orchestrator.recallMemory(latestStream.id, "failure_reason")
			if (failureReason) {
				parts.push(`🔴 Previous Failure: ${failureReason}`)
			}

			// Surface last checkpoint
			interface MemoryItem {
				streamId: string
				key: string
				updatedAt: number
			}
			const allMemory = (await dbPool.selectAllFrom("agent_memory")) as unknown as MemoryItem[]
			const checkpoint = allMemory
				.filter((m: MemoryItem) => m.streamId === latestStream.id && m.key.startsWith("checkpoint_"))
				.sort((a: MemoryItem, b: MemoryItem) => b.updatedAt - a.updatedAt)[0]
			if (checkpoint) {
				parts.push(`📍 Last Checkpoint: ${new Date(checkpoint.updatedAt as number).toLocaleString()}`)
			}

			const lastEntropy = await orchestrator.recallMemory(latestStream.id, "last_entropy_score")
			if (lastEntropy) {
				const score = Number.parseFloat(lastEntropy)
				parts.push(
					`🕷️ Structural Entropy: ${(score * 100).toFixed(1)}% ${score > 0.6 ? "(CRITICAL)" : score > 0.4 ? "(WARNING)" : "(STABLE)"}`,
				)
			}

			const decay = await orchestrator.recallMemory(latestStream.id, "entropy_decay")
			if (decay) {
				parts.push(`🕷️ ARCHITECTURAL DECAY: +${(Number.parseFloat(decay) * 100).toFixed(1)}% (CAUTION)`)
			}

			if (parts.length > 0) {
				return `\n\n📊 Live context (Stream ${latestStream.id.slice(0, 8)}…):\n${parts.join("\n")}${layerHint}`
			}
			return layerHint
		})()

		// 200ms timeout — gracefully degrade if DB is slow
		const timeoutPromise = new Promise<string>((resolve) => setTimeout(() => resolve(""), 200))
		auditContext = await Promise.race([contextPromise, timeoutPromise])
	} catch {
		// Orchestrator may not be initialized during testing or initial prompt build
	}

	// Mode-specific guidance section
	const modeGuidance =
		mode === "plan"
			? `\n
# 🗺️ PLAN MODE — Architectural Mapping
You are currently an **Architectural Consultant**. Your goal is to map the system's topology and design the integration path.
- **Prioritize Interface Contracts**: Research interfaces and type definitions before implementation details.
- **Trace Dependencies**: Map how a change in one layer (e.g., Domain) will ripple through others (Core, Infrastructure).
- **Enforce Inversion**: Ensure Domain remains isolated. If you find a Domain file importing from Infrastructure, flag it as a violation immediately.
- **Validate Suitability**: Question if logic is in the correct JoyZoning layer.

# 🏗️ ACT MODE — Architectural Commitment
You are now in the execution phase. Respect the **Architectural Commitment Seal** provided in your plan.
- **Follow the Ruleset**: Every file you read in ACT mode will include a **Layer Toolkit** with hardening rules. Follow them strictly.
- **Maintain Purity**: If you are editing a Domain file, ensure it remains free of platform leakage and side effects.
- **Implement via Interfaces**: Infrastructure changes must strictly implement the contracts defined in Domain/Core.

🔍 LAYER PROBING (Questions to answer in your plan):
- **DOMAIN**: Is this logic "pure"? Can it exist without knowing about databases or APIs?
- **CORE**: What are the high-level steps? Which Domain models does this coordinate?
- **INFRASTRUCTURE**: What external world interactions (disk, net, 3rd party) are needed?
- **UI**: What state does the user need to see? What actions will they trigger?

Example plan structure:
  📁 Domain: Add 'Order' model + validation rules (pure, no I/O)
  📁 Infrastructure: Create 'OrderRepository' adapter (implements domain interface)
  📁 Core: Wire up 'OrderTaskHandler' to coordinate domain + infra
  📁 UI: Add 'OrderForm' component (renders state, dispatches actions)`
			: `\n
⚡ ACT MODE — Execution Awareness:
Before each change, quick-scan:
1. Which layer does this file live in?
2. Am I importing from a layer I shouldn't?
3. Can I make this change smaller and more focused?

After each write, you'll see layer confirmation (✅ clean or 📍 with guidance).
When creating a new file, the system will suggest the best layer for your content.`

	return `=== ${SystemPromptSection.JOY_ZONING} ===

🏗️ JOY-ZONING: Your Architectural Guide

Joy-Zoning organizes code into clear layers so developers can find, understand, and evolve the codebase with confidence. Think of each layer as a creative zone — your job is to place code where it naturally belongs.

📐 LAYER GUIDE:

DOMAIN (src/domain/)
  Purpose: Pure business logic — the heart of the application.
  What belongs here: Models, value objects, business rules, state machines, domain events.
  What to avoid: I/O, external imports (fs, http, fetch), UI state, side effects.
  Principle: If you can't test it with zero mocks, it doesn't belong here.

CORE (src/core/)
  Purpose: Application orchestration — coordinates domain logic with infrastructure.
  What belongs here: Task coordination, prompt assembly, tool execution, API routing.
  What to avoid: Direct UI rendering, raw database queries (delegate to infrastructure).
  Principle: Orchestrate, don't implement low-level concerns directly.

INFRASTRUCTURE (src/infrastructure/, src/services/, src/integrations/)
  Purpose: Adapters and integrations — connects the outside world to domain contracts.
  What belongs here: API clients, database adapters, file system operations, external service wrappers.
  What to avoid: Business rules, UI components, domain logic.
  Principle: Implement interfaces defined by domain. Keep domain-agnostic.

UI (webview-ui/)
  Purpose: Presentation — what the user sees and interacts with.
  What belongs here: Components, views, event handlers, visual state.
  What to avoid: Business logic, direct I/O, infrastructure imports.
  Principle: Render state, dispatch intentions. Never compute business outcomes.

PLUMBING (src/utils/)
  Purpose: Shared utilities — stateless helpers used across layers.
  What belongs here: String formatters, validators, type guards, pure functions.
  What to avoid: Dependencies on any other layer (domain, infra, UI).
  Principle: Zero context. If it needs to know about a specific layer, it belongs in that layer instead.

🔄 DEPENDENCY FLOW (what can import what):
  Domain → (nothing external)
  Core → Domain, Infrastructure, Plumbing
  Infrastructure → Domain, Plumbing
  UI → Domain, Plumbing (not Infrastructure directly)
  Plumbing → (nothing — fully independent)
${modeGuidance}

💡 WHEN VIOLATIONS ARE DETECTED:
If the system flags an architectural issue, don't fight it — use it as a signal:
- Cross-layer import? → Extract an interface in Domain, implement in Infrastructure.
- Business logic in UI? → Move the logic to Domain, pass results to UI as props/state.
- I/O in Domain? → Wrap it in an Infrastructure adapter, inject via dependency inversion.
- 'any' type in Domain? → Define a proper interface or type alias.

These patterns keep the codebase navigable and maintainable over time.${auditContext}`
}
