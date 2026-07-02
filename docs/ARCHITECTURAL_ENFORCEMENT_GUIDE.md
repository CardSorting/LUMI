# Joy-Zoning Architectural Enforcement Documentation

## Overview
The `TspPolicyPlugin` is the architectural gatekeeper for the project. It applies canonical **Joy-Zoning** layers (Domain, Core, Infrastructure, UI, Plumbing) to greenfield and opted-in workspaces, while preserving the architecture of established workspaces that have not opted in.

---

## Architecture posture

Detection happens once per policy-engine session:

1. `global.architectureMode: "joy-zoning"` enables canonical structural enforcement.
2. `global.architectureMode: "workspace-native"` enables infused guidance.
3. A legacy `stability.config.json` or `spider.spec.json` counts as a canonical opt-in.
4. An empty workspace is treated as greenfield.
5. An existing implementation without an opt-in is workspace-native.

In workspace-native mode, LUMI follows nearby modules, dependency flow, language/framework idioms, and the project's test seams. JoyZoning remains active through non-blocking cohesion, ownership, and decision/effect boundary advisories, but does not require layer tags, canonical directories, cross-layer rules, or one-interface-per-class DDD ceremony.

The blended rule is: **workspace-native determines structural fit; JoyZoning steers local design quality**.

### Industry alignment

The strategy deliberately converges with widely used engineering practices:

- [ISO/IEC 25010:2023](https://www.iso.org/standard/78176.html) provides the quality-attribute frame used to select acceptance evidence.
- [DORA continuous delivery capabilities](https://dora.dev/capabilities/continuous-delivery/) support small deployable changes, fast feedback, continuous testing, pervasive security, observability, and loose coupling.
- The [C4 model](https://c4model.com/abstractions) provides the system → container/deployable unit → component → code abstraction ladder.
- [Architectural Decision Records](https://adr.github.io/) are reserved for architecturally significant choices and their consequences.
- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) supplies risk-based verification requirements for security-sensitive web application changes.

These references are quality and execution lenses. They do not authorize LUMI to replace a workspace's established architecture.

```json
{
  "global": {
    "architectureMode": "workspace-native"
  }
}
```

Valid values are `auto`, `joy-zoning`, and `workspace-native`.

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
In canonical JoyZoning mode, every supported custom source file must begin with a layer tag to enable Geographic Alignment:
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
*Last Updated: 2026-07-02 (Workspace-Native Infusion)*
