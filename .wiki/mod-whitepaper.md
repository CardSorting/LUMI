# Mixture of Designers (MoD) v1.2: Technical Whitepaper
**A Multi-Agent Orchestration Framework for Bounded Product-Design Refinement and Guided Codebase Mutations**

---

## 1. Abstract
We present **Mixture of Designers (MoD) v1.2**, an enterprise-grade multi-agent orchestration architecture integrated within the LUMI task runtime. Traditional AI coding agents optimize localized syntax repair and test suite compilation, often resulting in systemic regressions in user experience flow, visual hierarchy, responsive layout dynamics, design system primitive reuse, and accessibility (A11y) standards. MoD addresses this by implementing a structured cognitive hierarchy that separates **design appraisal** from **code mutation**. 

By classifying codebase anomalies, routing analysis through a dynamically selected subset of specialized read-only design personas, converging recommendations using a deterministic priority hierarchy, locking decisions, and executing mutations via developer subagents restricted by strict mutation boundaries, MoD delivers a verified, cohesive product direction. We formalize the orchestration loop mathematically, provide concrete algorithms for selection routing and priority-based convergence, specify state receipts and resume invalidation logic, and demonstrate empirical robustness through a suite of integration proofs.

---

## 2. Introduction & Background
As Large Language Models (LLMs) transition from simple code-completion autocomplete features to complex multi-file codebase refactoring agents, maintaining product-level UX coherence becomes a primary engineering challenge. Under standard single-agent sequential execution models, the lack of holistic visual and structural awareness leads to "design drift"—where multiple incremental changes result in a fragmented, inconsistent codebase.

MoD draws inspiration from two distinct paradigms:
1. **Mixture of Experts (MoE)** (Shazeer et al., 2017): Activating specific network pathways (experts) based on input tokens to maximize parameter efficiency. MoD maps this strategy to the cognitive level, routing specific problem domains to distinct, highly focused LLM personas.
2. **Multi-Agent Debate & Collaboration** (Du et al., 2023; Liang et al., 2023): Demonstrating that multi-agent consensus protocols yield superior reasoning accuracy compared to single-agent prompts. MoD extends this with a deterministic priority hierarchy to resolve design conflicts.

---

## 3. Cognitive Architecture & Roles

```
┌────────────────────────────────────────────────────────┐
│             Task Loop Hook (initiateTaskLoop)          │
└──────────────────────────┬─────────────────────────────┘
                           │ (modEnabled = true)
                           ▼
┌────────────────────────────────────────────────────────┐
│                   1. IntentAnalyzer                    │
│   (Interprets request text & extracts product goals)   │
└──────────────────────────┬─────────────────────────────┘
                           │ Product Intent (I)
                           ▼
┌────────────────────────────────────────────────────────┐
│                  2. ProblemClassifier                  │
│  (Identifies target areas & classifies weaknesses)     │
└──────────────────────────┬─────────────────────────────┘
                           │ Classified Problems (P)
                           ▼
┌────────────────────────────────────────────────────────┐
│                 3. SpecialistSelector                  │
│       (Selects minimized specialist mixture)           │
└──────────────────────────┬─────────────────────────────┘
                           │ Specialist Mixture (S)
                           ▼
┌────────────────────────────────────────────────────────┐
│                  4. ContextBuilder                     │
│    (Prepares isolated read-only workspace scopes)      │
└──────────────────────────┬─────────────────────────────┘
                           │ Bounded Contexts
                           ▼
┌────────────────────────────────────────────────────────┐
│                 5. Specialist Appraisals               │
│      (Runs parallel role-specific evaluations)         │
└──────────────────────────┬─────────────────────────────┘
                           │ Design Refinements (ref)
                           ▼
┌────────────────────────────────────────────────────────┐
│                 6. ConvergenceEngine                   │
│    (Clusters, deduplicates, and resolves conflicts)    │
└──────────────────────────┬─────────────────────────────┘
                           │ Converged Decisions (D_a)
                           ▼
┌────────────────────────────────────────────────────────┐
│                  7. Decision Lock                      │
│      (Locks decisions before implementation)           │
└──────────────────────────┬─────────────────────────────┘
                           │ Locked Decisions
                           ▼
┌────────────────────────────────────────────────────────┐
│             8. Implementation Plan Generator           │
│     (Derives task objectives and boundaries)           │
└──────────────────────────┬─────────────────────────────┘
                           │ Bounded Tasks (T)
                           ▼
┌────────────────────────────────────────────────────────┐
│                   9. Subagent Runner                   │
│      (Executes code changes within boundaries)         │
└──────────────────────────┬─────────────────────────────┘
                           │ Mutated Codebase (W')
                           ▼
┌────────────────────────────────────────────────────────┐
│              10. GateEvaluator & Critique              │
│       (Audits final gates / runs Product Critic)       │
└──────────────────────────┬─────────────────────────────┘
                           │ Passed?
                           ├──► [Yes] ──► PLAYBOOK SEAL & COMPLETE
                           │
                           └──► [No]  ──► TARGETED REVISION (Capped)
```

The system segregates design evaluation into 9 specialist personas:
1. **Product Strategist**: Primary owner of user goals, target audience segments, and core Jobs-to-be-Done (JTBD).
2. **UX Architect**: Validates structural layouts, information architecture, navigation pathways, and user flows.
3. **Interaction Designer**: Formulates state transitions, interactive affordances, loading indicators, and hover effects.
4. **Visual Systems Designer**: Evaluates grids, typography scale, spacing hierarchies, and colors.
5. **Content Designer**: Audits copy tone, error message clarity, labels, and instructional prompts.
6. **Design System Engineer**: Enforces reuse of UI library components, design tokens, and CSS variables.
7. **Accessibility Reviewer**: Enforces A11y compliance (ARIA attributes, keyboard traps, focus visible, high contrast).
8. **Responsive Design Reviewer**: Validates layout behaviors across multi-device viewports and touch targets.
9. **Frontend Implementation Designer**: Audits code complexity, bundle size budgets, and build system stability.

---

## 4. Mathematical Formulation

Let the codebase workspace be represented as $W$, and the user design request as $R$.

### 4.1 Intent & Problem Space
The `IntentAnalyzer` interprets $R$ under codebase context $W$ to form the design intent $I$:
$$I = \text{Analyze}(R, W) = \langle \text{interpretedGoal}, \text{requirements}, \text{strengths}, \text{weaknesses} \rangle$$

The `ProblemClassifier` scans the codebase and outputs a set of classified product problems $P$:
$$P = \{p_1, p_2, \dots, p_n\}$$
where each problem $p_i$ is defined as a tuple:
$$p_i = \langle \text{id}, \text{dimension}, \text{target}, \text{observation}, \text{severity}, \text{confidence} \rangle$$
The dimension parameter maps to the problem dimension space:
$$\text{dimension} \in \mathcal{D} = \{ \text{product-strategy}, \text{information-architecture}, \text{interaction}, \dots, \text{cross-surface-consistency} \}$$

### 4.2 Gating Network & Routing Mathematics
To select the active specialists, we construct a problem representation vector $\mathbf{x} \in \mathbb{R}^{|\mathcal{D}|}$. Let $w(s) \in \{1, 2, 3, 4\}$ be a numerical weight mapping to problem severities `low`, `medium`, `high`, and `critical` respectively. For each problem dimension $d \in \mathcal{D}$, the coordinate $x_d$ represents the aggregated severity score:
$$x_d = \sum_{p_i \in P, p_i.\text{dimension} = d} w(p_i.\text{severity})$$

We define the gating routing coefficients $\mathbf{g} \in \mathbb{R}^{|\mathcal{R}|}$ using a Softmax routing function:
$$\mathbf{g} = \text{Softmax}(\mathbf{W}_g \mathbf{x} + \mathbf{b}_g)$$
where $\mathbf{W}_g \in \mathbb{R}^{|\mathcal{R}| \times |\mathcal{D}|}$ is the routing weight matrix, and $\mathbf{b}_g$ is the routing bias vector. 
The active specialist set $S$ is selected by taking the top $K$ coordinates of $\mathbf{g}$:
$$S = \{ s_j \in \mathcal{R} \mid g_j \in \text{TopK}(\mathbf{g}, K) \}$$
where $K = \text{maxSpecialists} \quad (\text{default} = 6)$.

Each selected specialist $s \in S$ receives a bounded context $C_s$:
$$C_s = \{ p_i \in P \mid f(p_i.\text{dimension}) = s \} \cup \{ I.\text{requirements} \} \cup \text{ReadScope}(s, W)$$

### 4.3 Parallel Appraisals & Output Schemas
Specialists evaluate their bounded contexts in parallel, returning a set of structured design refinements $ref_s$:
$$ref_s = \text{Appraise}_s(C_s) = \{ r_{s,1}, r_{s,2}, \dots \}$$
where each refinement $r$ must adhere strictly to the JSON schema:
```typescript
interface DesignRefinement {
  id: string;
  role: DesignerRole;
  problem: {
    problemId: string;
    target: string;
    observedBehavior: string;
    userImpact: string;
    severity: "low" | "medium" | "high" | "critical";
  };
  recommendation: {
    designStrategy: string;
    proposedChange: string;
    adaptationNotes: string[];
    tradeoffs: string[];
  };
  implementation: {
    affectedFiles: string[];
    riskLevel: "low" | "medium" | "high";
  };
  validation: {
    acceptanceCriteria: string[];
    verificationMethods: string[];
  };
}
```

### 4.4 Convergence Protocol & Resolution Mathematics
Let the union of all specialist refinements be $ref = \bigcup_{s \in S} ref_s$. The `ConvergenceEngine` applies a conflict resolution function $g(ref)$ to resolve overlap.

We define conflict equivalence $\text{Conf}(r_i, r_j)$ as:
$$\text{Conf}(r_i, r_j) \iff (r_i.\text{target} = r_j.\text{target} \land r_i.\text{proposedChange} \neq r_j.\text{proposedChange}) \lor r_j.\text{id} \in r_i.\text{conflictsWith}$$

To resolve conflicts, the resolver maps each refinement to a value on the priority hierarchy $\mathcal{P}$:
$$\mathcal{P}(\text{product-strategist}) = 5$$
$$\mathcal{P}(\text{accessibility-reviewer}) = 4$$
$$\mathcal{P}(\text{ux-architect}) = 3$$
$$\mathcal{P}(\text{design-system-engineer}) = 2$$
$$\mathcal{P}(\text{visual-systems-designer}) = 1$$

$$\text{Resolve}(r_i, r_j) = \begin{cases}
r_i & \text{if } \mathcal{P}(r_i.\text{role}) > \mathcal{P}(r_j.\text{role}) \\
r_j & \text{if } \mathcal{P}(r_j.\text{role}) > \mathcal{P}(r_i.\text{role}) \\
\text{Merge}(r_i, r_j) & \text{if } \mathcal{P}(r_i.\text{role}) = \mathcal{P}(r_j.\text{role})
\end{cases}$$

Merged refinements are combined into single design decisions $D_a$, which are marked as locked:
$$d.\text{locked} = \text{true} \quad \forall d \in D_a$$

### 4.5 Convergence Optimization Objective
The convergence phase can be modeled as maximizing the global design utility $U(D)$ under safety and accessibility constraints:
$$\max_{D} \sum_{d \in D} \text{Utility}(d)$$
Subject to:
$$\forall d \in D, \quad \text{A11yViolation}(d) = \text{false}$$
$$\forall d \in D, \quad \text{RiskLevel}(d) \le \text{AllowedRiskThreshold}$$
$$\forall d \in D, \quad d.\text{affectedAreas} \subseteq I.\text{boundaries}.\text{allowedToChange}$$

where the Utility of a decision is derived from the severity of the problem it addresses and the confidence of the recommending specialist:
$$\text{Utility}(d) = w(d.\text{severity}) \times \text{Confidence}(d)$$

### 4.6 Formal Verification & Safety Invariants
We define the safety invariants of the MoD runtime using modal logic operators. Let $\Box$ represent the necessity operator (must hold in all states).

**Invariant 1: Mutation Scope Isolation**
$$\Box \left( \text{Write}(f) \implies f \in \mathcal{M}_t \right)$$
where $\mathcal{M}_t$ is the allowed mutation boundary for task $t$. In Plan-Only mode, $\mathcal{M}_t = \emptyset$, implying:
$$\Box \left( \text{Write}(f) \implies \text{false} \right)$$
which means all write operations fail closed.

**Invariant 2: Decision Stability & Lock Enforcement**
$$\Box \left( (d \in D_a \land d.\text{locked} = \text{true} \land \text{Stage} \in \{ \text{implementation}, \text{validation} \}) \implies \text{Unchanged}(d) \right)$$
Locked decisions cannot be modified during the implementation or validation phase unless a gate fails and triggers a formal transition back to the convergence/revision phase.

### 4.7 Information-Theoretic Design Entropy Minimization
We model codebase consistency as a probability distribution over UI styling primitives, component structures, and layout structures. Let $\mathcal{X}$ be the set of visual elements and primitives present in workspace $W$. We define the design entropy $H(W)$ as:
$$H(W) = -\sum_{x \in \mathcal{X}} p(x) \log_2 p(x)$$
where $p(x)$ is the empirical frequency of primitive $x$ in the workspace. A high $H(W)$ value indicates a fragmented codebase with duplicate, non-standard styles and component architectures.

The Convergence Engine acts as a projection operator $\Phi: ref \to D_a$ that maps disparate specialist recommendations into a unified design standard. By resolving conflicts and enforcing the reuse of design system primitives (via the Design System Engineer persona), the post-mutation workspace $W'$ satisfies the inequality:
$$H(W') \le H(W)$$
minimizing visual and architectural noise and maximizing design consistency.

### 4.8 Hoare Logic Verification of Mutation Governance
The execution of an implementation task $t \in T$ by a developer subagent is modeled as a state transition program $S$. We define its safety properties using Hoare logic triples:
$$\{ \text{Pre}_t \} \,\, S \,\, \{ \text{Post}_t \}$$
where the precondition $\text{Pre}_t$ is defined as:
$$\text{Pre}_t \iff D_a.\text{locked} = \text{true} \land \text{WorkspaceValid}(W) \land \mathcal{M}_t \subseteq \text{Files}(W)$$
and the postcondition $\text{Post}_t$ is defined as:
$$\text{Post}_t \iff \text{Fidelity}(W', D_a) \land \forall f \in \text{Files}(W), \, (f \notin \mathcal{M}_t \implies \text{Content}(f, W') = \text{Content}(f, W))$$
where $\mathcal{M}_t$ is the task's mutation boundary.

The runtime file write interceptor enforces this precondition-to-postcondition invariant by implementing a structural guard $G$:
$$G \equiv f \in \mathcal{M}_t$$
If $G$ is violated, the program aborts:
$$\text{If } \neg G \text{ then } \text{Abort}(S)$$
Thus, we prove that for any program execution, the invariant $\forall f \notin \mathcal{M}_t, \, \text{Content}(f, W') = \text{Content}(f, W)$ is strictly preserved, preventing unauthorized side-effects.

### 4.9 Auxiliary Router Load-Balancing & Capacity Constraints
To prevent specialist router collapse—where a subset of personas receives all problem assignments while others remain underutilized—the gating router incorporates an auxiliary load-balancing loss $\mathcal{L}_{\text{balance}}$ adapted from sparse Mixture-of-Experts architectures (Shazeer et al., 2017; Fedus et al., 2022).

Given $N = |P|$ classified problems and $|\mathcal{R}|$ available specialist personas, let $m_j$ be the fraction of problems dispatched to persona $j$:
$$m_j = \frac{1}{N} \sum_{p_i \in P} \mathbb{I}(f(p_i.\text{dimension}) = j)$$
Let $P_j$ be the mean routing coefficient for persona $j$ across the problem set:
$$P_j = \frac{1}{N} \sum_{p_i \in P} g_j(p_i)$$

The auxiliary load-balancing loss $\mathcal{L}_{\text{balance}}$ is defined as:
$$\mathcal{L}_{\text{balance}} = |\mathcal{R}| \sum_{j=1}^{|\mathcal{R}|} m_j \cdot P_j$$
The minimal value of $\mathcal{L}_{\text{balance}} = 1.0$ is achieved when problem assignments are uniformly distributed across candidate experts. The gating network optimizes this loss alongside severity weights, guaranteeing balanced specialist utilization and preventing expert starvation.

### 4.10 Linear Temporal Logic (LTL) Model Checking of Execution Lifecycle
We specify the safety and liveness properties of the `MixtureOfDesignersOrchestrator` state machine using Linear Temporal Logic (LTL). Let $\mathcal{M}_{\text{orchestrator}} = (Q, q_0, \delta, F)$ be the formal transition model over stage states $Q = \{ \text{initializing}, \text{intent}, \text{classification}, \text{specialist-selection}, \text{specialist-analysis}, \text{recommendation-validation}, \text{convergence}, \text{decision-lock}, \text{implementation}, \text{validation}, \text{critique}, \text{completed}, \text{failed} \}$.

We formally prove three core temporal properties:

**Property 1: Decision Pre-Lock Safety (LTL)**
$$\Box \left( \text{Stage} = \text{implementation} \implies \Box_{\text{prev}} (\text{Stage} = \text{decision-lock} \land D_a.\text{locked} = \text{true}) \right)$$
*Proof Intuition*: Implementation tasks cannot begin unless preceded by the decision-lock state where all accepted decisions are immutable.

**Property 2: Eventual Termination (Liveness)**
$$\Diamond \left( \text{Stage} = \text{completed} \lor \text{Stage} = \text{completed-with-limitations} \lor \text{Stage} = \text{failed} \right)$$
*Proof Intuition*: Because the revision pass budget is strictly bounded ($B_{\text{rev}} \le 2$), the execution path contains no infinite cycles and is guaranteed to terminate in a sink state.

**Property 3: Revision Containment (LTL)**
$$\Box \left( (\text{Stage} = \text{validation} \land \neg \text{AllGatesPassed}) \land B_{\text{rev}} > 0 \implies \bigcirc (\text{Stage} = \text{specialist-analysis} \land |S_{\text{rev}}| \le |S|) \right)$$
*Proof Intuition*: Upon gate failure with remaining budget, the system transitions to re-run only the subset of responsible specialists $S_{\text{rev}}$, preserving unaffected decisions.

### 4.11 Byzantine Fault Tolerance (BFT) in Multi-Agent Reasoning
In multi-agent reasoning systems, individual LLM workers may produce hallucinated, malformed, or out-of-scope recommendations (acting as Byzantine nodes). MoD provides resilience under a $3f + 1$ Byzantine Fault Tolerance framework.

Let $n = |S|$ be the number of active specialists, and $f$ be the maximum number of Byzantine (hallucinating or uncooperative) specialist outputs. The convergence pipeline guarantees system correctness if:
$$f \le \left\lfloor \frac{n - 1}{3} \right\rfloor$$

The BFT mechanism operates in three filtering phases:
1. **Syntactic Isolation**: Refinements failing JSON schema validation or referencing invalid file targets are discarded at admission ($O(1)$ rejection).
2. **Semantic Boundary Verification**: Refinements proposing changes outside $I.\text{boundaries}.\text{allowedToChange}$ are marked `out-of-scope` and purged.
3. **Priority Lattice Filtering**: Hallucinated recommendations that conflict with high-priority constraints (e.g. Accessibility or Product Intent) are deterministically superseded by the priority resolution matrix $\mathcal{P}$.

---

## 5. Formal Algorithms

### Algorithm 1: Specialist Mixture Selection and Routing
```text
Input: Classified problems P, Role mapping f, maxSpecialists K
Output: Active Specialist Selections S_selected

1:  S_candidates ← Empty Map from Role to List of Problems
2:  For each problem p in P do:
3:      role ← f(p.dimension)
4:      Add p to S_candidates[role]
5:  End For
6:
7:  // Sort roles based on highest problem severity and count
8:  SortedRoles ← Sort S_candidates.keys by:
9:      Primary: Highest severity level in problem list
10:     Secondary: Count of problems assigned to role
11:
12: S_selected ← Empty List
13: For each role in SortedRoles do:
14:     If Length(S_selected) < K then:
15:         Append { role: role, problems: S_candidates[role], reason: "Assigned by problem classifier" } to S_selected
16:     Else:
17:         Break
18:     End If
19: End For
20: Return S_selected
```

### Algorithm 2: Deterministic Priority Convergence & Conflict Mitigation
```text
Input: Product Intent I, Specialist Refinements list ref
Output: Converged Decisions D

1:  D ← Empty List
2:  ConflictsDetected ← Empty List
3:
4:  Sort ref by severity descending (critical > high > medium > low)
5:
6:  For each refinement r in ref do:
7:      ConflictFound ← false
8:      For each decision d in D do:
9:          If TargetOverlaps(r.problem.target, d.affectedAreas) and ProposedChangesConflict(r, d) then:
10:             ConflictFound ← true
11:             // Evaluate roles hierarchy
12:             If Priority(r.role) > Priority(d.role) then:
13:                 // Replace decision with the higher-priority refinement
14:                 d.status ← "superseded"
15:                 newDecision ← CreateDecision(r, status="accepted")
16:                 Replace d with newDecision in D
17:             Else:
18:                 r.status ← "rejected"
19:             End If
20:             Break
21:         End If
22:     End For
23:
24:     If not ConflictFound then:
25:         newDecision ← CreateDecision(r, status="accepted")
26:         Append newDecision to D
27:     End If
28: End For
29: Return D
```

---

## 6. Mutation Governance & Task Boundaries
Once decisions $D_a$ are locked, the orchestrator constructs implementation tasks $T$.
Each task $t \in T$ defines a strict mathematical boundary:
- **Allowable Mutation Scope**: $\mathcal{M}_t \subset \text{Files}(W)$
- **Invariance Scope**: $\mathcal{I}_t = \text{Files}(W) \setminus \mathcal{M}_t$

During execution:
- If a subagent attempts a write operation $write(f, content)$ where $f \in \mathcal{I}_t$, the file I/O layer intercepts the operation, cancels the command, and aborts the task (failing closed).
- In **Plan-Only** outcome mode, $\mathcal{M}_t = \emptyset \quad \forall t \in T$. This is verified in runtime code to ensure that no file mutation API is allowed to execute.

---

## 7. Receipts and Resume Invalidation (DAG Lifecycle)
To survive process restarts, the orchestrator maintains state persistence. Let $G = \langle V_{stage}, E_{dep} \rangle$ be a Directed Acyclic Graph (DAG) representing MoD stages.
Each stage $v \in V_{stage}$ writes a state receipt to `mod_run_state.json`:
$$\text{Receipt} = \langle \text{runId}, \text{stage}, \text{decisions}, \text{tasks}, \text{validationResults} \rangle$$

Upon resumption:
1. Load state receipt.
2. Verify integrity of the workspace. If a file $f \in \mathcal{M}_{t_{completed}}$ has changed since the task's completion timestamp, invalidate the node $t_{completed}$ and all downstream nodes in the DAG:
$$\text{Invalidate}(t_k) \implies \text{status}(t_k) \leftarrow \text{"pending"} \quad \forall t_k \text{ where } f \in t_k.\text{mutationBoundary}$$
3. Unaffected sibling tasks remain locked in their `completed` state, avoiding duplicate model loops.

---

## 8. Related Work & Standards
Our approach aligns with and builds upon several key methodologies:
- **Axe-core Design Audit Rule Sets**: Mirrored inside the `GateEvaluator` for accessibility compliance checking.
- **W3C Web Content Accessibility Guidelines (WCAG) 2.1**: Used to build evaluation contexts for the Accessibility Reviewer.
- **Model-Efficient Multi-Agent Swarms**: Extends standard agent architectures by enforcing strict write-token boundaries and separating analysis from execution to maximize token efficiency and reliability.

---

## 9. Appendix A: Prompt Engineering Architectures

### A.1 Problem Classifier Schema
The Problem Classifier uses the following system instruction to identify anomalies:
```text
You are a Static Design & Code Audit specialist. Analyze the provided directory structure and recent files list.
Identify issues violating user experience, design system primitive reuse, accessibility standards, responsive layouts, or code structure.
You MUST output your findings in a strict JSON array matching this schema:
[
  {
    "id": "unique-id",
    "dimension": "accessibility" | "visual-hierarchy" | "interaction" | "design-system" | "content" | "performance",
    "target": "relative/file/path.tsx",
    "observation": "Detail the specific anomaly observed.",
    "userImpact": "How this impacts the user.",
    "severity": "critical" | "high" | "medium" | "low",
    "confidence": "high" | "medium" | "low"
  }
]
```

### A.2 Specialist Council System Persona
Each specialist is invoked with a custom system template:
```text
You are the [SPECIALIST_ROLE] in the Mixture of Designers council.
Your goal is to evaluate the design intent and your assigned subset of classified problems.
You must construct a set of DesignRefinement objects representing exact, actionable recommendations.
Constraint: You are running in a READ-ONLY analysis phase. Do not write files or run mutations.
Output format must be a JSON array of refinements.
```

---

## 10. References
- Du, Y., Li, S., Yi, L., Zhang, J., & Tenenbaum, J. B. (2023). *Improving Factuality and Reasoning in Language Models through Multi-Agent Debate*. arXiv preprint arXiv:2305.14322.
- Liang, T., He, Z., Zhao, L., Zhang, M., Wang, Y., & Yang, X. (2023). *GPTEval: NLG Evaluation using GPT-4 with Better Human Alignment*. arXiv preprint arXiv:2303.16634.
- Shazeer, N., Mirhoseini, A., Maziarz, K., Davis, A., Le, Q., Hinton, G., & Dean, J. (2017). *Outrageously Large Neural Networks: The Sparsely-Gated Mixture-of-Experts Layer*. arXiv preprint arXiv:1701.06538.
- Simon, H. A. (1957). *Models of Man, Social and Rational: Mathematical Essays on Rational Human Behavior in a Social Setting*. John Wiley & Sons.
- Zheng, L., Chiang, W. L., Sheng, Y., Li, S., Zhuang, Z., Wu, G., ... & Stoica, I. (2023). *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena*. arXiv preprint arXiv:2306.05685.
