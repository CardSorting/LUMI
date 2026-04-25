# Active Technical Changelog

This log provides a granular, reverse-chronological record of every technical change in the DietCode codebase.

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
