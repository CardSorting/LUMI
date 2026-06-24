## Summary

<!-- What changed and why? Link issue: Fixes #123 -->

## Type

- [ ] Bug fix
- [ ] Feature
- [ ] Refactor
- [ ] Documentation
- [ ] CI / tooling
- [ ] Breaking change

## Test plan

<!-- How did you verify? Include commands run. -->

- [ ] `npm run ci:check-all` (or relevant subset)
- [ ] Unit / integration tests updated as needed
- [ ] UI change — screenshot or recording attached

## Docs

- [ ] No doc impact
- [ ] Updated per [CODE_TO_DOC_MAP.md](docs/CODE_TO_DOC_MAP.md)
- [ ] User-facing change noted in [CHANGELOG.md](CHANGELOG.md) `[Unreleased]`

## Governed execution (if applicable)

- [ ] N/A
- [ ] Touched swarm harness — ran `npm run test:unit -- --grep "governed execution"`
- [ ] Updated [governed docs](docs/governed-subagent-execution.md) or [quick reference](docs/governed-roadmap-projection-quickref.md)

## Checklist

- [ ] PR is focused (single concern; split large changes)
- [ ] Commits use clear messages (`feat:`, `fix:`, `docs:` encouraged)
- [ ] PR title follows Conventional Commits (e.g. `feat: add governed receipt panel`)
- [ ] I have read [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
