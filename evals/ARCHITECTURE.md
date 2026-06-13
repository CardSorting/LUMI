# Evals Architecture

The evals area is intentionally separate from the VS Code extension build. Keep runners here isolated from root package compile scripts unless they are required for extension release validation.

Current active areas:

- `analysis/`: metrics and reporting utilities
- `e2e/`: full agent evaluation runner documentation
- `benchmarks/`: benchmark-specific test harnesses
