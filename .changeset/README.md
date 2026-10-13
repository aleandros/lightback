# Releases

Run `pnpm changeset` when changing a published package. Select the affected packages and write the user-facing release note. Versions are independent.

The release workflow runs the CI gates, opens a Version Packages PR, and publishes its merged versions with npm OIDC. Initial package publication and trusted-publisher setup are still required; see `docs/HANDOFF.md` Track A3.

Lightback peer ranges are explicit (core `>=0.0.1 <0.3.0`; React requires widget `>=0.2.0 <0.3.0`). Before a minor release, run `pnpm changeset status --verbose`: a package listed for a major bump usually means a peer range excludes the new minor. Widen the range after validating compatibility instead of using `workspace:^`. Versions remain independent.

Changesets 2.x and pnpm 10.18 delegate the final upload to npm. CI installs npm 11 for OIDC; reconsider the workflow when upgrading these tools.
