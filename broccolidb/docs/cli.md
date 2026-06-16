# CLI reference

```bash
npx broccolidb <command> [options]
```

The CLI bootstraps `AgentContext` from `broccolidb.db` in the current directory. Run `npx broccolidb init` first.

## Output formats

```bash
--format human    # default terminal output
--format compact  # single-line JSON
--format json     # pretty-printed JSON
--format sarif    # SARIF where applicable (spider gate)
```

## Commands

### `init`

Initialize database, index Git repository, configure API keys.

```bash
npx broccolidb init
```

### `status`

Graph density and embedding health (legacy graph stats view).

```bash
npx broccolidb status
```

### `health`

AgentContext lifecycle health + runtime memory integrity.

```bash
npx broccolidb health
npx broccolidb health --deep --format json
```

### `spider gate`

Run structural audit + gate inside a runtime session. Exit code matches gate result.

```bash
npx broccolidb spider gate
npx broccolidb spider gate --all --format sarif
```

### `spider compact`

CI-style compact digest via `ctx.graph.spider.check`.

```bash
npx broccolidb spider compact
npx broccolidb spider compact --format compact
```

### `runtime <subcommand> <sessionId>`

Requires a `sessionId` from a prior `beginSession` / gate run.

| Subcommand | Action |
|------------|--------|
| `state` | Current session state from RuntimeStateGraph |
| `replay` | Forensic replay (readonly) |
| `story` | Human-readable narrative |
| `snapshot` | Create or display snapshot metadata |

```bash
npx broccolidb runtime state <sessionId> --format json
npx broccolidb runtime story <sessionId>
npx broccolidb runtime replay <sessionId> --format json
npx broccolidb runtime snapshot <sessionId>
```

### `serve`

Start the BroccoliDB MCP server (stdio transport).

```bash
npx broccolidb serve
```

### `config`

Manage local settings (`set`, `get`, `list`, `wizard`).

```bash
npx broccolidb config set gemini_api_key <key>
npx broccolidb config wizard
```

## CI integration

```bash
npx broccolidb spider gate --format sarif > spider.sarif
npx broccolidb spider compact --format compact
# exit code propagates gate / check result
```

Guardrail: `tests/cli-smoke.test.ts`
