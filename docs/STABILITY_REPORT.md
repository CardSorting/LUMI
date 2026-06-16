---
title: "Stability & Technical Debt Report"
sidebarTitle: "Stability Report"
description: "Monitoring system health, identifying technical debt, and ensuring project stability."
---

# Stability & Technical Debt Report

The LUMI system includes built-in monitors to track project health and identify areas of "technical debt" that could impact stability or performance. This report provides a literal overview of how these metrics are tracked and managed.

## 📊 System Stability Metrics

LUMI monitors several key indicators to ensure that your codebase remains healthy as the agent suggests changes:

- **Structural Integrity**: Tracks circular dependencies, broken imports, and invalid symbol references.
- **Code Standards Compliance**: Measures how well the codebase follows the rules defined in `.dietcoderules`.
- **Complexity Hotspots**: Identifies files or modules that are becoming too large or complex to be safely managed by an AI agent.
- **Dependency Drift**: Monitors for outdated or conflicting package versions.

## 🛠️ Managing Technical Debt

When LUMI identifies a stability issue (formerly referred to as a "pathogen"), it categorizes it by severity:

| Severity | Type | Action Required |
| :--- | :--- | :--- |
| **High** | **Structural Break** | Fix immediately. The agent may struggle to reason about this module until the error is resolved. |
| **Medium** | **Complexity Warning** | Consider refactoring. The file is exceeding recommended line limits or complexity thresholds. |
| **Low** | **Standard Violation** | Aesthetic or minor pattern deviation. Should be fixed during the next maintenance cycle. |

## 🔍 How to Monitor Health

1. **The Stability Panel**: Open the "Stability" tab in the LUMI interface to see real-time health metrics.
2. **Auto-Diagnostics**: LUMI runs background checks after every task to ensure no regressions were introduced.
3. **Audit Logs**: Detailed reports are saved in `broccolidb` and can be exported for team reviews.

---
*Stability is the foundation of velocity. Keep your codebase clean and your agent smart.*
