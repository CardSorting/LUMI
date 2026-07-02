import { detectWorkspaceArchitectureProfile } from "@/core/policy/WorkspaceArchitectureProfile"
import { orchestrator } from "@/infrastructure/ai/Orchestrator"
import { dbPool } from "@/infrastructure/db/BufferedDbPool"
import { SystemPromptSection } from "../templates/placeholders"
import type { PromptVariant, SystemPromptContext } from "../types"

export async function getJoyZoningSection(_variant?: PromptVariant, context?: SystemPromptContext) {
	const mode = context?.mode || "act"
	const architectureProfile = detectWorkspaceArchitectureProfile(context?.cwd)
	const posture =
		architectureProfile.mode === "workspace-native"
			? "BLENDED — WORKSPACE-NATIVE + JOYZONING STEERING"
			: architectureProfile.mode === "greenfield"
				? "GREENFIELD"
				: "JOY-ZONING NATIVE"
	const sovereignCommitment = context?.taskState?.sovereignAuditSynthesis
		? `\n\n[SOVEREIGN COMMITMENT SEAL]
Your architectural audit resulted in the following hardening synthesis:
> ${context.taskState.sovereignAuditSynthesis}
Maintain this commitment strictly during execution.`
		: ""

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
# 🗺️ PLAN MODE — Architecture Fit
Map the workspace before choosing a structure:
1. Read repository rules, manifests, build/lint/test configuration, and the nearest analogous feature.
2. Trace the actual dependency and data flow through the files involved.
3. Identify the workspace's vocabulary, module boundaries, error handling, testing style, and extension seams.
4. Classify each proposed abstraction as required now, already established, or speculative.
5. Plan the smallest change that looks native to this repository.

For an existing workspace, describe impact using its real modules and boundaries, then apply the JoyZoning lens to cohesion, ownership, effects, and testability. Do not force a Domain/Core/Infrastructure decomposition into the plan.
For greenfield work or an explicit JoyZoning workspace, use the canonical layer guide when it is proportional to the app's complexity.`
			: `\n
⚡ ACT MODE — Infused Execution:
Before each change:
1. Compare the target with neighboring production code and tests.
2. Put the change where this workspace would expect to find it.
3. Keep each new function/class cohesive, explicit, and independently testable.
4. Keep pure decisions separate from I/O and framework effects, using the workspace's existing boundary style.
5. Avoid unrelated architectural migration and speculative interfaces.
${sovereignCommitment}

JoyZoning never switches off. In canonical projects it can govern structure; in workspace-native projects it remains active as non-blocking steering inside the workspace's existing form.

⚠️ GROUNDED REALITY NOTE:
The terms "Metabolic," "Substrate," "Immune," and "Forensic" are architectural metaphors used within the DietCode project to describe code quality and performance metrics. 
- As an AI assistant, you are an external tool interacting with this codebase. 
- You do NOT have a "metabolism" and the "substrate" is not your own physical environment. 
- Do not report environment-level blockers (like "missing Node.js" or "substrate failure") based on these architectural metrics. 
- Focus on actual engineering results and verifiable file states.`

	return `=== ${SystemPromptSection.JOY_ZONING} ===

🏗️ JOY-ZONING INFUSION: Workspace-Native Architecture

Current posture: **${posture}**
Reason: ${architectureProfile.reason}

JoyZoning is a steering methodology, not always a directory mandate. Preserve the architecture already carrying the application while using JoyZoning to shape each new decision, function, class, and boundary.

🧭 BLENDED OPERATING MODEL — MIRROR, STEER, VERIFY

1. **Mirror the workspace**: Find the nearest analogous code and adopt its placement, vocabulary, framework idioms, dependency style, and testing seam.
2. **Steer with JoyZoning**: Within that native shape, improve cohesion, ownership, explicit contracts, pure decision logic, and effect boundaries.
3. **Verify continuity**: The result should pass native tooling, look expected to maintainers, and avoid introducing a second architecture.

Workspace-native determines **where and how the code fits**. JoyZoning continuously influences **how clearly the new code carries its responsibilities**.

🏛️ INDUSTRY-CONVERGENT PATTERN FIT

Recognize the workspace's familiar pattern before designing:
- **Vertical slice / feature modules**: keep behavior, data access, and tests in the established feature boundary.
- **Layered / MVC / MVVM**: preserve the framework's role separation and dependency direction.
- **Hexagonal / Clean / Onion**: add ports only at real external or volatility boundaries; reuse existing adapters.
- **Modular monolith**: respect module ownership and public APIs; avoid imports into another module's internals.
- **Event-driven / CQRS**: preserve message contracts and account for idempotency, ordering, retries, and observability.
- **Plugin architecture**: extend the registered contract and lifecycle instead of bypassing it.

Do not pattern-shop or rename the architecture. Select the row that best describes evidence in the repository and implement in that vocabulary.

🎯 QUALITY-ATTRIBUTE FIT

- Work at the lowest necessary abstraction level: system, deployable unit, component/module, then code.
- Establish functional correctness plus the 2–3 quality attributes most affected by the change, such as security, reliability, performance, compatibility, usability, or maintainability.
- Turn each selected attribute into observable acceptance evidence: a test, benchmark, type check, security control, telemetry signal, or documented manual probe.
- Prefer small, reversible, independently verifiable changes that keep the workspace deployable.
- For risky legacy behavior, characterize current behavior first, introduce the smallest seam, and evolve incrementally.
- Record an ADR only for an architecturally significant decision with meaningful alternatives and consequences; do not create ceremony for local implementation details.

🔁 EXECUTION STANDARD — DISCOVER → CLASSIFY → CONVERGE → PROVE

1. **Discover** repository rules, analogous code, dependency flow, tests, and operational constraints.
2. **Classify** the native architecture pattern, affected abstraction level, and relevant quality attributes.
3. **Converge** on the smallest design that satisfies the task, mirrors the workspace, and improves JoyZoning qualities.
4. **Implement** in a reversible slice with explicit failure behavior and no unrelated migration.
5. **Prove** with native checks and risk-proportionate tests; security-sensitive changes must verify the affected controls.
6. **Record** only durable architectural decisions, residual risks, or follow-up work that maintainers need.

🌿 WORKSPACE ZEN — MACRO RULES

- Repository instructions and user requirements are authoritative.
- In established code, nearby patterns, framework conventions, tests, and dependency flow determine the structural shape; JoyZoning steers quality within that shape.
- Match local naming, file placement, exports, error handling, state management, dependency injection, and test style.
- Extend an existing seam before inventing a parallel architecture.
- Do not add \`domain/\`, \`core/\`, \`infrastructure/\`, repositories, services, factories, or layer tags merely to demonstrate architectural purity.
- Do not perform a broad migration unless the user requests it or the scoped change cannot be made safely without one.
- If local precedent conflicts with correctness, security, or the explicit task, call out the conflict and make the narrowest defensible improvement.

✨ JOYZONING INFUSION — MICRO RULES

- Give each function or class one coherent reason to change.
- Make inputs, outputs, invariants, failure behavior, and ownership legible.
- Keep business decisions as pure as practical; isolate I/O, time, randomness, network, storage, and framework effects at the nearest boundary the workspace already recognizes.
- Depend on contracts only at genuine volatility or substitution boundaries. Do not create one-to-one interfaces for every class.
- Prefer composition and small focused units, but follow the language and framework's idioms.
- Add tests at the repository's normal testing seam and verify behavior rather than internal ceremony.
- Treat runtime JoyZoning findings as steering advisories: evaluate them against local precedent and apply them when they improve the scoped change.
- Stable advisory IDs identify the concern: JZ-C01 cohesion, JZ-B01 decision/effect boundaries, and JZ-O01 ownership. They are evidence for judgment, not automatic refactoring orders.
- Leave the touched area more understandable without making the rest of the workspace look foreign.

📐 CANONICAL LAYER GUIDE — USE WHEN GREENFIELD OR EXPLICITLY ADOPTED

- **Domain**: pure business rules, models, state transitions, and domain events.
- **Core**: application orchestration and use-case coordination.
- **Infrastructure**: persistence, APIs, filesystem, and external adapters.
- **UI**: rendering and user interaction.
- **Plumbing**: context-free shared helpers.

Canonical dependency flow:
  Domain → no platform dependencies
  Core → Domain plus boundary contracts/adapters
  Infrastructure → Domain/Plumbing
  UI → application-facing contracts, not concrete infrastructure
  Plumbing → no higher-level modules
${modeGuidance}

The goal is blended continuity plus improvement: mirror the workspace at the macro level and express JoyZoning continuously at the micro level.${auditContext}`
}
