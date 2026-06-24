# Releasing LUMI

Maintainer runbook for shipping extension releases to VS Marketplace and Open VSX.

## Preconditions

- [ ] `main` is green (Tests, E2E, CodeQL)
- [ ] `[Unreleased]` in [CHANGELOG.md](../CHANGELOG.md) reflects user-facing changes
- [ ] `package.json` version bumped per [semver](../GOVERNANCE.md)
- [ ] Draft release notes reviewed ([Release Drafter](workflows/release-drafter.yml))

## Standard release

1. Merge release PR(s) to `main`.
2. Tag the release commit:
   ```bash
   git checkout main && git pull
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```
3. Open **Actions → Publish Release** ([publish.yml](workflows/publish.yml)).
4. Inputs:
   - `release-type`: `release` or `pre-release`
   - `tag`: `vX.Y.Z` (must exist on remote)
5. Workflow runs full test suite, then publishes with `publish` environment secrets.

## Post-release

- [ ] Publish GitHub Release from the Release Drafter draft (attach VSIX if needed)
- [ ] Move `[Unreleased]` entries to the new version section in `CHANGELOG.md`
- [ ] Verify [VS Marketplace](https://marketplace.visualstudio.com/items?itemName=CardSorting.lumi-vscode) and [Open VSX](https://open-vsx.org/extension/CardSorting/lumi) listings

## Rollback

- Yank or deprecate bad marketplace version via publisher dashboards
- Open a hotfix branch, cherry-pick fix, tag `vX.Y.Z+1`, re-run publish workflow

## Secrets (`publish` environment)

See [GOVERNANCE.md](../GOVERNANCE.md#deployment-environment-publish).
