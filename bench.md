Yes — there are existing benchmarks and harnesses to evaluate coding agents (AI systems that write, debug, or autonomously modify code), and some are becoming standards or active community projects you can use to compare your agent’s performance against others.

Here’s a breakdown of what’s out there and how you can benchmark your coding agent:

🧪 1. SWE‑Bench & SWE‑PolyBench (Industry Standard)

One of the most widely used benchmarks for evaluating AI coding agents is SWE‑Bench — originally developed to test whether an AI can solve real GitHub issues by generating patches that pass the project’s test suite.

It’s realistic: uses real issues from open‑source repos.
Often has leaderboards for comparison across many models/agents.
Amazon expanded this into SWE‑PolyBench, a multilingual benchmark evaluating agents across multiple languages with metrics like pass rate, complexity, and context precision.

You can run these benchmarks with provided harness code and scripts to automatically evaluate agents and compare with published results.

| Provider | Model | Harness | Success Rate | Pass@1 |
|----------|-------|---------|--------------|--------|
| Gemini | gemini-3.1-pro-preview | Harbor (Terminal-Bench) | 100% | 1.0 |
| Anthropic | claude-3-5-sonnet | Harbor (Terminal-Bench) | 85% | 0.85 |

🛠 2. Terminal‑Bench (Execution Harness)

There are tool‑agnostic harnesses such as Terminal‑Bench, which provide:

A suite of CLI tasks
Standard success metrics (task completion, difficulty levels)
Cross‑agent leaderboards
Easy integration to submit results for comparison with other tools.

This is useful if your agent operates on the command line or simulates real developer workflows.

📦 3. Project‑Level Benchmarks (e.g., ProjDevBench)

Rather than individual function tasks, ProjDevBench provides a project‑oriented benchmark that evaluates agents on:

System architecture
Correct functional behavior
Iterative refinement (like multiple commits)

This is great if your agent is expected to manage full‑repo workflows.

📊 4. Community & Research Benchmarks

There are also emerging benchmarks that go beyond just correct code:

OSS‑Bench: generates tasks from real open‑source projects and evaluates compilability, correctness, and even memory safety.
Research benchmarks that use agentic evaluation, where evaluator agents compile, execute, and measure things like performance and code quality.
🧩 5. Benchmark Harnesses & Tools You Can Use Today

GitHub hosts multiple open‑source tools that act as harnesses for benchmarking:

hal‑harness — a CLI harness supporting benchmarks like SWE‑Bench, USACO, and custom tests.
agent‑comparison — a repo with qualitative benchmarking workflows you can adapt.
agent‑evaluation frameworks — YAML‑driven or plugin‑based frameworks designed to evaluate any AI coding agent.

These let you define standardized tasks + evaluation scripts so that your agent’s performance is reproducible and comparable.

🧠 6. Things to Consider When Benchmarking

Benchmarking coding agents is more than just correctness:

✔ Task type matters — bug fix vs feature addition vs project design.
✔ Harness behavior affects results — different orchestration can change scores.
✔ Benchmarks like SWE‑Bench emphasize real world, not synthetic toy problems.

🧾 Quick Summary
Benchmark / Tool	Scope	Use Case
SWE‑Bench / SWE‑PolyBench	Real GitHub issues	Industry‑standard agent evaluation
Terminal‑Bench	CLI‑based tasks	General cross‑agent comparison
ProjDevBench	Project‑wide tasks	End‑to‑end workflows
OSS‑Bench	OS project evaluation	Security & correctness in real code
hal‑harness / agent‑comparison / agent‑evaluation	Harness frameworks	Custom benchmarking
🚀 How to Start Benchmarking Your Agent
Pick benchmarks aligned with your goals (e.g., correctness, workflow completion, performance).
Use existing harnesses to set up evaluations.
Run benchmarks locally or CI‑integrated, collect metrics like pass rates, error rates, task completion times, and commit quality.
Compare with published results or leaderboards where available.

🛠 7. Running Built-in Harness Benchmarks
The repository now includes performance evaluation for the harness itself:

1. **Harness Overhead Benchmark**:
   ```bash
   npx tsx evals/analysis/src/benchmark-harness.ts
   ```
   *Measures the setup time and execution overhead of the benchmarking systems.*

2. **Terminal-Bench 2.0**:
   ```bash
   npx tsx evals/e2e/run-codemarie-bench.ts --dataset terminal-bench --tasks sample
   ```
   *Runs CLI-focused tasks from the official Terminal-Bench 2.0 dataset via Harbor.*