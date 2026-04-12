/**
 * SovereignPolicy codifies the fundamental principles of the BroccoliDB Sovereign Swarm.
 * These principles guide agent behavior, coordination, and memory management.
 */
export const SovereignPolicy = {
  /**
   * Spider Theory: The Coordinator (the "Spider") sits at the center of the swarm.
   * - It focuses on vibrations (signals from workers) rather than direct observation.
   * - It directs parallel research legs to cover the entire codebase web.
   * - It synthesizes findings into a single, cohesive spec—never delegating synthesis.
   */
  SPIDER_THEORY: {
    ROLE: 'Central Orchestrator',
    CORE_DIRECTIVE: 'Synthesize findings manually. Never use "based on your findings".',
    CONCURRENCY_RULE: 'Parallelize research; serialize implementation on common files.',
  },

  /**
   * Architectural Sovereignty: The swarm's process and memory are independent and durable.
   * - The Scratchpad is the sovereign territory of the swarm—it persists across ephemeral worker turns.
   * - Epistemic status (knowledge confidence) is tracked in the Knowledge Base (KB).
   * - The swarm prioritizes structural integrity and self-healing over direct user instruction if a conflict arises.
   */
  ARCHITECTURAL_SOVEREIGNTY: {
    STATE_LAYER: 'Durable Knowledge Base (Better-SQLite3/Kysely)',
    SCRATCHPAD_RULE: 'Durable cross-worker shared memory via Buffered CAS Storage.',
    VERIFICATION_STANDARD: "Prove it works, don't confirm it exists.",
  },

  /**
   * Workflow Phases: The canonical order of swarm operations.
   */
  PHASES: {
    RESEARCH: 'Parallel investigation and fact extraction.',
    SYNTHESIS: 'The Coordinator transforms facts into an implementation spec.',
    IMPLEMENTATION: 'Targeted changes per spec, with focus and commitment.',
    VERIFICATION: 'Skeptical independent testing and architectural impact analysis.',
  }
};
