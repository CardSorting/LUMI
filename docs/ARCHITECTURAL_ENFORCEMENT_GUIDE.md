# Joy-Zoning Architectural Enforcement Documentation

## Overview
The `TspPolicyPlugin` is the core architectural gatekeeper for the project. It ensures that code follows the **Joy-Zoning** layer principles (Domain, Core, Infrastructure, UI, Plumbing) while providing intelligent flexibility for special cases like Xcode project files and large generated metadata.

---

## 🏗️ Policy Themes
You can configure how strictly the architecture is enforced using themes:

| Theme | Description | Best For |
| :--- | :--- | :--- |
| **Strict** | Full enforcement. Blocking errors for all violations. | Production CI, Final Reviews |
| **Relaxed** | Critical errors only. Warnings for large files. | Standard Development |
| **Safety** (Default) | Performance-first. Minimal checks on large files. | Prototyping, Initial Scaffolding |

---

## 🛡️ Exception Management
Certain files bypass architectural rules because their format is dictated by external tools (Xcode, NPM, Cargo, etc.).

### Automatic Whitelist
The system automatically whitelists over 50+ file types, including:
- **Xcode**: `.pbxproj`, `.pbxproj.parts`
- **Lockfiles**: `package-lock.json`, `yarn.lock`, `Cargo.lock`, `go.sum`
- **Configs**: `tsconfig.json`, `.eslintrc`, `.prettierrc`
- **Infrastructure**: `Makefile`, `Dockerfile`, `nginx.conf`
- **Documentation**: `README.md`, `CHANGELOG.md`, `LICENSE`

### Dynamic Exceptions
You can add exceptions programmatically via the API:
```typescript
plugin.addException("model", "Custom binary format bypass");
```

---

## 📊 Quality Scoring & Thresholds
For custom source code, the plugin applies a tier-based approach to line counts:

### 🟢 Tier 1: Small & Sharp (0-1000 lines)
- **Status**: Full Enforcement
- **Rules**: AST analysis, mandatory headers, strict layer boundaries.

### 🟡 Tier 2: The Warning Zone (1001-1500 lines)
- **Status**: Non-Blocking Warnings
- **Feature**: **Quality Scoring (0-100)**
- **Checks**: Complexity analysis, class-to-line ratio.
- **Outcome**: The build succeeds, but you receive refactoring recommendations.

### 🔴 Tier 3: Safety Bypass (>1500 lines)
- **Status**: Safety Mode
- **Rules**: Bypasses heavy AST analysis to prevent build slowdowns.
- **Outcome**: Only checks for mandatory Layer Tags and critical Import boundaries.

---

## 🛠️ Usage for Developers
### Mandatory Layer Tags
Every custom source file MUST begin with a layer tag to enable Geographic Alignment:
```typescript
/** [DOMAIN: MODEL] */
export class User { ... }
```

### Import Rules
- **Domain**: Cannot import Infrastructure or UI. Pure logic only.
- **Core**: Orchestrates Domain and Infrastructure. No UI imports.
- **UI**: Renders state. Cannot import Infrastructure directly.
- **Plumbing**: Zero context. No imports from high-level layers.

---

## ⚙️ Configuration
The thresholds and quality rules can be tuned in `src/core/policy/TspPolicyPlugin.ts`:
```typescript
private readonly THRESHOLDS = {
    MAX_CUSTOM_LINES: 1500,
    MAX_WARNING_LINES: 1000,
    MAX_AST_LINES: 3000
}
```

---

## 🕊️ Zero-Friction Success (V33/V34)
To support high-velocity refactoring, the system implements **Spectral Leniency**:

- **Conversational Grounding**: Paths discussed in recent chat (last 3 turns) are automatically grounded via neural context.
- **Aesthetic Agility**: Styles, comments, or whitespace modifications require no audit citation.
- **Terminal Agility**: Isolated leaf nodes (0 dependents) are always agile-safe.
- **Metabolic Elasticity**: Use `#REFACTOR` or `#INFRASTRUCTURE` in your audit to double your edit budget (25 -> 50).
- **Proactive Discovery**: During investigative stalls, the system automatically injects substrate deep-scans (symbols/pathogens) into the tool response.

---
*Last Updated: 2026-04-15 (V34 Spectral)*
