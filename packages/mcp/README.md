# @lightback/mcp

Optional local Lightback receiver and stdio MCP tools for Claude Code and Codex. Node 22+. No model runtime, provider credentials or hosted backend.

```sh
npx lightback-mcp init --project my-app --origin http://localhost:5173
npx lightback-mcp serve
# Another terminal:
npx lightback-mcp browser-config
```

Keep `.lightback/` gitignored. The private connection file contains separate agent/browser tokens; **only** browser-config output belongs in your frontend. The receiver is loopback-only, exact-origin restricted, bounded, and keeps reports in memory for 30 minutes. Agent reconnects retain reports; receiver shutdown loses them.

Connect the existing app's `send` using `createFeedbackBridge` from `@lightback/mcp/browser`, then `bridge.connect(client)`. `mountFeedbackThread({ bridge })` optionally displays replies and accepts follow-ups. Continue using your existing screenshot/masking options; the bridge does not enable capture. The package root is Node-only.

Configure the coding host to run `node /absolute/node_modules/@lightback/mcp/dist/cli.js stdio --config /absolute/project/.lightback/connection.json`. Ask that conversation to watch Lightback: installing MCP does not automatically start turns. Tools list/wait/read reports, retrieve PNGs, and post revision-checked status/replies. The host edits and validates your workspace with its existing permissions.

See the [complete local walkthrough and protocol/retention details](https://github.com/aleandros/lightback/blob/main/docs/guide/coding-agents.md). Before initial npm publication, build the repository and run `node packages/mcp/dist/cli.js` instead of `npx lightback-mcp`.
