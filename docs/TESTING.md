# Stateful property tests

`pnpm test` includes deterministic [fast-check](https://fast-check.dev/docs/advanced/model-based-testing/) properties in core and widget. They run in Vitest/jsdom with fake IndexedDB, clocks, transports and rasterization: no browser downloads, server, network calls or credentials are needed. The existing unit tests and real IndexedDB/UI browser suites remain platform coverage.

## Run and replay

```bash
pnpm test:properties
FC_RUNS=1000 FC_ACTIONS=80 pnpm test:properties
FC_SEED=42 FC_RUNS=1000 pnpm test:properties
```

The normal corpus uses seed `230023`, 60 examples per property, and up to 40 actions per lifecycle sequence. `test/property.ts` owns those defaults. Focused properties have smaller input bounds; increasing `FC_ACTIONS` changes the lifecycle and ring sequences. Asynchronous properties have a 120-second timeout to allow larger local runs.

On failure, fast-check prints the seed, shrink path, counterexample and earlier failing candidates. Copy the reported seed and path, select exactly the failing test, and keep its original `FC_ACTIONS` setting:

```bash
FC_SEED=230023 FC_PATH='4:2' pnpm --filter @lightback/core exec vitest run invariants.property.test.ts -t 'clear/destroy beats recovery'
```

The path above is illustrative: use the values from your failure. The action models generate plain arrays of commands, so fast-check shrinks both the sequence and its arguments; replay needs no separate `commands` replay log. Do not set `endOnFailure` for exploration: shrinking is valuable. Run replay against the same lockfile and generators. After a fix, retain a named regression for the minimal meaningful sequence as well as the property.

## Reference states and transitions

The models store small projections of public state, not copies of the implementation's queues or generation counters. Every generated action, including a no-op outside its allowed state, ends with an assertion against public APIs, DOM state, transport calls or stored records.

| Owner | Reference state | Allowed transitions and observations |
| --- | --- | --- |
| Core lifecycle | Editable text and selection ids, arrays of event labels, alive/destroyed, optional in-flight send | Edit/add/remove; emit console, error, network or breadcrumb; checkpoint/flush; clear; reload with startup events; expire; start/resolve/reject/veto send; destroy/recreate. Compare `getDraft`, `stats`, `buildPayload`, submitted note/selections and durable snapshots. Destroyed instances are not edited; recreate restores a new client. |
| Widget lifecycle | Text and selection ids, alive, picking, pending countdown, delivery count | Public handles and `data-action`/`data-ref` events drive edit/pick/select/remove, queue, cancel, review, timer expiry, immediate send, discard and remount. A recovered draft is editable with no picker or pending timer. |
| Widget image jobs | Selection present, capture/crop completion, attached images, cancellation and delivery | Deferred capture and canvas callbacks complete before or after remove/discard/destroy. Sending waits for image jobs; discard/destroy before transport cancels it. Removed selections never regain crops. A send already waiting on a crop still waits for that job even if its selection is removed. |
| Lazy controller | Alive, mounted/loading, latest requested intent, loader/error counts | Open/pick coalesce until resolve; close clears intent; rejection permits retry; destroy prevents late activation and callbacks. The original host is retained. |

A successful **core** send clears the current draft and all collector buffers, including edits/events made while the transport was in flight. The payload contains the draft captured for that send. A failed or vetoed send preserves current edits and buffers. This is the existing lifecycle, now explicit; custom editors should await send before starting another report. Once transport has started, destroying the widget does not abort it or change the core lifecycle, but the destroyed widget must not emit callbacks or reopen UI. Discard/destroy while still waiting for screenshots prevents transport from starting.

## Invariant ownership and boundaries

| Invariant | Test owner |
| --- | --- |
| FIFO ring order, capacity including zero, isolated array snapshots | Core `invariants.property.test.ts` |
| Independent collectors across arbitrary teardown orders; original methods restored | Core collector lifecycle property, with four clients and generated disposal permutations |
| Complete payload redaction, editable contents, fetch/XHR redirect origin | Core privacy regressions plus native redirects in `e2e/helpers/privacy.mjs` |
| Pending network/body completions after clear, send or destroy; no stale recovery | Core collector lifecycle regressions with deferred responses, controlled XHR and durable-record inspection |
| All four collectors and bounded recovery, startup event order, stricter capture/body policy | Core lifecycle model plus focused merge property |
| Schema/expiry validation; malformed selections do not discard a valid note | Core focused properties using generated corrupt records |
| Redaction before truncation; no form values or inspection HTML | Durable-record privacy property, using independent expected strings |
| Attachment opt-in, binary bytes, byte budget and references after stricter recovery | Durable attachment property and metadata-only regression |
| Denied storage, quota failures, complete storage opt-out | Failure-injection property; quota errors must invalidate the stale session key |
| Clear/destroy against an unfinished open/cursor read | Held IndexedDB open notification plus real fake-indexeddb transactions |
| Clear against queued writes/blob encoding; reload sees the last committed record | Deferred Blob encoding and explicit flush/clear/reload ordering |
| Pending timer cancellation and editable recovery | Widget lifecycle model; real reload remains in `e2e/session-recovery.mjs` |
| Late image jobs and waiting sends | Widget jobs model and named discard/destroy regressions |
| Lazy download lifecycle | Lazy model plus the existing real import failure/retry browser test |
| Sensitive subtrees never leak text, attributes, HTML or breadcrumbs for any pick or region | Core `sensitive.property.test.ts` over generated trees marked by attribute or selector, with secret tokens tracked independently of the implementation; focused props/Vue/rect/recovery cases in `sensitive.test.ts` |
| Every sensitive rect and reporter mask is painted into the lineage of every sent image | Widget `privacy.test.ts` property: generated selections and drags, canvas calls traced through each `drawImage` source; named regressions for fail-closed masking, untouched captures and restored masks. Real pixels in `e2e/privacy-masking.mjs` and the static demo |

Core tests replace only platform boundaries. `property-fixtures.ts` supplies a new IndexedDB factory per example, a controllable clock, valid selection fixtures and direct durable-record inspection. Timers are virtual; fake-indexeddb transactions keep their own task scheduling. `holdOpen` delays the database-open notification while transactions still come from fake-indexeddb. Blob encoding and widget rasterization are explicit deferred promises/callbacks. `settle` drains promise continuations without advancing time or releasing a blocked job. These tests do not introduce a production storage adapter or expose private widget methods.

The generated merge fixture deliberately includes request timestamps in completion order. Recovery must sort **before** enforcing a newly smaller limit. Stable ties keep previously stored entries before new startup entries. The normal ring remains FIFO in capture/completion order.

## Add a property

1. Identify the invariant's owner and a public observation that can falsify it. Avoid importing production normalization, validation or transition helpers into the oracle.
2. Add an action and model transition with its allowed states. Generate labels/ids and completion ordering independently of actual state; use actual ids only to locate the corresponding UI control.
3. Check after every transition and after recovery. For persistence/privacy properties, inspect the stored record as well as the public recovered value.
4. Clean up clients, widget handles, unresolved jobs, mocks, globals and clocks in `finally`, so every shrink attempt starts fresh.
5. Replay the minimized failure, add a named regression, then run the default corpus and a larger local corpus. Keep browser tests for layout, native IndexedDB and module loading.
