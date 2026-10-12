# Handoff

Work agreed on 2026-10-11, written so a fresh session can pick up any track without the original conversation. Read `AGENTS.md` first. Each track lists steps in order, what "done" means, and the files involved. Tick items off here as they ship and move finished tracks to `docs/ROADMAP.md`.

Tracks are independent of each other except where noted. Suggested order: A, then B and C together.

---

## Track A: compatibility, CI, npm publishing

Goal: `@lightback/core`, `@lightback/widget` and `@lightback/react` publish to npm from GitHub Actions on merge to `main`, and work in every mainstream browser, bundler and SSR framework.

### A1. Compatibility fixes (code changes, do first)

1. **UUID fallback.** `packages/core/src/format.ts` `uid()` uses `crypto.randomUUID`, which is absent in Safari < 15.4 and in non-secure contexts (plain `http://` hosts). Fall back to `crypto.getRandomValues` and, if that is missing too, `Math.random`. Unit test both branches by stubbing `globalThis.crypto`.
2. **`createImageBitmap` fallback.** `packages/widget/src/index.ts` `captureBase()` decodes the screenshot Blob with `createImageBitmap`. Safari < 15 lacks it. Fall back to an `Image` element loaded from `URL.createObjectURL(blob)` drawn onto a canvas. Keep the `BaseShot` shape; `cropSelection` only needs something `drawImage` accepts.
3. **SSR guards.** `createLightback()` installs collectors immediately and touches `window`, `document`, `navigator`. Under Next.js, Remix, Nuxt or Astro the module is evaluated on the server. Every collector must no-op when `typeof window === 'undefined'`, and `describeElement`/`describeRegion` should throw a clear error rather than a `ReferenceError`. Add `packages/core/test/ssr.test.ts` running under vitest's `node` environment (not jsdom) that imports the package and calls `createLightback()`.
4. **Custom element double registration.** `mountWidget` calls `customElements.define('lightback-widget', …)`. Guard with `customElements.get(...)` so hot reload and micro-frontends do not throw.
5. **Pin the syntax target.** Add `--target es2020` to every tsup command so a TypeScript or tsup upgrade cannot silently raise it. Document the support matrix in README: evergreen browsers from the last two years, Safari 15.4+, Node 18+ for the import (not for running collectors).
6. **IIFE build of the widget.** Add a second tsup entry for `packages/widget` producing `dist/lightback.iife.js` that bundles core, exposes `window.Lightback = { createLightback, mountWidget }`, and is referenced from a `unpkg`/`jsdelivr` field. This is the script-tag install path and what the website will embed.

Done when: unit tests cover 1, 3 and 4; the four e2e suites still pass; README has the support matrix.

### A2. CI workflow

Create `.github/workflows/ci.yml`, triggered on push to `main` and on pull requests.

1. `actions/checkout`, `pnpm/action-setup` (reads `packageManager` from `package.json`), `actions/setup-node` with Node 22 and pnpm cache.
2. `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck`, `pnpm test`.
3. **E2E on three engines.** `npx playwright install --with-deps chromium firefox webkit`. Start `pnpm dev &`, wait for `http://localhost:5173/api/feedback` to answer, then run the suites. `e2e/lib.mjs` currently launches only `chromium` with `channel: 'chrome'`; add a `BROWSER` env var (`chromium | firefox | webkit`) that selects the Playwright engine and ignores `channel` when set. Run the suite job as a matrix over the three. WebKit is the one most likely to fail; fix what it finds rather than skipping it.
4. **Pack smoke.** `pnpm -r --filter './packages/*' pack` into a temp dir, create a scratch `package.json`, `npm install` the three tarballs, then run one ESM file and one CJS file that import each package and call `createLightback` under Node. This catches broken `exports` maps.
5. **Type resolution check.** `npx @arethetypeswrong/cli --pack packages/core` (and widget, react). Fail the job on any problem other than the ones you explicitly ignore with `--ignore-rules`.
6. **Screenshots are not CI output.** `docs/assets` is committed; do not regenerate it in CI.

Done when: a PR that breaks any of build, types, unit tests, e2e on any engine, pack, or type resolution goes red.

### A3. Versioning and release

1. `pnpm add -Dw @changesets/cli`, `pnpm changeset init`. Config: `"access": "public"`, `"baseBranch": "main"`, ignore `playground` and `e2e`, `"updateInternalDependencies": "patch"`. Independent versions per package.
2. Add `publishConfig: { "access": "public" }` to the three package manifests. Copy `LICENSE` into each package's `files` (npm does not inherit the repo root file). Add `README.md` per package, or a `"readme"` pointer; the root README is not published.
3. `.github/workflows/release.yml` on push to `main`: install, build, then `changesets/action` with `publish: pnpm changeset publish` and `version: pnpm changeset version`. It opens the "Version Packages" PR and publishes when that PR merges. Grant `permissions: { contents: write, pull-requests: write, id-token: write }`.
4. **npm trusted publishing (OIDC).** On npmjs.com, for each package, add the GitHub repository `aleandros/lightback` and workflow file `release.yml` as a trusted publisher. No `NPM_TOKEN` secret. Provenance attestations come for free; add `--provenance` to be explicit.
5. Tag releases `@lightback/core@x.y.z` (Changesets does this) and create a GitHub Release from the changelog.

Blocked on: the `@lightback` npm scope. Check availability at npmjs.com/org/lightback. If taken, pick the name before step 2 because it appears in every import and in the website. Trusted publishing needs the package to exist, so the very first `0.1.0` of each package is published by hand with `npm publish --access public` from a local checkout after `pnpm build`.

Done when: merging a Version Packages PR publishes to npm with provenance, with no secrets in the repo.

---

## Track B: website at aleandros.github.io/lightback

Goal: a public page that shows the product in motion and hosts the guides from `docs/guide/`.

### B1. Tooling decision

Use **VitePress** with `docs/` as its root. Reasons: the repo is already Vite; Markdown in `docs/guide/` becomes pages without conversion; it supports a custom landing page via the `home` layout; it builds to static files GitHub Pages can serve. Install it in a new `docs/package.json` (workspace member `docs`) so its dependencies stay out of the packages.

Config lives in `docs/.vitepress/config.ts`. Set `base: '/lightback/'` (required for a project page under `aleandros.github.io`). Sidebar: Getting started, Customization, Backend, Texts and i18n, Payload reference. Add `AGENTS.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `ROADMAP.md`, `HANDOFF.md` under a "Contributing" group or exclude them with `srcExclude`; either is fine, but decide.

### B2. Landing page

`docs/index.md` with the `home` layout: tagline, three feature cards (point at anything, context a model can use, your backend), install snippet, and the hero image. Below the fold, a short gallery: pick → comment → sending → inbox.

**Media.** Still images already exist in `docs/assets/` and are regenerated with `pnpm screenshots` (needs `pnpm dev` running). For GIFs or MP4s, record with Playwright's `recordVideo` option in a variant of `e2e/screenshots.mjs`, then convert with ffmpeg: `ffmpeg -i in.webm -vf "fps=15,scale=1280:-1" -c:v libx264 -crf 28 out.mp4` for MP4 and `-vf "fps=12,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"` for a GIF. Prefer MP4 with `<video autoplay loop muted playsinline>`; GIFs over 2 MB make the page slow. Suggested clips: single element to send in five seconds; drag over the modal; pending card with Cancel.

**Live demo.** The playground can be deployed as a static build under `/lightback/demo/` once the mock API is replaced by an in-browser mock (a `send` function that stores to `localStorage` and an inbox that reads it). Optional, good for conversion; leave for after the docs ship.

### B3. Deployment

`.github/workflows/pages.yml` on push to `main`: build the VitePress site (`pnpm --filter docs build`), upload `docs/.vitepress/dist` with `actions/upload-pages-artifact`, deploy with `actions/deploy-pages`. In the repo settings, Pages → Source → GitHub Actions. The URL is `https://aleandros.github.io/lightback/`.

Done when: the URL serves the landing page with media and the guides, and a docs change on `main` redeploys within minutes.

---

## Track C: user documentation

Goal: someone who has never seen the repo can install Lightback, make it look like their app, point it at their own backend, and translate it.

The pages exist as drafts in `docs/guide/`. They are written against the current code and clearly mark what is **Planned**, meaning the API is proposed but not implemented. Track C is both finishing the prose and implementing the small APIs the prose depends on.

### C1. Implement the APIs the docs promise

1. **`strings` option** on `WidgetOptions`: a partial table of every user-visible string, merged over an exported `defaultStrings`. Replace every hard-coded string in the widget template and class with lookups. Dynamic strings take parameters (`countSelected(n)`, `doneWithCount(n)`). This is the whole i18n story; locale detection stays with the host app. See `docs/guide/texts-and-i18n.md` for the proposed key list.
2. **`theme` option**: `'light' | 'dark' | 'auto'` (default `auto`, which is the current `prefers-color-scheme` behaviour). Implemented as `data-theme` on the host and a CSS selector alongside the existing media query.
3. **`::part` names** on the pill, panel, popover and pending card so hosts can restyle beyond the CSS variables. Keep the variable list as the primary API; parts are the escape hatch.
4. **`hideTrigger` option** (or `trigger: false`) so apps with their own button use `handle.open()` / `handle.startPicking()` only. The handle already exists; this just hides the pill.
5. **`beforeSend` in the widget docs** is already in core; make sure the guide shows the veto and the mutate case.

Each one is small. Add a unit or e2e assertion per option.

### C2. Finish the pages

- `docs/guide/getting-started.md`: install, mount, first report, what arrived.
- `docs/guide/customization.md`: options table, CSS variables, theme, position, own trigger, parts.
- `docs/guide/backend.md`: the endpoint contract, a Node handler, custom `send`, `beforeSend`, auth, storing attachments, forwarding to a model with `toPromptContext`.
- `docs/guide/texts-and-i18n.md`: `strings`, the key list, a Spanish example, RTL note.
- `docs/guide/payload.md`: field-by-field reference generated from `types.ts`. Consider `typedoc` with the markdown plugin to avoid hand-maintaining it.

Done when: every **Planned** marker in `docs/guide/` is gone because the feature shipped, and the pages render on the website.

---

## Notes for whoever picks this up

- The dev server must be running for `pnpm e2e` and `pnpm screenshots`. Both check and tell you if it is not.
- `docs/assets/*.png` are 2x retina captures of a 1280×800 viewport. Keep that size so the README and site layouts do not shift.
- Never commit `e2e/out/`; it is gitignored.
- The payload is `version: 1`. None of these tracks should change its shape. If one must, bump the version and note it in `docs/ARCHITECTURE.md`.
