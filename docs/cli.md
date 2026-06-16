# CLI reference

```bash
npx broccolidb <command> [options]
```

## Output formats

Pass `--format <human|compact|json|sarif>` where supported.

| Format | Use |
|--------|-----|
| `human` | Default terminal output |
| `compact` | Single-line JSON |
| `json` | Pretty JSON |
| `sarif` | Spider gate / export (where applicable) |

## Commands

### `broccolidb health`

AgentContext + runtime memory health.

```bash
npx broccolidb health
npx broccolidb health --deep --format json
```

### `broccolidb spider gate`

Run structural audit + gate. Exit code matches gate result.

```bash
npx broccolidb spider gate
npx broccolidb spider gate --format sarif
```

### `broccolidb spider compact`

CI-style compact digest.

```bash
npx broccolidb spider compact --format compact
```

### `broccolidb runtime <subcommand> <sessionId>`

| Subcommand | Action |
|------------|--------|
| `state` | Current session state from RuntimeStateGraph |
| `replay` | Forensic replay (readonly) |
| `story` | Human narrative |
| `snapshot` | Create / show snapshot metadata |

```bash
npx broccolidb runtime state <sessionId> --format json
npx broccolidb runtime story <sessionId>
```

### Existing commands

- `init` — index repository
- `status` — graph density stats
- `serve` — MCP server
- `config` — local settings
