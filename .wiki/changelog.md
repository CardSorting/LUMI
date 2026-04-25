# Active Technical Changelog

This log provides a granular, reverse-chronological record of every technical change in the DietCode codebase.

## [5.10.30] — 2026-04-25

### 🤖 Autonomous Forensic Phase Orchestration
Released version \`5.10.30\` featuring the **Autonomous Forensic Phase**. Task completion is now the trigger for automated architectural documentation.

- **Forensic Sub-Agent Orchestrator**:
  - **AttemptCompletionHandler**: Implemented \`runForensicSubagent()\`. If a task attempt is detected without a corresponding wiki update, the system now automatically spawns a **Forensic Architect** sub-agent.
  - **Contextual Documentation**: The sub-agent is provided with the implementation summary from the completion block to ensure high-fidelity documentation.
- **Sequential Stream Sequencing**:
  - Resolved the "Wiki Bypass" failure mode by ensuring the Forensic Phase is a mandatory, automated extension of the main task stream.
  - Verification is re-run post-subagent to ensure absolute compliance before final relinquishment of control.
- **Architectural Cleanup**:
  - Refined brace alignment and imports in \`AttemptCompletionHandler.ts\`.
  - Confirmed build and packaging integrity for \`5.10.30\`.

## [5.10.29] — 2026-04-25

### 🛡️ Sovereign Forensic Gate Implementation
This release implements the **Sovereign Forensic Gate**, a hard-gate mechanism that prevents task completion if the Knowledge Ledger has not been updated.

- **Forensic Gate Architecture**:
  - **FluidPolicyEngine**: Implemented \`checkForensicCompliance()\` to verify writes to \`.wiki/changelog.md\`.
  - **UniversalGuard**: Exposed forensic compliance as a first-class architectural check.
  - **AttemptCompletionHandler**: Integrated the gate directly into the \`attempt_completion\` tool execution flow.
- **Task Orchestration**:
  - **Sequential Stream Trigger**: Completion is now blocked with a descriptive error if the ledger is stale, forcing the agent into a dedicated **Forensic Phase**.
  - **ToolExecutor**: Updated \`TaskConfig\` to pass the \`UniversalGuard\` to all handlers.
- **Structural Integrity**:
  - **TaskConfig Keys**: Updated validation keys to include \`universalGuard\`.
  - **Version Release**: Bumped to \`5.10.29\`.

## [5.10.28] — 2026-04-25

### 🚀 Forensic Awareness Hardening & Release
Released version \`5.10.28\` featuring the **Forensic Awareness Hardening** pass. This release formally integrates agent awareness of the diagnostic substrate.

- **Forensic Awareness Hardening**:
  - **Prompt Architecture**: Created and registered the \`forensic_tools.ts\` component across all major model variants.
  - **Tool Documentation**: Formally defined Spider Engine commands (\`status\`, \`blast-radius\`, \`deps\`, etc.) within the system prompt.
  - **Persistence Guard**: Hardened \`.gitignore\` against SQLite and BroccoliDB persistence variants.
- **Version Release**:
  - **package.json**: Bumped version from \`5.10.27\` to \`5.10.28\`.
  - **Build Pipeline**: Executed \`npm run protos\`, \`npm run build:webview\`, and \`esbuild\` production build.
  - **Packaging**: Generated \`dietcode-5.10.28.vsix\`.
- **Forensic & Structural Audit**:
  - **Vibration Detection**: Identified a \`SQLITE_CONSTRAINT_FOREIGNKEY\` vibration during the forensic audit phase. Diagnostic accuracy is currently DEGRADED.
  - **Checkpoint Sync**: Verified physical state against git hash \`5c739441\`.
  - **Structural Coherence**: Confirmed zero orphan files in \`.wiki/\`.

**Forensic Tool Calls**:
- \`git rev-parse HEAD\` (Checkpoint Verification)
- \`npx tsx scripts/agent-spider.ts seed\` (Substrate Vibration Detection)
- \`write_to_file\` (Structural Coherence Audit)

## [5.10.27] — 2026-04-25

---
## [5.10.24] — 2026-04-22
*(Previous changes documented in high-level changelog)*
