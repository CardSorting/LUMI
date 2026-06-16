---
title: "Enterprise Deployment"
sidebarTitle: "Enterprise"
---

# Enterprise Deployment & Self-Hosting

LUMI is architected for maximum data sovereignty. For enterprise environments with strict security requirements, the substrate supports **Self-Hosted (On-Premise)** mode, allowing you to bypass external cloud dependencies and manage your own industrial endpoints.

## 🏢 On-Premise Architecture

In On-Premise mode, LUMI redirects all API, App, and MCP traffic to your internal infrastructure. This is enabled by the `selfHosted` environment flag and a local configuration file.

### 🛡️ Configuration via `endpoints.json`
The substrate looks for a sovereign configuration file at the following path:
- **Global**: `~/.dietcode/endpoints.json`
- **Bundled**: The extension installation directory (for enterprise-preconfigured distributions).

#### Schema Definition
```json
{
  "appBaseUrl": "https://your-internal-app.company.com",
  "apiBaseUrl": "https://your-internal-api.company.com",
  "mcpBaseUrl": "https://your-internal-mcp.company.com/v1/mcp"
}
```

## 🔐 Environment Sovereignty (The Lease System)

The **EnvironmentSovereignty** engine (`src/core/integrity/EnvironmentSovereignty.ts`) enforces a **Deterministic Lease** on the machine. This ensures that the agent correctly perceives its machine boundaries in complex enterprise networks.

### 🧠 Hostname Anchoring
Every `EnvironmentalLease` is anchored to a unique **Machine Fingerprint**:
```python
Fingerprint = SHA256(Hostname | PATH | USER | CWD | Platform | NodeVersion)
```
If the hostname or machine anchor drifts (e.g., during a container migration or machine swap), the substrate triggers an immediate **Industrial Forensic Failure** and revokes the lease.

### 🔍 Binary Integrity & Shadowing Detection
The system proactively detects "Binary Shadowing"—where unauthorized binaries attempt to masquerade as core tools. 
- **L2 Forensic Probe**: Identifies if a binary (e.g., `node`, `git`) is located inside the workspace rather than the secure system PATH.
- **Integrity Alarms**: Drifts between the active runtime binary and the system PATH version trigger `⚠️ INTEGRITY` alerts in the Sovereign Dashboard.

## 🛠️ Deployment Modes

| Mode | Trigger | Focus |
| :--- | :--- | :--- |
| **Production** | Default (`Environment.production`) | High-velocity, cloud-connected. |
| **Staging** | `DIETCODE_ENVIRONMENT=staging` | Internal pre-release testing. |
| **Self-Hosted** | `endpoints.json` exists | **Absolute Data Sovereignty**. |

---

## 📈 Enterprise Monitoring
Enterprise deployments should monitor the **LUMI Vitality Stream** for:
- **Lease Revocations**: High frequency indicates unstable network artifacts or machine drifts.
- **Config Errors**: `DietCodeConfigurationError` prevents startup to avoid accidental data leakage to external URLs.
- **Metabolic Pressure**: Watch for memory saturation in large monorepos via the standard [Metabolic Monitor](JOYZONING_SOVEREIGNTY_3_0).

> [!CAUTION]
> **Data Sovereignty**: Once in `selfHosted` mode, environment switching is DISABLED. Endpoints remain locked to the authorized industrial configuration to prevent accidental logic leakage.
