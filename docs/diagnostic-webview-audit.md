# Diagnostic/webview sanitization audit

Audit date: 2026-06-30

The repository-wide search covered the requested legacy phrases, gate XML,
continuity markers, lifecycle labels, and diagnostic emoji banners. The initial
inventory contained 606 matches across 168 files. Every match is classified by
the exhaustive path families below; a file can appear in more than one search
term, but it belongs to exactly one primary classification here.

| Classification | Complete path family | Disposition |
| --- | --- | --- |
| Safe backend log | `src/scripts/**`, `scripts/**`, `.github/scripts/**`, `evals/**`, `broccolidb/cli/**`, `broccolidb/infrastructure/**` | CLI, CI, benchmark, and backend process output; never enters extension chat state. |
| Safe backend log | `src/core/task/tools/handlers/AttemptCompletionHandler.ts`, `src/core/task/ToolExecutor.ts`, `src/core/task/tools/handlers/WriteToFileToolHandler.ts` | Completion, substrate, and stability diagnostics now use `Logger`; user-facing lifecycle output is canonical. |
| Safe test assertion | `**/__tests__/**`, `tests/**`, `broccolidb/tests/**`, `webview-ui/**/*.test.ts`, `webview-ui/**/*.test.tsx`, system-prompt `__snapshots__` | Fixtures and negative assertions intentionally retain forbidden strings. |
| Safe debug-mode-only output | `webview-ui/src/components/chat/ChatRow.tsx`, `webview-ui/src/components/chat/task-header/TaskNotesSection.tsx`, `webview-ui/src/components/chat/completion/GateLifecycleStatusPanel.tsx` | Structured evidence renders only when `showInternalDiagnostics === true`, sourced from `LUMI_SHOW_INTERNAL_DIAGNOSTICS=true`, and is labeled “Internal diagnostics.” |
| Stale legacy copy | `docs/**`, `.wiki/**`, `*.md`, `grounding.txt`, `.dietcoderules/**`, `optional-skills/**` | Historical design language and examples. These files are not webview render inputs. Runtime skill/prompt text is still sanitized if it is later published as a message. |
| Stale legacy copy | `src/shared/completion/gateLifecycleLabels.ts`, legacy types in `src/shared/completion/**` | Retained for stored-history compatibility; normal projection removes legacy gate metadata and never uses it as current guidance. |
| Obsolete recovery/governance text | `src/core/policy/**`, `infrastructure/policy/**`, `src/core/integrity/**`, `src/integrity/**`, `src/core/prompts/**`, `src/services/roadmap/**` | Legacy policy/control-plane producers may still use the vocabulary internally. Any value entering `say()`, state projection, Markdown, code/tool output, MCP output, status projection, or notifications passes through `sanitizeWebviewMessageContent()`. |
| Obsolete recovery/governance text | `src/core/context/**`, `src/core/task/**`, `src/core/controller/file/**` | Legacy staleness, planning, repair, and tool-result banners. They are retained for backend/agent behavior but cannot cross the centralized chat boundary. |
| Obsolete recovery/governance text | `broccolidb/core/agent-context/**`, `broccolidb/core/policy/**` | Separate agent-context/control-plane implementation; it has no extension webview transport. |
| Safe debug-mode-only output | `src/core/task/tools/attemptCompletionUtils.ts`, `src/shared/audit/**`, subagent governed-execution builders | Raw envelopes remain backend/agent handoff data. Normal webview projections remove them; explicit debug metadata can expose them. |
| Stale legacy copy | `src/shared/completion/gateActions.ts`, `src/shared/remote-config/**`, and equivalent type/comment-only matches | Compatibility tokens, comments, and warning headers; none are rendered message content. |
| Stale legacy copy | `webview-ui/src/components/joyzoning/JoyZoningView.tsx`, `src/core/controller/joyZoning/**` | Broad-search false positives and legacy labels in a user-invoked project audit screen, not chat or assistant prose. It does not consume `DietCodeMessage` content or lifecycle guidance. |

## Unsafe paths found and corrected

| Former unsafe path | Correction |
| --- | --- |
| Persisted state and partial stream subscriptions | Both project through `projectMessage(s)ForWebview`. |
| `Task.say()` text and reasoning | Sanitized before persistence/publish; removed content is retained in backend debug logs. |
| Specialized `ChatRow` branches, including plain text and error rows | `ChatRow` now re-projects each message before dispatching to any branch. |
| Markdown, code/tool output, and MCP plain/rich output | Leaf renderers sanitize through the same shared function. |
| Completion system notifications | The notification integration sanitizes title, subtitle, and message centrally. |
| Lifecycle panel continuity/evidence | Hidden normally; labeled and exposed only in explicit internal-diagnostics mode. |
| Execution header legacy `operatorMessage` and `recoveryPath` | Removed as guidance; status uses canonical projection or fixed user-facing copy. |
| Fresh legacy lifecycle fallback | Demoted to evidence-only; it cannot emit actions or operator instructions. |
| Audit/gate task-note panels | Hidden normally and available only under the explicit internal-diagnostics flag. |

## Boundary invariant

Normal chat receives only sanitized message content and
`CanonicalLifecycleDecision`. Legacy `GateLifecycleDecision`, audit metadata,
raw envelopes, continuity markers, and diagnostic metadata are removed from the
normal projection. The only opt-in is the exact environment value:

```text
LUMI_SHOW_INTERNAL_DIAGNOSTICS=true
```

Debug data remains separate from assistant prose and is rendered under an
“Internal diagnostics” disclosure.
