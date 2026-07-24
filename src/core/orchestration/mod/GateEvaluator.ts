import { DesignGateResult, MoDRunState } from "./types"

export class GateEvaluator {
	public evaluate(state: MoDRunState): DesignGateResult[] {
		const results: DesignGateResult[] = []
		const timestamp = new Date().toISOString()

		// Gate 1: Product Intent
		const intentPass = !!state.intent && !!state.intent.request.interpretedGoal
		results.push({
			gate: "product-intent",
			passed: intentPass,
			failureReasons: intentPass ? [] : ["Product intent analysis is incomplete or missing interpreted goal."],
			timestamp,
		})

		const validationResults = state.validationResults || []
		const critiqueFindings = state.critiqueFindings || []

		// Gate 2: UX Architecture
		const uxResults = validationResults.filter((v) => v.dimension === "ux" || v.dimension === "product")
		const uxPass =
			uxResults.length === 0 || uxResults.every((r) => r.status === "passed" || r.status === "passed-with-limitations")
		results.push({
			gate: "ux-architecture",
			passed: uxPass,
			failureReasons: uxPass ? [] : uxResults.flatMap((r) => r.failedCriteria || []),
			timestamp,
		})

		// Gate 3: Visual System
		const visualResults = validationResults.filter((v) => v.dimension === "visual" || v.dimension === "design-system")
		const visualPass =
			visualResults.length === 0 ||
			visualResults.every((r) => r.status === "passed" || r.status === "passed-with-limitations")
		results.push({
			gate: "visual-system",
			passed: visualPass,
			failureReasons: visualPass ? [] : visualResults.flatMap((r) => r.failedCriteria || []),
			timestamp,
		})

		// Gate 4: Interaction and State
		const interactionResults = validationResults.filter(
			(v) => v.dimension === "interaction" || v.dimension === "agentic-control",
		)
		const interactionPass =
			interactionResults.length === 0 ||
			interactionResults.every((r) => r.status === "passed" || r.status === "passed-with-limitations")
		results.push({
			gate: "interaction-state",
			passed: interactionPass,
			failureReasons: interactionPass ? [] : interactionResults.flatMap((r) => r.failedCriteria || []),
			timestamp,
		})

		// Gate 5: Accessibility
		const accessibilityResults = validationResults.filter((v) => v.dimension === "accessibility")
		const accessibilityPass =
			accessibilityResults.length === 0 ||
			accessibilityResults.every((r) => r.status === "passed" || r.status === "passed-with-limitations")
		results.push({
			gate: "accessibility",
			passed: accessibilityPass,
			failureReasons: accessibilityPass ? [] : accessibilityResults.flatMap((r) => r.failedCriteria || []),
			timestamp,
		})

		// Gate 6: Implementation Fidelity
		const implementationResults = validationResults.filter((v) => v.dimension === "implementation")
		const implementationPass =
			implementationResults.length === 0 ||
			implementationResults.every((r) => r.status === "passed" || r.status === "passed-with-limitations")
		results.push({
			gate: "implementation-fidelity",
			passed: implementationPass,
			failureReasons: implementationPass ? [] : implementationResults.flatMap((r) => r.failedCriteria || []),
			timestamp,
		})

		// Gate 7: Cross-Surface Consistency
		const responsiveResults = validationResults.filter((v) => v.dimension === "responsive")
		const responsivePass =
			responsiveResults.length === 0 ||
			responsiveResults.every((r) => r.status === "passed" || r.status === "passed-with-limitations")
		results.push({
			gate: "cross-surface-consistency",
			passed: responsivePass,
			failureReasons: responsivePass ? [] : responsiveResults.flatMap((r) => r.failedCriteria || []),
			timestamp,
		})

		// Gate 8: Final Product Critique
		const criticPass = critiqueFindings.every((f) => !f.correctionRequired)
		results.push({
			gate: "final-product-critique",
			passed: criticPass,
			failureReasons: criticPass ? [] : critiqueFindings.map((f) => f.observedFailure),
			timestamp,
		})

		return results
	}
}
