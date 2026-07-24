---
title: "Mixture of Designers (MoD) Orchestration Architecture"
sidebarTitle: "Mixture of Designers (MoD)"
description: "Architecture, Mixture of Experts (MoE) routing, circuit breakers, zero-stall heuristic sensing, and consensus for Mixture of Designers in LUMI."
---

# Mixture of Designers (MoD) Architecture

The **Mixture of Designers (MoD)** framework in LUMI is an autonomous, multi-specialist product design and implementation orchestrator. Inspired by modern **Mixture-of-Experts (MoE)** model routing, **Byzantine Fault Tolerant (BFT)** consensus, and zero-stall execution authority, MoD evaluates complex product requests across 10 specialized design dimensions, converges on optimal design decisions, and implements validated code changes with zero blocking.

---

## Code Map

| Component | Path | Responsibility |
|-----------|------|----------------|
| Orchestrator | `src/core/orchestration/mod/MixtureOfDesignersOrchestrator.ts` | End-to-end stage pipeline lifecycle, circuit breaker execution, and stage transitions |
| Types & Interfaces | `src/core/orchestration/mod/types.ts` | Data models, schemas for intent, classified problems, refinements, decisions, and telemetry |
| Intent Analyzer | `src/core/orchestration/mod/IntentAnalyzer.ts` | LLM product intent extraction with self-healing heuristic fallback recovery |
| Problem Classifier | `src/core/orchestration/mod/ProblemClassifier.ts` | Problem dimension categorization with zero-stall keyword heuristic sensing |
| Specialist Selector | `src/core/orchestration/mod/SpecialistSelector.ts` | Softmax Top-K MoE routing, capacity factor load balancing, and fallback mapping |
| Context Builder | `src/core/orchestration/mod/ContextBuilder.ts` | Role-aware context package prefetching with in-memory TTL content caching |
| Convergence Engine | `src/core/orchestration/mod/ConvergenceEngine.ts` | BFT 3-stage filtering, deduplication, conflict resolution lattice, and utility scoring |
| Gate Evaluator | `src/core/orchestration/mod/GateEvaluator.ts` | Multi-dimension validation gate checks and targeted revision pass routing |
| Product Critic | `src/core/orchestration/mod/ProductCriticRunner.ts` | Post-implementation adversarial critique and gate failure trigger |
| Receipt Store | `src/core/orchestration/mod/ReceiptStore.ts` | Persistent DAG state serialization, validation, checkpoint hashing, and resume recovery |

---

## 10 Specialized Designer Roles

MoD routes classified problems to specialized design personas:

| Designer Role | Target Dimensions | Focus & Responsibilities |
|---------------|-------------------|--------------------------|
| `product-strategist` | `product-strategy`, `generative-workflow` | User goals, jobs-to-be-done (JTBD), value alignment |
| `ux-architect` | `information-architecture`, `workflow` | Structural navigation, screen layout, user mental model coherence |
| `interaction-designer` | `interaction`, `system-status`, `agentic-control` | Affordances, states (hover, active, focus, disabled), system feedback |
| `visual-systems-designer` | `visual-hierarchy`, `cross-surface-consistency` | Visual balance, contrast, typography scale, surface harmony |
| `content-designer` | `content` | Copy clarity, microcopy, instructional clarity, tone |
| `design-system-engineer` | `design-system` | Component token usage, primitive reuse, design token compliance |
| `accessibility-reviewer` | `accessibility` | Keyboard navigation, screen reader accessibility (ARIA), WCAG standards |
| `responsive-design-reviewer` | `responsive-design` | Responsive breakpoints, layout reflow, mobile/desktop viewport safety |
| `frontend-implementation-designer` | `implementation-quality` | Code aesthetics, component structure, clean implementation patterns |
| `product-critic` | `final-product-critique` | Post-execution adversarial critique and holistic quality evaluation |

---

## 10-Stage Pipeline Lifecycle

```text
User Request
  │
  ├─► Stage 1 & 2: Concurrent Product Intent & Problem Classification
  │     (Fallback: Heuristic sensing ensures zero-stall if LLM stream fails)
  │
  ├─► Stage 3: Specialist Selection & MoE Capacity Balancing
  │     (Softmax Top-K routing with capacity load offloading)
  │
  ├─► Stage 4: Specialist Analysis & Recommendation Validation
  │     (Circuit-Breaker wrapped Promise.allSettled execution)
  │
  ├─► Stage 5: Convergence & BFT Consensus
  │     (Syntactic isolation, priority lattice conflict resolution, utility scoring)
  │
  ├─► Stage 6: Decision Lock
  │     (Lock accepted decisions before code mutations)
  │
  ├─► Stage 7: Implementation Planning
  │     (Generate disjoint boundary mutation tasks)
  │
  ├─► [Branch: Outcome Mode]
  │     ├─► "plan-only": Skip mutation execution ──► Integrated Validation & Critique ──► Finish
  │     └─► "plan-and-implement": Proceed to Stage 8
  │
  ├─► Stage 8: Parent-Authorized Implementation
  │     (Disjoint mutation batches run in parallel with direct I/O execution authority)
  │
  ├─► Stage 9: Integrated Validation & Product Critique
  │     (Evaluate product, UX, visual, interaction, accessibility, & implementation gates)
  │
  └─► Stage 10: Gate Evaluation & Revision Loop
        (Incremental revision pass re-runs ONLY responsible roles for failed gates)
```

---

## Resilience & High Throughput Architecture

### 1. MoE Capacity Factor Load Balancing
When a single specialist role is assigned more than 5 problems, `SpecialistSelector` offloads excess load to pre-mapped fallback experts (`FALLBACK_ROLE_MAP`). This prevents single-role bottlenecking and balances execution load across specialists.

### 2. Specialist Circuit Breakers
Specialist executions in Stage 4 use `Promise.allSettled`. If an individual LLM call fails, times out, or throws an exception, the circuit breaker trips, logs the failure, and re-routes to fallback context without crashing the orchestrator pipeline.

### 3. Zero-Stall Heuristic Fallback Sensing
If the `ProblemClassifier` or `IntentAnalyzer` LLM streams fail:
- `ProblemClassifier.getFallbackClassification(requestText)` performs keyword-driven problem sensing for accessibility, visual hierarchy, interaction, and workflow issues directly from the user request text.
- `IntentAnalyzer.getFallbackIntent(requestText)` extracts explicit/implicit requirements, performance, and calm experience constraints.

### 4. In-Memory Context Content Caching
`ContextBuilder` maintains a 1-minute TTL workspace content cache (`setCachedFileContent` / `getCachedFileContent`). This eliminates duplicate file reads during batch prefetching across specialists.

---

## Convergence & BFT Consensus

`ConvergenceEngine` processes specialist recommendations using a 3-stage filter:
1. **BFT Syntactic Isolation**: Drops malformed refinements missing required targets or recommendations.
2. **Semantic Boundary Verification**: Drops refinements touching out-of-scope files.
3. **Priority Lattice Conflict Resolution & Complementary Fusion**: Resolves conflicting recommendations on identical targets based on role hierarchy while fusing non-conflicting visual tokens and acceptance criteria:
   ```text
   product-strategist (5) > accessibility-reviewer (4) > ux-architect (3) > design-system-engineer (2) > others (1)
   ```
4. **Decision Utility Calculation**:
   $$\text{Utility} = \text{Severity Weight} \times \text{Confidence Weight}$$

---

## Hardening & Architectural Enhancements (v1.3)

Recent production audits resolved critical pipeline failure modes and added high-reliability execution guarantees:

1. **Subagent UI Status Envelope Serialization**:
   - `SubagentStatusRow.tsx` natively parses MoD stage progress notifications (`runId`, `stage`, `progress`).
   - `transitionTo()` broadcasts `status` and `items` fields so the chat UI displays live progress badges (`MoD convergence (54%)`) without error fallbacks.

2. **Complementary Property Fusion**:
   - `ConvergenceEngine` fuses non-conflicting visual evidence, adaptation notes, tradeoffs, and acceptance criteria into winning design decisions during priority conflict resolution, preserving valuable insights from lower-priority specialists.

3. **Resilient LLM Response Parsing**:
   - `parseRefinements()` strips markdown codeblocks (`replace(/```json/gi, "")`) and invokes `getFallbackRefinement()` fallback synthesis if an LLM returns unformatted text, preventing silent drop of refinements.

4. **Universal Implementation Task Mapping**:
   - `generateImplementationTasks()` maps **all accepted design decisions** directly into implementation tasks, removing narrow hardcoded category string filters.

5. **Fallback Core Specialist Council Assignment**:
   - `SpecialistSelector` automatically assigns core default specialists (`product-strategist`, `ux-architect`, `visual-systems-designer`) if problem classification returns empty or unmapped problem sets.

6. **Executive Summary Design Reporting**:
   - `reportFinalResult()` outputs a structured executive summary detailing locked decisions, rationales, implementation task completion rates, and quality gate audit results.

---

## Verification & Testing

Run the unit test suite covering MoD orchestration, circuit breakers, fallback routing, and BFT consensus:

```bash
npx cross-env TS_NODE_PROJECT=./tsconfig.unit-test.json npx mocha src/core/task/tools/subagent/__tests__/mod.test.ts
```
