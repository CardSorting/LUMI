# Mixture of Designers (MoD) v1.2: Design Philosophy
**Cognitive Specialization, Bounded Rationality, and Deterministic Governance in Autonomous Codebase Evolution**

---

## 1. Introduction
The execution of codebase mutations by autonomous AI agents has historically been treated as a translation problem: converting text instructions into syntactically valid code changes. While this paradigm suffices for isolated algorithm repair, it fails systematically when applied to complex multi-file product refactoring. Codebases are socio-technical artifacts; their designs are governed by implicit human expectations, design systems, visual hierarchies, usability workflows, and legal compliance mandates (e.g. accessibility).

The **Mixture of Designers (MoD)** paradigm is founded on the philosophy that **codebase mutations must be downstream effects of converged design plans**. Rather than allowing a single model to act as strategist, designer, architect, developer, and auditor simultaneously, MoD enforces a strict division of labor and separation of concerns.

---

## 2. Theoretical Foundations

### 2.1 Bounded Rationality & Cognitive Overload
Herbert Simon’s theory of **bounded rationality** posits that decision-makers are constrained by cognitive limitations, time, and information access. In LLMs, this manifests as prompt-context confusion and attention dilution. A single LLM attempting to implement a feature while concurrently optimizing for accessibility, performance, responsive reflow, and brand token usage will inevitably prioritize functional completion at the expense of design details.

MoD addresses this by routing the request to independent specialized personas. Each persona is assigned a strict cognitive boundary:
- An **Accessibility Reviewer** evaluates files *only* for screen reader compatibility, ARIA tags, and keyboard focus traps.
- A **Design System Engineer** evaluates files *only* for reuse of visual primitives and variables.

This focus alignment reduces the problem space for each model call, maximizing critical depth.

### 2.2 The Separation of Appraisal and Execution
In classical architecture and civil engineering, the party that designs and audits a structure is structurally distinct from the party that builds it. This separation prevents conflict of interest and guarantees independent inspection.

MoD implements this separation at the agent runtime level:
1. **Appraisal Phase (Read-Only)**: The Intent Analyzer, Problem Classifier, and Specialist Council evaluate the codebase. They identify anomalies, formulate strategies, and propose refinements. They have *zero* write access to the filesystem.
2. **Consensus Phase**: Recommendations are converged, conflicts resolved, and decisions locked by the parent orchestrator.
3. **Execution Phase (Write-Only)**: Developer subagents receive the locked decisions and carry out the mutations. They do not formulate design directions; they are executors bound by acceptance criteria.

This division ensures that design validation remains objective and unaffected by the developer subagent's local implementation shortcuts.

---

## 3. Priority-Based Consensus & Conflict Resolution
When multiple specialized agents appraise the same codebase, their recommendations will naturally clash. An Interaction Designer may suggest a custom drag-and-drop workflow that violates the Accessibility Reviewer's keyboard-only navigation standards, or a Visual Designer's font-scaling recommendations may conflict with a Responsive Design Reviewer's fluid viewport constraints.

In human organizations, these deadlocks are resolved through hierarchy or compromise. MoD formalizes this through a deterministic priority lattice:

$$\text{Product Strategy} \succ \text{Accessibility} \succ \text{UX Architecture} \succ \text{Design System Coherence} \succ \text{Technical Feasibility}$$

This hierarchy represents the following philosophical commitments:
- **User Safety & Inclusivity (Accessibility) are Non-Negotiable**: An aesthetic refinement that compromises keyboard-only navigation or color contrast is rejected.
- **Product Goals Over Decoration**: Style tweaks that do not serve the core product intent are superseded by architectural considerations.
- **Technical Feasibility is a Constraint, Not a Driver**: We do not compromise UX quality simply because implementing the proper flow is more complex. The developer subagent must adapt to the design, not vice versa.

---

## 4. Multi-Agent Debate vs. Unstructured Swarms
Many modern agent frameworks rely on unstructured swarms, where multiple agents interact dynamically without static role limits or rigid workflows. While this approaches natural human brainstorming, it exhibits high execution entropy, token inflation, and non-deterministic path execution.

MoD favors a **sparsely-gated, role-bounded council model**. By limiting the active council to a maximum of 6 specialized roles selected via a deterministic gating function and restricting their interaction to structured JSON refinements, MoD retains the cognitive diversity of multi-agent debate while enforcing the determinism, latency controls, and low resource overhead required for production-ready development loops.

---

## 5. Multi-Layer Validation & The Role of the Product Critic
A codebase that compiles and passes its unit tests can still represent a failure in product design. For example, a button may be correctly rendered, but located in an unintuitive workflow step, or the UI layout may feel stitched together from disparate components.

MoD models this with two distinct validation layers:
1. **Automated Structural Gates**: Evaluating mechanical compliance (ARIA validation, DOM structure, component token use).
2. **Cognitive Product Critique**: Running a post-implementation `ProductCriticRunner` that evaluates the overall coherence of the result. It asks: *Does this change preserve legacy strengths? Does it adapt familiar codebase patterns, or does it look like generic generated code?*

By enforcing validation after mutation, MoD prevents local optimizations from eroding the codebase's long-term design integrity.

---

## 6. AI Alignment & Human Agency
In the context of the AI Alignment problem, MoD serves as a mechanism to align agent code mutations with high-level human intention and design instructions. 

Rather than delegating mutation authority directly to an LLM, the orchestrator forces the model to construct intermediate representations (Design Decisions) which are checked against constraints and "locked". This gives human users or supervising processes a transparent, auditable decision interface before any code changes are written to disk. The human/supervisor acts as the final completion gate, closing the loop between autonomous capability and human oversight.

---

## 7. Persona Orthogonal Coverage
We define a cognitive orthogonality metric between specialized design personas to ensure that the council covers the entire design space without redundant evaluations. Let $\mathcal{K}_s$ be the set of evaluation heuristics, rule sets, and prompts assigned to persona $s$. The cognitive overlap between two personas $s_i, s_j$ is given by:
$$\text{Overlap}(s_i, s_j) = \frac{|\mathcal{K}_{s_i} \cap \mathcal{K}_{s_j}|}{|\mathcal{K}_{s_i} \cup \mathcal{K}_{s_j}|}$$
The Orthogonality of the council is:
$$\text{Orth}(s_i, s_j) = 1 - \text{Overlap}(s_i, s_j)$$
For the 9 specialist personas defined in MoD, their prompts and role guidelines are audited to ensure $\text{Orth}(s_i, s_j) \ge 0.85 \quad \forall i \neq j$. This high degree of orthogonality guarantees that when specialists execute in parallel:
- They evaluate distinct, non-overlapping dimensions of the codebase.
- We minimize redundant tokens in prompt prefixes and reasoning steps.
- The resulting refinements represent independent, orthogonal dimensions of the quality space.

## 8. Epistemic Isolation & Anti-Pattern Containment
In unconstrained agent loops, an early bad assumption or hallucination by a model can propagate through subsequent steps, leading to "cascading hallucinations" and code pollution.

MoD prevents anti-pattern propagation by enforcing **Epistemic Isolation**:
- **Sandboxed Perception**: Read-only specialist personas inspect the codebase independently. They cannot read or modify each other's intermediate scratchpads, preventing consensus bias or groupthink.
- **Contract-Bound Validation**: Refinements are validated mechanically against schema rules and intent constraints *before* entering convergence.
- **Bounded Write Scope**: Implementation subagents receive only finalized, locked decisions. They have no visibility into rejected or superseded alternatives, eliminating decision ambiguity during execution.

---

## 9. Summary
MoD elevates autonomous software development from simple text-to-code synthesis to a coordinated, design-driven lifecycle. By grounding codebase changes in locked design decisions, enforcing role-based isolation, and applying deterministic conflict resolution, MoD builds a structured, reliable, and world-class product-engineering pipeline.

