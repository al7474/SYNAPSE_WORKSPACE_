# GitHub Governance

This repository keeps CI and security automation in version control, but GitHub branch protection is a repository setting and cannot be activated by a workflow file alone.

## Dependabot

Dependabot is configured in `.github/dependabot.yml` for:

- npm and pnpm workspace dependencies in the repository root;
- GitHub Actions versions used by CI and CodeQL.

Dependency update pull requests must pass the same required checks as feature pull requests.

## CodeQL

`.github/workflows/codeql.yml` analyzes JavaScript and TypeScript on pushes and pull requests targeting `main` or `master`, and runs a scheduled weekly scan. The workflow uses the `security-extended` query suite and builds the workspace so CodeQL can inspect the generated application paths.

## Protect `main`

In the repository settings, open **Settings > Branches > Rulesets** or **Settings > Branches > Branch protection rules**, then create a rule for `main` with these settings:

- Require a pull request before merging.
- Require at least one approving review.
- Dismiss stale approvals when new commits are pushed.
- Require approval from Code Owners when a code owners file is added later.
- Require status checks to pass before merging and require the branch to be up to date.
- Require the CI checks `CI / Quality and build`, `CI / PostgreSQL integration`, and `CodeQL / Analyze` after their first successful run. GitHub may display the workflow and job names slightly differently; choose the contexts produced by the current workflows.
- Require conversation resolution before merging.
- Block force pushes and branch deletion.
- Apply the rules to administrators as well.
- Restrict direct pushes to `main`; release automation should use a pull request or a separately reviewed deployment workflow.

The repository should also enable **Allow auto-merge** only when the required checks and review policy remain enforced. Keep `master` available only if an existing deployment still uses it; new development should target `main`.
