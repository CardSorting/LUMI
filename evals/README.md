# DietCode Evaluation Framework

This directory keeps long-running evaluation tooling that is separate from the VS Code extension compile path.

## Structure

```
evals/
├── e2e/        # Full agent E2E runner documentation
├── analysis/   # Metrics and reporting utilities
└── benchmarks/ # Benchmark-specific harnesses
```

## E2E Tests

See `evals/e2e/README.md` for the current end-to-end runner details.

## Analysis

Run the analysis CLI from the evals workspace:

```bash
cd evals
npm run analysis -- --help
```
