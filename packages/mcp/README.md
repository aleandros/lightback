# @lightback/mcp

Optional local Lightback receiver and stdio MCP tools for Claude Code and Codex. Node 22+. No model runtime, provider credentials or hosted backend.

```sh
npm install --save-dev @lightback/mcp
npx lightback-mcp init --project my-app --origin http://localhost:5173
npx lightback-mcp browser-config
```

Register `stdio` with Claude Code or Codex: it automatically starts or reuses a background receiver. No separate server terminal is needed. An open MCP connection keeps it alive. It exits after 30 minutes without authenticated activity; `npx lightback-mcp stop` stops it immediately. `serve` is available for foreground diagnostics.

Keep `.lightback/` gitignored. The private connection file contains separate agent/browser tokens; **only** browser-config output belongs in your frontend. The receiver is loopback-only, exact-origin restricted, bounded, and keeps reports in memory for 30 minutes. Agent reconnects retain reports; receiver shutdown loses them.

Connect the existing app's `send` using `createFeedbackBridge` from `@lightback/mcp/browser`, then `bridge.connect(client)`. `mountFeedbackThread({ bridge })` optionally displays replies and accepts follow-ups. Continue using your existing screenshot/masking options; the bridge does not enable capture. The package root is Node-only.

Configure the coding host to run `node /absolute/node_modules/@lightback/mcp/dist/cli.js stdio --config /absolute/project/.lightback/connection.json`. To skip a separate init command, add `--project my-app --origin http://localhost:5173` to `stdio`; it creates the config on first connection and preserves existing credentials on reconnect. Ask that conversation to watch Lightback: installing MCP does not automatically start turns. Tools list/wait/read reports, retrieve PNGs, and post revision-checked status/replies. The host edits and validates your workspace with its existing permissions.

See the [complete local walkthrough and protocol/retention details](https://github.com/aleandros/lightback/blob/main/docs/guide/coding-agents.md). For development from a source checkout, build the repository and run `node packages/mcp/dist/cli.js` instead of `npx lightback-mcp`.
