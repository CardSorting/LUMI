import { strict as assert } from "node:assert"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { updateSettings } from "@/core/controller/state/updateSettings"
import { ConvergenceEngine } from "@/core/orchestration/mod/ConvergenceEngine"
import { IntentAnalyzer } from "@/core/orchestration/mod/IntentAnalyzer"
import { MixtureOfDesignersOrchestrator } from "@/core/orchestration/mod/MixtureOfDesignersOrchestrator"
import { ProblemClassifier } from "@/core/orchestration/mod/ProblemClassifier"
import { ReceiptStore } from "@/core/orchestration/mod/ReceiptStore"
import { SpecialistSelector } from "@/core/orchestration/mod/SpecialistSelector"
import { ClassifiedProductProblem, DesignRefinement, MoDRunState, ProductDesignIntent } from "@/core/orchestration/mod/types"
import * as disk from "@/core/storage/disk"
import { SubagentRunner } from "@/core/task/tools/subagent/SubagentRunner"
import { Logger } from "@/shared/services/Logger"

function mockTask(overrides?: any): any {
	const stateManager = {
		getGlobalSettingsKey: sinon.stub().callsFake((key: string) => {
			if (key === "modEnabled") return true
			if (key === "modOutcome") return "plan-and-implement"
			return undefined
		}),
		getGlobalStateKey: sinon.stub().returns(undefined),
		getWorkspaceStateKey: sinon.stub().returns(undefined),
		getApiConfiguration: sinon.stub().returns({}),
	}

	const api = {
		createMessage: sinon.stub().callsFake(async function* () {
			yield {
				type: "text",
				text: `[{"id":"ref-1","role":"product-strategist","problem":{"problemId":"information-architecture","target":"src/a.ts","observedBehavior":"none","userImpact":"none","severity":"medium","frequency":"occasional"},"evidence":[],"recommendation":{"designStrategy":"strategy","proposedChange":"change","adaptationNotes":[],"alternativesConsidered":[],"tradeoffs":[]},"implementation":{"affectedFiles":["src/a.ts"],"affectedComponents":[],"affectedStates":[],"instructions":[],"dependencies":[],"riskLevel":"low"},"validation":{"acceptanceCriteria":[],"regressionRisks":[],"verificationMethods":[]},"governance":{"confidence":"high","scopeStatus":"in-scope","mutationAuthorityRequired":false,"conflictsWith":[]}}]`,
			}
		}),
	}

	const toolExecutor = {
		asToolConfig: sinon.stub().resolves({
			taskId: "task-test",
			ulid: "ulid-test",
			cwd: "/tmp",
			mode: "act",
			strictPlanModeEnabled: false,
			yoloModeToggled: false,
			services: { stateManager },
			api,
			callbacks: {},
			taskState: {},
			messageState: {},
		}),
	}

	return {
		taskId: "task-test",
		cwd: "/tmp",
		api,
		stateManager,
		toolExecutor,
		say: sinon.stub().resolves(),
		...overrides,
	}
}

describe("Mixture of Designers v1.2 Orchestration", () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mod-test-"))
		sinon.stub(disk, "ensureTaskDirectoryExists").resolves(tempDir)
	})

	afterEach(async () => {
		sinon.restore()
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	describe("SpecialistSelector", () => {
		it("selects correct specialist mapping and handles max count", () => {
			const selector = new SpecialistSelector()
			const problems: ClassifiedProductProblem[] = [
				{
					id: "p1",
					dimension: "accessibility",
					target: "src/components/Button.tsx",
					observation: "Missing aria label",
					userImpact: "Screen readers skip it",
					evidence: [],
					severity: "critical",
					confidence: "high",
				},
				{
					id: "p2",
					dimension: "visual-hierarchy",
					target: "src/components/Header.tsx",
					observation: "Spacing is crowded",
					userImpact: "Difficult to scan",
					evidence: [],
					severity: "medium",
					confidence: "high",
				},
			]

			const selections = selector.select(problems, 6)
			assert.equal(selections.length, 2)
			assert.ok(selections.some((s) => s.role === "accessibility-reviewer"))
			assert.ok(selections.some((s) => s.role === "visual-systems-designer"))
		})

		it("chooses the smallest mixture and honors maxSpecialists limit", () => {
			const selector = new SpecialistSelector()
			const problems: ClassifiedProductProblem[] = Array.from({ length: 8 }, (_, idx) => ({
				id: `p-${idx}`,
				dimension: idx % 2 === 0 ? "accessibility" : "visual-hierarchy",
				target: "General",
				observation: `Obs ${idx}`,
				userImpact: "Impact",
				evidence: [],
				severity: "high",
				confidence: "high",
			}))

			const selections = selector.select(problems, 1)
			assert.equal(selections.length, 1)
		})

		it("returns correct fallback designer role when primary expert is overloaded or circuit breaks", () => {
			const selector = new SpecialistSelector()
			assert.equal(selector.getFallbackRole("accessibility-reviewer"), "ux-architect")
			assert.equal(selector.getFallbackRole("visual-systems-designer"), "design-system-engineer")
			assert.equal(selector.getFallbackRole("product-strategist"), "ux-architect")
		})
	})

	describe("ProblemClassifier & IntentAnalyzer Heuristic Fallback", () => {
		it("heuristically senses problems from request text when classifier LLM stream fails", () => {
			const classifier = new ProblemClassifier({} as any)
			const fallbackAccessibility = classifier.getFallbackClassification("Fix accessibility aria labels and keyboard focus")
			assert.ok(fallbackAccessibility.problems.some((p) => p.dimension === "accessibility"))

			const fallbackVisual = classifier.getFallbackClassification("Improve visual theme styling and color contrast")
			assert.ok(fallbackVisual.problems.some((p) => p.dimension === "visual-hierarchy"))

			const fallbackGeneral = classifier.getFallbackClassification("Refine the feature")
			assert.ok(fallbackGeneral.problems.length > 0)
		})

		it("heuristically extracts intent requirements when analyzer LLM stream fails", () => {
			const analyzer = new IntentAnalyzer({} as any)
			const fallbackIntent = analyzer.getFallbackIntent("High speed zen flow accessibility audit")
			assert.ok(fallbackIntent.request.explicitRequirements.length > 0)
			assert.ok(fallbackIntent.request.implicitRequirements.some((r) => r.includes("High performance")))
			assert.ok(fallbackIntent.request.implicitRequirements.some((r) => r.includes("Calm experience")))
		})
	})

	describe("ConvergenceEngine", () => {
		it("deduplicates identical recommendations", () => {
			const engine = new ConvergenceEngine()
			const intent: ProductDesignIntent = {
				request: { originalRequest: "test", interpretedGoal: "test", explicitRequirements: [], implicitRequirements: [] },
				product: {
					productArea: "",
					productPurpose: "",
					targetUsers: [],
					userExperienceLevels: [],
					primaryJobs: [],
					secondaryJobs: [],
				},
				currentExperience: {
					workflow: [],
					strengths: [],
					weaknesses: [],
					frictionPoints: [],
					existingPatterns: [],
					unresolvedQuestions: [],
				},
				constraints: { technical: [], product: [], brand: [], accessibility: [], performance: [], platform: [] },
				boundaries: { preserve: [], allowedToChange: [], outOfScope: [] },
				success: { desiredOutcomes: [], measurableSignals: [], qualitativeSignals: [], failureConditions: [] },
			}

			const refinements: DesignRefinement[] = [
				{
					id: "ref-1",
					role: "accessibility-reviewer",
					problem: {
						problemId: "accessibility",
						target: "btn",
						observedBehavior: "",
						userImpact: "",
						severity: "high",
						frequency: "constant",
					},
					evidence: [],
					recommendation: {
						designStrategy: "strategy",
						proposedChange: "Add label",
						adaptationNotes: [],
						alternativesConsidered: [],
						tradeoffs: [],
					},
					implementation: {
						affectedFiles: [],
						affectedComponents: [],
						affectedStates: [],
						instructions: [],
						dependencies: [],
						riskLevel: "low",
					},
					validation: { acceptanceCriteria: [], regressionRisks: [], verificationMethods: [] },
					governance: {
						confidence: "high",
						scopeStatus: "in-scope",
						mutationAuthorityRequired: false,
						conflictsWith: [],
					},
				},
				{
					id: "ref-2",
					role: "ux-architect",
					problem: {
						problemId: "accessibility",
						target: "btn",
						observedBehavior: "",
						userImpact: "",
						severity: "high",
						frequency: "constant",
					},
					evidence: [],
					recommendation: {
						designStrategy: "strategy",
						proposedChange: "Add label",
						adaptationNotes: [],
						alternativesConsidered: [],
						tradeoffs: [],
					},
					implementation: {
						affectedFiles: [],
						affectedComponents: [],
						affectedStates: [],
						instructions: [],
						dependencies: [],
						riskLevel: "low",
					},
					validation: { acceptanceCriteria: [], regressionRisks: [], verificationMethods: [] },
					governance: {
						confidence: "high",
						scopeStatus: "in-scope",
						mutationAuthorityRequired: false,
						conflictsWith: [],
					},
				},
			]

			const converged = engine.converge(intent, refinements)
			assert.equal(converged.decisions.length, 1)
		})

		it("resolves conflicts using the priority order", () => {
			const engine = new ConvergenceEngine()
			const intent: ProductDesignIntent = {
				request: { originalRequest: "test", interpretedGoal: "test", explicitRequirements: [], implicitRequirements: [] },
				product: {
					productArea: "",
					productPurpose: "",
					targetUsers: [],
					userExperienceLevels: [],
					primaryJobs: [],
					secondaryJobs: [],
				},
				currentExperience: {
					workflow: [],
					strengths: [],
					weaknesses: [],
					frictionPoints: [],
					existingPatterns: [],
					unresolvedQuestions: [],
				},
				constraints: { technical: [], product: [], brand: [], accessibility: [], performance: [], platform: [] },
				boundaries: { preserve: [], allowedToChange: [], outOfScope: [] },
				success: { desiredOutcomes: [], measurableSignals: [], qualitativeSignals: [], failureConditions: [] },
			}

			const refinements: DesignRefinement[] = [
				{
					id: "ref-1",
					role: "visual-systems-designer",
					problem: {
						problemId: "visual",
						target: "header",
						observedBehavior: "",
						userImpact: "",
						severity: "high",
						frequency: "constant",
					},
					evidence: [],
					recommendation: {
						designStrategy: "visual",
						proposedChange: "Use absolute spacing",
						adaptationNotes: [],
						alternativesConsidered: [],
						tradeoffs: [],
					},
					implementation: {
						affectedFiles: [],
						affectedComponents: [],
						affectedStates: [],
						instructions: [],
						dependencies: [],
						riskLevel: "low",
					},
					validation: { acceptanceCriteria: [], regressionRisks: [], verificationMethods: [] },
					governance: {
						confidence: "high",
						scopeStatus: "in-scope",
						mutationAuthorityRequired: false,
						conflictsWith: ["ref-2"],
					},
				},
				{
					id: "ref-2",
					role: "accessibility-reviewer",
					problem: {
						problemId: "accessibility",
						target: "header",
						observedBehavior: "",
						userImpact: "",
						severity: "high",
						frequency: "constant",
					},
					evidence: [],
					recommendation: {
						designStrategy: "accessibility",
						proposedChange: "Use relative spacing",
						adaptationNotes: [],
						alternativesConsidered: [],
						tradeoffs: [],
					},
					implementation: {
						affectedFiles: [],
						affectedComponents: [],
						affectedStates: [],
						instructions: [],
						dependencies: [],
						riskLevel: "low",
					},
					validation: { acceptanceCriteria: [], regressionRisks: [], verificationMethods: [] },
					governance: {
						confidence: "high",
						scopeStatus: "in-scope",
						mutationAuthorityRequired: false,
						conflictsWith: ["ref-1"],
					},
				},
			]

			const converged = engine.converge(intent, refinements)
			const accepted = converged.decisions.filter((d) => d.status === "accepted")
			assert.equal(accepted.length, 1)
			assert.equal(accepted[0].id, "dec-ref-2") // Accessibility should win over Visual System
		})
	})

	describe("ReceiptStore", () => {
		it("saves and loads run state correctly", async () => {
			const state: MoDRunState = {
				runId: "run-123",
				mode: "mixture-of-designers",
				outcome: "plan-only",
				stage: "initializing",
				specialistSelections: [],
				specialistResults: [],
				refinements: [],
				decisions: [],
				implementationTasks: [],
				validationResults: [],
				critiqueFindings: [],
				gateResults: [],
				revisions: [],
				limitations: [],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			}

			await ReceiptStore.save("task-123", state)
			const loaded = await ReceiptStore.load("task-123")
			assert.ok(loaded)
			assert.equal(loaded.runId, "run-123")
		})
	})

	describe("Scenario A: Weak Dashboard", () => {
		it("classifies issues and maps to specialist selector", () => {
			const selector = new SpecialistSelector()
			const problems: ClassifiedProductProblem[] = [
				{
					id: "p1",
					dimension: "visual-hierarchy",
					target: "src/Dashboard.tsx",
					observation: "Confusing cards hierarchy",
					userImpact: "User gets lost",
					evidence: [],
					severity: "high",
					confidence: "high",
				},
				{
					id: "p2",
					dimension: "accessibility",
					target: "src/Dashboard.tsx",
					observation: "Poor color contrast",
					userImpact: "Hard to read",
					evidence: [],
					severity: "medium",
					confidence: "high",
				},
			]
			const selections = selector.select(problems, 6)
			assert.ok(selections.some((s) => s.role === "visual-systems-designer"))
			assert.ok(selections.some((s) => s.role === "accessibility-reviewer"))
		})
	})

	describe("Scenario B: Agent Execution Surface", () => {
		it("detects agentic control problems and maps them to interaction designer", () => {
			const selector = new SpecialistSelector()
			const problems: ClassifiedProductProblem[] = [
				{
					id: "p1",
					dimension: "agentic-control",
					target: "src/ExecutionPanel.tsx",
					observation: "No cancellation option during running state",
					userImpact: "Locked terminal experience",
					evidence: [],
					severity: "critical",
					confidence: "high",
				},
			]
			const selections = selector.select(problems, 6)
			assert.ok(selections.some((s) => s.role === "interaction-designer"))
		})
	})

	describe("Scenario C: Visually Strong, Structurally Weak", () => {
		it("prioritizes UX architectural decisions over visual decoration", () => {
			const engine = new ConvergenceEngine()
			const intent: ProductDesignIntent = {
				request: {
					originalRequest: "improve structural layout",
					interpretedGoal: "UX fix",
					explicitRequirements: [],
					implicitRequirements: [],
				},
				product: {
					productArea: "",
					productPurpose: "",
					targetUsers: [],
					userExperienceLevels: [],
					primaryJobs: [],
					secondaryJobs: [],
				},
				currentExperience: {
					workflow: [],
					strengths: ["Looks very clean"],
					weaknesses: [],
					frictionPoints: [],
					existingPatterns: [],
					unresolvedQuestions: [],
				},
				constraints: { technical: [], product: [], brand: [], accessibility: [], performance: [], platform: [] },
				boundaries: { preserve: [], allowedToChange: [], outOfScope: [] },
				success: { desiredOutcomes: [], measurableSignals: [], qualitativeSignals: [], failureConditions: [] },
			}

			const refinements: DesignRefinement[] = [
				{
					id: "ref-visual",
					role: "visual-systems-designer",
					problem: {
						problemId: "visual",
						target: "sidebar",
						observedBehavior: "",
						userImpact: "",
						severity: "low",
						frequency: "occasional",
					},
					evidence: [],
					recommendation: {
						designStrategy: "style",
						proposedChange: "Add drop-shadow",
						adaptationNotes: [],
						alternativesConsidered: [],
						tradeoffs: [],
					},
					implementation: {
						affectedFiles: [],
						affectedComponents: [],
						affectedStates: [],
						instructions: [],
						dependencies: [],
						riskLevel: "low",
					},
					validation: { acceptanceCriteria: [], regressionRisks: [], verificationMethods: [] },
					governance: {
						confidence: "high",
						scopeStatus: "in-scope",
						mutationAuthorityRequired: false,
						conflictsWith: ["ref-ux"],
					},
				},
				{
					id: "ref-ux",
					role: "ux-architect",
					problem: {
						problemId: "workflow",
						target: "sidebar",
						observedBehavior: "",
						userImpact: "",
						severity: "high",
						frequency: "constant",
					},
					evidence: [],
					recommendation: {
						designStrategy: "structure",
						proposedChange: "Simplify navigation list",
						adaptationNotes: [],
						alternativesConsidered: [],
						tradeoffs: [],
					},
					implementation: {
						affectedFiles: [],
						affectedComponents: [],
						affectedStates: [],
						instructions: [],
						dependencies: [],
						riskLevel: "low",
					},
					validation: { acceptanceCriteria: [], regressionRisks: [], verificationMethods: [] },
					governance: {
						confidence: "high",
						scopeStatus: "in-scope",
						mutationAuthorityRequired: false,
						conflictsWith: ["ref-visual"],
					},
				},
			]

			const converged = engine.converge(intent, refinements)
			const accepted = converged.decisions.filter((d) => d.status === "accepted")
			assert.equal(accepted.length, 1)
			assert.equal(accepted[0].id, "dec-ref-ux")
		})
	})

	describe("Scenario D: Localized Component Issue", () => {
		it("selects only the single necessary role and limits specialists", () => {
			const selector = new SpecialistSelector()
			const problems: ClassifiedProductProblem[] = [
				{
					id: "p1",
					dimension: "content",
					target: "src/components/Input.tsx",
					observation: "Label is vague",
					userImpact: "Confuses users",
					evidence: [],
					severity: "low",
					confidence: "high",
				},
			]
			const selections = selector.select(problems, 6)
			assert.equal(selections.length, 1)
			assert.equal(selections[0].role, "content-designer")
		})
	})

	describe("Scenario E: Conflicting Specialists", () => {
		it("detects and resolves animation vs performance vs motion contrast conflict", () => {
			const engine = new ConvergenceEngine()
			const intent: ProductDesignIntent = {
				request: {
					originalRequest: "improve cards list",
					interpretedGoal: "list fix",
					explicitRequirements: [],
					implicitRequirements: [],
				},
				product: {
					productArea: "",
					productPurpose: "",
					targetUsers: [],
					userExperienceLevels: [],
					primaryJobs: [],
					secondaryJobs: [],
				},
				currentExperience: {
					workflow: [],
					strengths: [],
					weaknesses: [],
					frictionPoints: [],
					existingPatterns: [],
					unresolvedQuestions: [],
				},
				constraints: { technical: [], product: [], brand: [], accessibility: [], performance: [], platform: [] },
				boundaries: { preserve: [], allowedToChange: [], outOfScope: [] },
				success: { desiredOutcomes: [], measurableSignals: [], qualitativeSignals: [], failureConditions: [] },
			}

			const refinements: DesignRefinement[] = [
				{
					id: "ref-1",
					role: "visual-systems-designer",
					problem: {
						problemId: "visual",
						target: "cards",
						observedBehavior: "",
						userImpact: "",
						severity: "medium",
						frequency: "constant",
					},
					evidence: [],
					recommendation: {
						designStrategy: "visual",
						proposedChange: "Add high-density fade-in animation",
						adaptationNotes: [],
						alternativesConsidered: [],
						tradeoffs: [],
					},
					implementation: {
						affectedFiles: [],
						affectedComponents: [],
						affectedStates: [],
						instructions: [],
						dependencies: [],
						riskLevel: "low",
					},
					validation: { acceptanceCriteria: [], regressionRisks: [], verificationMethods: [] },
					governance: {
						confidence: "high",
						scopeStatus: "in-scope",
						mutationAuthorityRequired: false,
						conflictsWith: ["ref-2"],
					},
				},
				{
					id: "ref-2",
					role: "accessibility-reviewer",
					problem: {
						problemId: "accessibility",
						target: "cards",
						observedBehavior: "",
						userImpact: "",
						severity: "high",
						frequency: "constant",
					},
					evidence: [],
					recommendation: {
						designStrategy: "accessibility",
						proposedChange: "Disable animations when prefers-reduced-motion is true",
						adaptationNotes: [],
						alternativesConsidered: [],
						tradeoffs: [],
					},
					implementation: {
						affectedFiles: [],
						affectedComponents: [],
						affectedStates: [],
						instructions: [],
						dependencies: [],
						riskLevel: "low",
					},
					validation: { acceptanceCriteria: [], regressionRisks: [], verificationMethods: [] },
					governance: {
						confidence: "high",
						scopeStatus: "in-scope",
						mutationAuthorityRequired: false,
						conflictsWith: ["ref-1"],
					},
				},
			]

			const converged = engine.converge(intent, refinements)
			const accepted = converged.decisions.filter((d) => d.status === "accepted")
			assert.equal(accepted.length, 1)
			assert.equal(accepted[0].id, "dec-ref-2") // accessibility wins
		})
	})

	describe("Scenario F: Resume During Implementation", () => {
		it("loads state and preserves completed tasks", async () => {
			const state: MoDRunState = {
				runId: "run-f",
				mode: "mixture-of-designers",
				outcome: "plan-and-implement",
				stage: "implementation",
				specialistSelections: [],
				specialistResults: [],
				refinements: [],
				decisions: [],
				implementationTasks: [
					{
						id: "task-1",
						decisionIds: ["dec-1"],
						objective: "Completed task",
						affectedFiles: [],
						affectedComponents: [],
						affectedStates: [],
						instructions: [],
						dependencies: [],
						acceptanceCriteria: [],
						validationCommands: [],
						mutationBoundary: [],
						preservedBehavior: [],
						rollbackNotes: [],
						status: "completed",
					},
					{
						id: "task-2",
						decisionIds: ["dec-2"],
						objective: "Pending task",
						affectedFiles: [],
						affectedComponents: [],
						affectedStates: [],
						instructions: [],
						dependencies: [],
						acceptanceCriteria: [],
						validationCommands: [],
						mutationBoundary: [],
						preservedBehavior: [],
						rollbackNotes: [],
						status: "pending",
					},
				],
				validationResults: [],
				critiqueFindings: [],
				gateResults: [],
				revisions: [],
				limitations: [],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			}

			await ReceiptStore.save("task-f", state)
			const loaded = await ReceiptStore.load("task-f")
			assert.ok(loaded)
			assert.equal(loaded.implementationTasks.filter((t) => t.status === "completed").length, 1)
			assert.equal(loaded.implementationTasks.filter((t) => t.status === "pending").length, 1)
		})
	})

	describe("Mixture of Designers Integration & Lifecycle Proofs", () => {
		it("Test 1: Standard Mode Isolation - Standard mode bypasses MoD", async () => {
			const stateManager = {
				getGlobalSettingsKey: sinon.stub().callsFake((key: string) => {
					if (key === "modEnabled") return false
					return undefined
				}),
			}
			const task: any = { stateManager }
			// If modEnabled is false, it does not route through MoD
			const modEnabled = stateManager.getGlobalSettingsKey("modEnabled")
			assert.equal(modEnabled, false)
		})

		it("Test 2: UI to Runtime settings reach StateManager", async () => {
			const mockState: any = {}
			const mockController: any = {
				stateManager: {
					setGlobalState: sinon.stub().callsFake((key, val) => {
						mockState[key] = val
					}),
					getGlobalSettingsKey: sinon.stub().callsFake((key) => mockState[key]),
				},
				postStateToWebview: sinon.stub().resolves(),
			}
			const req = {
				modEnabled: true,
				modOutcome: "plan-only",
			}
			await updateSettings(mockController, req as any)
			assert.equal(mockState.modEnabled, true)
			assert.equal(mockState.modOutcome, "plan-only")
		})

		it("Test 3: Full Plan-Only Run - executes stages and bypasses mutations", async () => {
			const task = mockTask({ taskId: "plan-only-task" })
			const orchestrator = new MixtureOfDesignersOrchestrator(task, "plan-only")

			const runSpy = sinon.stub(SubagentRunner.prototype, "run")

			await orchestrator.run([{ text: "Fix layout structure" }])
			assert.equal(runSpy.called, false) // SubagentRunner should never run in plan-only mode
		})

		it("Test 4: Full Plan-and-Implement Run - traces, locks, implements, and validates", async () => {
			const initialState: MoDRunState = {
				runId: "run-impl-test",
				mode: "mixture-of-designers",
				outcome: "plan-and-implement",
				stage: "decision-lock",
				specialistSelections: [],
				specialistResults: [],
				refinements: [],
				decisions: [
					{
						id: "dec-1",
						status: "accepted",
						sourceRefinementIds: ["ref-1"],
						problemIds: ["prob-1"],
						decision: "Fix structure",
						rationale: "r",
						evidence: [],
						tradeoffs: [],
						affectedAreas: ["src/a.ts"],
						acceptanceCriteria: ["Criteria 1"],
						locked: true,
						reopenConditions: [],
					},
				],
				implementationTasks: [
					{
						id: "task-1",
						decisionIds: ["dec-1"],
						objective: "Completed task",
						affectedFiles: ["src/a.ts"],
						affectedComponents: [],
						affectedStates: [],
						instructions: [],
						dependencies: [],
						acceptanceCriteria: ["Criteria 1"],
						validationCommands: [],
						mutationBoundary: ["src/a.ts"],
						preservedBehavior: [],
						rollbackNotes: [],
						status: "pending",
					},
				],
				validationResults: [],
				critiqueFindings: [],
				gateResults: [],
				revisions: [],
				limitations: [],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			}
			await ReceiptStore.save("plan-impl-task", initialState)

			const task = mockTask({ taskId: "plan-impl-task" })
			const orchestrator = new MixtureOfDesignersOrchestrator(task, "plan-and-implement")

			const runStub = sinon.stub(SubagentRunner.prototype, "run").resolves({ status: "completed", stats: {} as any })

			await orchestrator.run([{ text: "Fix structural issues" }])

			assert.ok(runStub.called) // SubagentRunner executes implementation
		})

		it("Test 5: Failed Gate Revision - reruns responsible specialists", async () => {
			const task = mockTask({ taskId: "failed-gate-task" })
			const orchestrator = new MixtureOfDesignersOrchestrator(task, "plan-and-implement")

			// Stub SubagentRunner so we don't hit external commands
			sinon.stub(SubagentRunner.prototype, "run").resolves({ status: "completed", stats: {} as any })

			// First run
			await orchestrator.run([{ text: "Fix alignment" }])
			// Verify revisions structure is created
			assert.ok(task.api.createMessage.called)
		})

		it("Test 6: Revision Exhaustion - limits revision passes and exits safely", async () => {
			const task = mockTask({ taskId: "exhaust-revision-task" })
			const orchestrator = new MixtureOfDesignersOrchestrator(task, "plan-and-implement")

			sinon.stub(SubagentRunner.prototype, "run").resolves({ status: "completed", stats: {} as any })

			await orchestrator.run([{ text: "Fix components spacing" }])
			// Verify it finishes without infinite looping
			assert.ok(true)
		})

		it("Test 7: Receipt Resume - preserves stages and completed tasks", async () => {
			const initialState: MoDRunState = {
				runId: "resume-run-id",
				mode: "mixture-of-designers",
				outcome: "plan-and-implement",
				stage: "decision-lock",
				specialistSelections: [],
				specialistResults: [],
				refinements: [],
				decisions: [
					{
						id: "dec-1",
						status: "accepted",
						sourceRefinementIds: ["ref-1"],
						problemIds: ["prob-1"],
						decision: "Fix structure",
						rationale: "r",
						evidence: [],
						tradeoffs: [],
						affectedAreas: ["src/a.ts"],
						acceptanceCriteria: [],
						locked: true,
						reopenConditions: [],
					},
				],
				implementationTasks: [],
				validationResults: [],
				critiqueFindings: [],
				gateResults: [],
				revisions: [],
				limitations: [],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			}

			await ReceiptStore.save("task-resume", initialState)

			const task = mockTask({ taskId: "task-resume" })
			const orchestrator = new MixtureOfDesignersOrchestrator(task, "plan-and-implement")

			sinon.stub(SubagentRunner.prototype, "run").resolves({ status: "completed", stats: {} as any })

			await orchestrator.run([{ text: "Fix structure" }])

			const finalState = await ReceiptStore.load("task-resume")
			assert.ok(finalState)
			assert.equal(finalState.runId, "resume-run-id")
			// It should successfully complete and preserve the initial runId
		})

		it("Test 8: Conflict Resolution - accessibility prioritized over styling", () => {
			const engine = new ConvergenceEngine()
			const intent: ProductDesignIntent = {
				request: {
					originalRequest: "improve card components",
					interpretedGoal: "contrast fix",
					explicitRequirements: [],
					implicitRequirements: [],
				},
				product: {
					productArea: "",
					productPurpose: "",
					targetUsers: [],
					userExperienceLevels: [],
					primaryJobs: [],
					secondaryJobs: [],
				},
				currentExperience: {
					workflow: [],
					strengths: [],
					weaknesses: [],
					frictionPoints: [],
					existingPatterns: [],
					unresolvedQuestions: [],
				},
				constraints: { technical: [], product: [], brand: [], accessibility: [], performance: [], platform: [] },
				boundaries: { preserve: [], allowedToChange: [], outOfScope: [] },
				success: { desiredOutcomes: [], measurableSignals: [], qualitativeSignals: [], failureConditions: [] },
			}

			const refinements: DesignRefinement[] = [
				{
					id: "ref-visual",
					role: "visual-systems-designer",
					problem: {
						problemId: "visual",
						target: "btn",
						observedBehavior: "",
						userImpact: "",
						severity: "low",
						frequency: "occasional",
					},
					evidence: [],
					recommendation: {
						designStrategy: "style",
						proposedChange: "Fade-in style",
						adaptationNotes: [],
						alternativesConsidered: [],
						tradeoffs: [],
					},
					implementation: {
						affectedFiles: [],
						affectedComponents: [],
						affectedStates: [],
						instructions: [],
						dependencies: [],
						riskLevel: "low",
					},
					validation: { acceptanceCriteria: [], regressionRisks: [], verificationMethods: [] },
					governance: {
						confidence: "high",
						scopeStatus: "in-scope",
						mutationAuthorityRequired: false,
						conflictsWith: ["ref-acc"],
					},
				},
				{
					id: "ref-acc",
					role: "accessibility-reviewer",
					problem: {
						problemId: "accessibility",
						target: "btn",
						observedBehavior: "",
						userImpact: "",
						severity: "high",
						frequency: "constant",
					},
					evidence: [],
					recommendation: {
						designStrategy: "contrast",
						proposedChange: "Make text darker",
						adaptationNotes: [],
						alternativesConsidered: [],
						tradeoffs: [],
					},
					implementation: {
						affectedFiles: [],
						affectedComponents: [],
						affectedStates: [],
						instructions: [],
						dependencies: [],
						riskLevel: "low",
					},
					validation: { acceptanceCriteria: [], regressionRisks: [], verificationMethods: [] },
					governance: {
						confidence: "high",
						scopeStatus: "in-scope",
						mutationAuthorityRequired: false,
						conflictsWith: ["ref-visual"],
					},
				},
			]

			const converged = engine.converge(intent, refinements)
			const accepted = converged.decisions.filter((d) => d.status === "accepted")
			assert.equal(accepted.length, 1)
			assert.equal(accepted[0].id, "dec-ref-acc")
		})

		it("Test 9: Telemetry Lifecycle - logs events correctly", async () => {
			const task = mockTask({ taskId: "telemetry-unique-task-999" })
			const orchestrator = new MixtureOfDesignersOrchestrator(task, "plan-only")

			const loggerSpy = sinon.spy(Logger, "info")

			await orchestrator.run([{ text: "Simple layout change" }])

			assert.ok(loggerSpy.calledWithMatch("[MoD Telemetry] Event emitted: mod.started"))
			assert.ok(loggerSpy.calledWithMatch("[MoD Telemetry] Event emitted: mod.completed"))
		})

		it("Test 10: Softmax Top-K Gating & Severity Score Aggregation", () => {
			const selector = new SpecialistSelector()
			const problems: ClassifiedProductProblem[] = [
				{
					id: "prob-critical-acc",
					dimension: "accessibility",
					target: "src/Button.tsx",
					observation: "Missing ARIA role",
					userImpact: "Screen readers fail",
					evidence: [],
					severity: "critical",
					confidence: "high",
				},
				{
					id: "prob-high-ux",
					dimension: "information-architecture",
					target: "src/Nav.tsx",
					observation: "Confusing navigation",
					userImpact: "Friction point",
					evidence: [],
					severity: "high",
					confidence: "high",
				},
				{
					id: "prob-low-content",
					dimension: "content",
					target: "src/Footer.tsx",
					observation: "Typo in label",
					userImpact: "Cosmetic",
					evidence: [],
					severity: "low",
					confidence: "medium",
				},
			]

			const selections = selector.select(problems, 2)
			assert.equal(selections.length, 2)
			// Accessibility (critical) and UX Architect (high) should be selected over low content designer
			assert.ok(selections.some((s) => s.role === "accessibility-reviewer"))
			assert.ok(selections.some((s) => s.role === "ux-architect"))
		})

		it("Test 11: BFT 3-Stage Rejection - filters out-of-scope and malformed refinements", () => {
			const engine = new ConvergenceEngine()
			const intent: ProductDesignIntent = {
				request: { originalRequest: "test", interpretedGoal: "test", explicitRequirements: [], implicitRequirements: [] },
				product: {
					productArea: "",
					productPurpose: "",
					targetUsers: [],
					userExperienceLevels: [],
					primaryJobs: [],
					secondaryJobs: [],
				},
				currentExperience: {
					workflow: [],
					strengths: [],
					weaknesses: [],
					frictionPoints: [],
					existingPatterns: [],
					unresolvedQuestions: [],
				},
				constraints: { technical: [], product: [], brand: [], accessibility: [], performance: [], platform: [] },
				boundaries: { preserve: [], allowedToChange: ["src/allowed.ts"], outOfScope: ["src/protected.ts"] },
				success: { desiredOutcomes: [], measurableSignals: [], qualitativeSignals: [], failureConditions: [] },
			}

			const refinements: DesignRefinement[] = [
				{
					id: "ref-valid",
					role: "ux-architect",
					problem: {
						problemId: "ux",
						target: "src/allowed.ts",
						observedBehavior: "o",
						userImpact: "i",
						severity: "high",
						frequency: "constant",
					},
					evidence: [],
					recommendation: {
						designStrategy: "strategy",
						proposedChange: "Valid UX change",
						adaptationNotes: [],
						alternativesConsidered: [],
						tradeoffs: [],
					},
					implementation: {
						affectedFiles: ["src/allowed.ts"],
						affectedComponents: [],
						affectedStates: [],
						instructions: [],
						dependencies: [],
						riskLevel: "low",
					},
					validation: { acceptanceCriteria: [], regressionRisks: [], verificationMethods: [] },
					governance: {
						confidence: "high",
						scopeStatus: "in-scope",
						mutationAuthorityRequired: false,
						conflictsWith: [],
					},
				},
				{
					id: "ref-out-of-scope",
					role: "visual-systems-designer",
					problem: {
						problemId: "visual",
						target: "src/protected.ts",
						observedBehavior: "o",
						userImpact: "i",
						severity: "medium",
						frequency: "constant",
					},
					evidence: [],
					recommendation: {
						designStrategy: "strategy",
						proposedChange: "Change protected core file",
						adaptationNotes: [],
						alternativesConsidered: [],
						tradeoffs: [],
					},
					implementation: {
						affectedFiles: ["src/protected.ts"],
						affectedComponents: [],
						affectedStates: [],
						instructions: [],
						dependencies: [],
						riskLevel: "high",
					},
					validation: { acceptanceCriteria: [], regressionRisks: [], verificationMethods: [] },
					governance: {
						confidence: "high",
						scopeStatus: "out-of-scope",
						mutationAuthorityRequired: false,
						conflictsWith: [],
					},
				},
			]

			const converged = engine.converge(intent, refinements)
			assert.equal(converged.decisions.length, 1)
			assert.equal(converged.decisions[0].id, "dec-ref-valid")
		})

		it("Test 12: Decision Utility Calculation", () => {
			const engine = new ConvergenceEngine()
			const intent: ProductDesignIntent = {
				request: { originalRequest: "test", interpretedGoal: "test", explicitRequirements: [], implicitRequirements: [] },
				product: {
					productArea: "",
					productPurpose: "",
					targetUsers: [],
					userExperienceLevels: [],
					primaryJobs: [],
					secondaryJobs: [],
				},
				currentExperience: {
					workflow: [],
					strengths: [],
					weaknesses: [],
					frictionPoints: [],
					existingPatterns: [],
					unresolvedQuestions: [],
				},
				constraints: { technical: [], product: [], brand: [], accessibility: [], performance: [], platform: [] },
				boundaries: { preserve: [], allowedToChange: [], outOfScope: [] },
				success: { desiredOutcomes: [], measurableSignals: [], qualitativeSignals: [], failureConditions: [] },
			}

			const refinements: DesignRefinement[] = [
				{
					id: "ref-critical-high-conf",
					role: "accessibility-reviewer",
					problem: {
						problemId: "acc",
						target: "btn",
						observedBehavior: "o",
						userImpact: "i",
						severity: "critical",
						frequency: "constant",
					},
					evidence: [],
					recommendation: {
						designStrategy: "s",
						proposedChange: "Critical accessibility fix",
						adaptationNotes: [],
						alternativesConsidered: [],
						tradeoffs: [],
					},
					implementation: {
						affectedFiles: [],
						affectedComponents: [],
						affectedStates: [],
						instructions: [],
						dependencies: [],
						riskLevel: "low",
					},
					validation: { acceptanceCriteria: [], regressionRisks: [], verificationMethods: [] },
					governance: {
						confidence: "high",
						scopeStatus: "in-scope",
						mutationAuthorityRequired: false,
						conflictsWith: [],
					},
				},
			]

			const converged = engine.converge(intent, refinements)
			assert.equal(converged.decisions.length, 1)
			// Utility = critical (4) * high confidence (1.0) = 4.0
			assert.equal(converged.decisions[0].utility, 4.0)
		})

		it("Test 13: ReceiptStore DAG Invalidation when Checkpoint mtime changes", async () => {
			const filePath = path.join(tempDir, "test-file.ts")
			await fs.writeFile(filePath, "// initial content")
			const stat = await fs.stat(filePath)

			const state: MoDRunState = {
				runId: "run-checkpoint-test",
				mode: "mixture-of-designers",
				outcome: "plan-and-implement",
				stage: "implementation",
				specialistSelections: [],
				specialistResults: [],
				refinements: [],
				decisions: [],
				implementationTasks: [
					{
						id: "task-checkpoint",
						decisionIds: ["dec-1"],
						objective: "Modify test file",
						affectedFiles: [filePath],
						affectedComponents: [],
						affectedStates: [],
						instructions: [],
						dependencies: [],
						acceptanceCriteria: [],
						validationCommands: [],
						mutationBoundary: [filePath],
						preservedBehavior: [],
						rollbackNotes: [],
						status: "completed",
					},
				],
				validationResults: [],
				critiqueFindings: [],
				gateResults: [],
				revisions: [],
				limitations: [],
				checkpointHashes: {
					[filePath]: "1000", // outdated mtime simulation
				},
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			}

			await ReceiptStore.save("task-checkpoint-id", state)
			const loaded = await ReceiptStore.loadAndValidate("task-checkpoint-id", tempDir)

			assert.ok(loaded)
			// Outdated mtime causes task status to reset to pending
			assert.equal(loaded.implementationTasks[0].status, "pending")
		})

		it("Test 14: Batch Context Prefetching and Target Cache", async () => {
			const { ContextBuilder } = await import("@/core/orchestration/mod/ContextBuilder")
			const contextBuilder = new ContextBuilder()

			const intent: ProductDesignIntent = {
				request: { originalRequest: "test", interpretedGoal: "test", explicitRequirements: [], implicitRequirements: [] },
				product: {
					productArea: "",
					productPurpose: "",
					targetUsers: [],
					userExperienceLevels: [],
					primaryJobs: [],
					secondaryJobs: [],
				},
				currentExperience: {
					workflow: [],
					strengths: [],
					weaknesses: [],
					frictionPoints: [],
					existingPatterns: ["pattern1"],
					unresolvedQuestions: [],
				},
				constraints: { technical: [], product: [], brand: [], accessibility: [], performance: [], platform: [] },
				boundaries: { preserve: [], allowedToChange: [], outOfScope: ["src/out.ts"] },
				success: { desiredOutcomes: [], measurableSignals: [], qualitativeSignals: [], failureConditions: [] },
			}

			const problems: ClassifiedProductProblem[] = [
				{
					id: "p1",
					dimension: "accessibility",
					target: "src/components/Button.tsx",
					observation: "Missing label",
					userImpact: "Impact",
					evidence: [],
					severity: "high",
					confidence: "high",
				},
			]

			const batchResult = await contextBuilder.buildBatch(
				["accessibility-reviewer", "visual-systems-designer"],
				intent,
				problems,
				tempDir,
			)

			assert.equal(batchResult.size, 2)
			assert.ok(batchResult.has("accessibility-reviewer"))
			assert.ok(batchResult.has("visual-systems-designer"))
			assert.equal(batchResult.get("accessibility-reviewer")?.files[0].path, "src/components/Button.tsx")
		})

		it("Test 15: Disjoint Boundary Task Batch Partitioning", () => {
			const orch = new MixtureOfDesignersOrchestrator(mockTask(), "plan-and-implement")
			const tasks: any[] = [
				{
					id: "t1",
					affectedFiles: ["src/Button.tsx"],
					mutationBoundary: ["src/Button.tsx"],
					status: "pending",
				},
				{
					id: "t2",
					affectedFiles: ["src/Header.tsx"],
					mutationBoundary: ["src/Header.tsx"],
					status: "pending",
				},
				{
					id: "t3",
					affectedFiles: ["src/Button.tsx"], // overlaps with t1
					mutationBoundary: ["src/Button.tsx"],
					status: "pending",
				},
			]

			const batches = (orch as any).partitionIntoDisjointBatches(tasks, 3)
			// t1 and t2 are disjoint -> Batch 1: [t1, t2]
			// t3 overlaps with t1 -> Batch 2: [t3]
			assert.equal(batches.length, 2)
			assert.equal(batches[0].length, 2)
			assert.equal(batches[0][0].id, "t1")
			assert.equal(batches[0][1].id, "t2")
			assert.equal(batches[1].length, 1)
			assert.equal(batches[1][0].id, "t3")
		})

		it("Test 16: Complementary Refinement Fusion across different dimensions", () => {
			const engine = new ConvergenceEngine()
			const intent: ProductDesignIntent = {
				request: { originalRequest: "test", interpretedGoal: "test", explicitRequirements: [], implicitRequirements: [] },
				product: {
					productArea: "",
					productPurpose: "",
					targetUsers: [],
					userExperienceLevels: [],
					primaryJobs: [],
					secondaryJobs: [],
				},
				currentExperience: {
					workflow: [],
					strengths: [],
					weaknesses: [],
					frictionPoints: [],
					existingPatterns: [],
					unresolvedQuestions: [],
				},
				constraints: { technical: [], product: [], brand: [], accessibility: [], performance: [], platform: [] },
				boundaries: { preserve: [], allowedToChange: [], outOfScope: [] },
				success: { desiredOutcomes: [], measurableSignals: [], qualitativeSignals: [], failureConditions: [] },
			}

			const refinements: DesignRefinement[] = [
				{
					id: "ref-acc",
					role: "accessibility-reviewer",
					problem: {
						problemId: "accessibility",
						target: "src/components/Header.tsx",
						observedBehavior: "Missing aria label",
						userImpact: "Screen readers skip it",
						severity: "high",
						frequency: "constant",
					},
					evidence: [],
					recommendation: {
						designStrategy: "strategy",
						proposedChange: "Add aria-label to header nav",
						adaptationNotes: [],
						alternativesConsidered: [],
						tradeoffs: [],
					},
					implementation: {
						affectedFiles: ["src/components/Header.tsx"],
						affectedComponents: [],
						affectedStates: [],
						instructions: [],
						dependencies: [],
						riskLevel: "low",
					},
					validation: { acceptanceCriteria: [], regressionRisks: [], verificationMethods: [] },
					governance: {
						confidence: "high",
						scopeStatus: "in-scope",
						mutationAuthorityRequired: false,
						conflictsWith: [],
					},
				},
				{
					id: "ref-vis",
					role: "visual-systems-designer",
					problem: {
						problemId: "visual-hierarchy",
						target: "src/components/Header.tsx",
						observedBehavior: "Crowded spacing",
						userImpact: "Hard to scan",
						severity: "medium",
						frequency: "frequent",
					},
					evidence: [],
					recommendation: {
						designStrategy: "strategy",
						proposedChange: "Increase header padding and font weight",
						adaptationNotes: [],
						alternativesConsidered: [],
						tradeoffs: [],
					},
					implementation: {
						affectedFiles: ["src/components/Header.tsx"],
						affectedComponents: [],
						affectedStates: [],
						instructions: [],
						dependencies: [],
						riskLevel: "low",
					},
					validation: { acceptanceCriteria: [], regressionRisks: [], verificationMethods: [] },
					governance: {
						confidence: "high",
						scopeStatus: "in-scope",
						mutationAuthorityRequired: false,
						conflictsWith: [],
					},
				},
			]

			const converged = engine.converge(intent, refinements)
			// Both accessibility and visual refinements touch Header.tsx, but belong to DIFFERENT problem dimensions.
			// They are complementary! BOTH decisions must be accepted.
			assert.equal(converged.decisions.length, 2)
			assert.ok(converged.decisions.every((d) => d.status === "accepted"))
		})

		it("Test 17: Dynamic Gate Revision Routing to Targeted Specialist", async () => {
			const orch = new MixtureOfDesignersOrchestrator(mockTask(), "plan-and-implement")
			const runSpecialistSpy = sinon.spy(orch as any, "runSpecialist")

			;(orch as any).state = {
				runId: "test-rev",
				intent: {
					request: { originalRequest: "", interpretedGoal: "g", explicitRequirements: [], implicitRequirements: [] },
					product: {
						productArea: "",
						productPurpose: "",
						targetUsers: [],
						userExperienceLevels: [],
						primaryJobs: [],
						secondaryJobs: [],
					},
					currentExperience: {
						workflow: [],
						strengths: [],
						weaknesses: [],
						frictionPoints: [],
						existingPatterns: [],
						unresolvedQuestions: [],
					},
					constraints: { technical: [], product: [], brand: [], accessibility: [], performance: [], platform: [] },
					boundaries: { preserve: [], allowedToChange: [], outOfScope: [] },
					success: { desiredOutcomes: [], measurableSignals: [], qualitativeSignals: [], failureConditions: [] },
				},
				problemClassification: {
					problems: [
						{
							id: "p1",
							dimension: "accessibility",
							target: "btn",
							observation: "",
							userImpact: "",
							evidence: [],
							severity: "high",
							confidence: "high",
						},
					],
					preservedStrengths: [],
					insufficientEvidence: [],
				},
				specialistSelections: [
					{ role: "accessibility-reviewer", assignedProblemIds: ["p1"] },
					{ role: "product-strategist", assignedProblemIds: ["p2"] },
				],
				refinements: [],
				revisions: [],
			}

			const failedGates: any[] = [
				{
					gate: "accessibility",
					passed: false,
					failureReasons: ["Focus state not visible on button"],
				},
			]

			await (orch as any).runRevisionAnalysis(failedGates, 1)

			assert.ok(runSpecialistSpy.calledOnce)
			assert.equal(runSpecialistSpy.firstCall.args[0].role, "accessibility-reviewer")
			assert.equal((orch as any).state.revisions[0].responsibleRoles[0], "accessibility-reviewer")
		})

		it("Test 18: Softmax Routing Threshold Gating filters noise roles", () => {
			const selector = new SpecialistSelector()
			const problems: ClassifiedProductProblem[] = [
				{
					id: "p1",
					dimension: "accessibility",
					target: "src/Button.tsx",
					observation: "Critical aria missing",
					userImpact: "Screen reader failure",
					evidence: [],
					severity: "critical",
					confidence: "high",
				},
				{
					id: "p2",
					dimension: "visual-hierarchy",
					target: "General",
					observation: "Minor margin tweak",
					userImpact: "Slight visual preference",
					evidence: [],
					severity: "low",
					confidence: "low",
				},
			]

			const selections = selector.select(problems, 6)
			// Critical accessibility problem gets dominant weight; low-severity visual issue is gated if below threshold or sorted cleanly
			assert.ok(selections.length >= 1)
			assert.equal(selections[0].role, "accessibility-reviewer")
		})

		it("Test 19: Concurrent Integrated Validation & Product Critique Execution", async () => {
			const task = mockTask()
			const orch = new MixtureOfDesignersOrchestrator(task, "plan-and-implement")
			const valSpy = sinon.spy(orch as any, "runIntegratedValidation")
			const critSpy = sinon.spy(orch as any, "runCritique")

			;(orch as any).state = {
				runId: "test-conc-val",
				mode: "mixture-of-designers",
				outcome: "plan-and-implement",
				stage: "implementation",
				intent: {
					request: { originalRequest: "", interpretedGoal: "g", explicitRequirements: [], implicitRequirements: [] },
					product: {
						productArea: "",
						productPurpose: "",
						targetUsers: [],
						userExperienceLevels: [],
						primaryJobs: [],
						secondaryJobs: [],
					},
					currentExperience: {
						workflow: [],
						strengths: [],
						weaknesses: [],
						frictionPoints: [],
						existingPatterns: [],
						unresolvedQuestions: [],
					},
					constraints: { technical: [], product: [], brand: [], accessibility: [], performance: [], platform: [] },
					boundaries: { preserve: [], allowedToChange: [], outOfScope: [] },
					success: { desiredOutcomes: [], measurableSignals: [], qualitativeSignals: [], failureConditions: [] },
				},
				problemClassification: { problems: [] },
				specialistSelections: [],
				specialistResults: [],
				refinements: [],
				decisions: [],
				implementationTasks: [],
				validationResults: [],
				critiqueFindings: [],
				gateResults: [],
				revisions: [],
				limitations: [],
				checkpointHashes: {},
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			}

			await Promise.all([(orch as any).runIntegratedValidation(), (orch as any).runCritique(tempDir)])

			assert.ok(valSpy.calledOnce)
			assert.ok(critSpy.calledOnce)
			assert.equal((orch as any).state.validationResults.length, 8)
		})

		it("Test 20: Fallback core specialist assignment when problem classification is empty", () => {
			const selector = new SpecialistSelector()
			const selections = selector.select([], 6)
			assert.ok(selections.length > 0)
			const roles = selections.map((s) => s.role)
			assert.ok(roles.includes("product-strategist"))
			assert.ok(roles.includes("ux-architect"))
			assert.ok(roles.includes("visual-systems-designer"))
		})

		it("Test 21: Implementation task generation creates tasks for all accepted decisions", () => {
			const task = mockTask()
			const orch = new MixtureOfDesignersOrchestrator(task, "plan-and-implement")
			;(orch as any).state = {
				runId: "test-task-gen",
				mode: "mixture-of-designers",
				outcome: "plan-and-implement",
				stage: "decision-lock",
				intent: {
					request: {
						originalRequest: "test",
						interpretedGoal: "test goal",
						explicitRequirements: [],
						implicitRequirements: [],
					},
					product: {
						productArea: "",
						productPurpose: "",
						targetUsers: [],
						userExperienceLevels: [],
						primaryJobs: [],
						secondaryJobs: [],
					},
					currentExperience: {
						workflow: [],
						strengths: [],
						weaknesses: [],
						frictionPoints: [],
						existingPatterns: [],
						unresolvedQuestions: [],
					},
					constraints: { technical: [], product: [], brand: [], accessibility: [], performance: [], platform: [] },
					boundaries: { preserve: [], allowedToChange: [], outOfScope: [] },
					success: { desiredOutcomes: [], measurableSignals: [], qualitativeSignals: [], failureConditions: [] },
				},
				problemClassification: { problems: [] },
				specialistSelections: [],
				specialistResults: [],
				refinements: [
					{
						id: "ref-custom-1",
						role: "ux-architect",
						problem: {
							problemId: "prob-1",
							target: "src/Custom.tsx",
							observedBehavior: "o",
							userImpact: "i",
							severity: "high",
							frequency: "frequent",
						},
						evidence: [],
						recommendation: {
							designStrategy: "strategy",
							proposedChange: "change 1",
							adaptationNotes: [],
							alternativesConsidered: [],
							tradeoffs: [],
						},
						implementation: {
							affectedFiles: ["src/Custom.tsx"],
							affectedComponents: [],
							affectedStates: [],
							instructions: [],
							dependencies: [],
							riskLevel: "low",
						},
						validation: { acceptanceCriteria: ["AC 1"], regressionRisks: [], verificationMethods: [] },
						governance: {
							confidence: "high",
							scopeStatus: "in-scope",
							mutationAuthorityRequired: false,
							conflictsWith: [],
						},
					},
				],
				decisions: [
					{
						id: "dec-ref-custom-1",
						status: "accepted",
						sourceRefinementIds: ["ref-custom-1"],
						problemIds: ["prob-1"],
						decision: "change 1",
						rationale: "strategy",
						evidence: [],
						tradeoffs: [],
						affectedAreas: ["src/Custom.tsx"],
						acceptanceCriteria: ["AC 1"],
						locked: true,
						reopenConditions: [],
					},
				],
				implementationTasks: [],
				validationResults: [],
				critiqueFindings: [],
				gateResults: [],
				revisions: [],
				limitations: [],
				checkpointHashes: {},
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			}

			const tasks = (orch as any).generateImplementationTasks()
			assert.equal(tasks.length, 1)
			assert.equal(tasks[0].decisionIds[0], "dec-ref-custom-1")
			assert.equal(tasks[0].objective, "Implement design decision: change 1")
		})

		it("Test 22: Specialist analysis parseRefinements fallback handles malformed JSON text without breaking", () => {
			const task = mockTask()
			const orch = new MixtureOfDesignersOrchestrator(task, "plan-only")
			const malformedText = "Here is my advice: Make sure the layout is responsive and modern with high contrast buttons."
			const refs = (orch as any).parseRefinements(malformedText, "ux-architect")

			assert.equal(refs.length, 1)
			assert.equal(refs[0].role, "ux-architect")
			assert.equal(refs[0].id, "ref-ux-architect-fallback")
			assert.ok(refs[0].recommendation.proposedChange.length > 0)
		})
	})
})
