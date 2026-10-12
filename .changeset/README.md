# Releases

Run `pnpm changeset` when changing a published package. Select the affected packages and write the user-facing release note. Versions are independent.

The release workflow runs the CI gates, opens a Version Packages PR, and publishes its merged versions with npm OIDC. Initial package publication and trusted-publisher setup are still required; see `docs/HANDOFF.md` Track A3.

The Lightback peer ranges cover the compatible 0.0.x and 0.1.x APIs. The initial changeset produces 0.1.0 for all three packages without promoting their dependents to 1.0.0. Future releases remain independent; widen peer ranges only after validating compatibility.

Changesets 2.x and pnpm 10.18 delegate the final upload to npm. CI installs npm 11 for OIDC; reconsider the workflow when upgrading these tools.
