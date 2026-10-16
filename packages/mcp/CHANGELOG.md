# @lightback/mcp

## 0.3.1

### Patch Changes

- Validate optional shadow/frame context paths on selections and region children before formatting reports, and use the updated core prompt formatter.
- Updated dependencies
  - @lightback/core@0.2.5

## 0.3.0

### Minor Changes

- 53a649a: Start or reuse the local feedback receiver automatically when a coding host connects over stdio. Initialize missing configuration from project/origin options, preserve reports across reconnects, and add explicit stop plus idle shutdown so no separate server terminal is required.

## 0.2.1

### Patch Changes

- Prepare the first automated MCP patch release through the existing trusted publishing workflow, with npm provenance. Runtime behavior is unchanged from 0.2.0.

## 0.2.0

### Minor Changes

- d35a985: Add an optional loopback feedback receiver and stdio MCP tools for Claude Code and Codex, with scoped access, bounded reports/images, revision-checked replies and an optional browser follow-up thread. Browser capture packages and payload v1 remain unchanged.
