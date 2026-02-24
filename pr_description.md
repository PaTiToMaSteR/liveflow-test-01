# Refactor SheetOpsJS Execution to a Functional Stream Pipeline

## Summary
This PR refactors the core orchestration path of `SheetOpsJS` into a more functional, stream-oriented execution pipeline while preserving the challenge contract. It keeps the async fix and batched execution behavior, but restructures the implementation around composable helpers (`nextDiffState`, `unfoldOps`, `tapStream`, `chunkStream`) so the diffing and execution flow is easier to reason about and benchmark.

## Important context (Google API in this exercise)
The provided Google Sheets API class/mock in this exercise is a simulation used for local testing. It is useful for validating correctness and execution behavior, but it does not fully model production constraints (quotas, backend processing boundaries, network latency variance, etc.).

This refactor keeps the streaming behavior (generators) so operations can flow from diffing to execution without materializing a giant operations array up front.

## Problem Areas Addressed
1. **Async contract safety:** The original JS path relied on synchronous mock behavior and did not await `api.performOps(...)`.
2. **Execution coupling:** Diffing, batching, and API execution were harder to follow as a single imperative flow.
3. **Benchmark visibility:** After refactors, the benchmark needed stable profiling hooks (`reconcileNs`, `estimateNs`, `apiAwaitNs`, etc.) to keep the timing breakdown useful.

## Fixes in this PR

### 1) Functional-style transition engine
- Introduced `nextDiffState(...)` to represent one reconciliation step as `{ op, nextState }`.
- `unfoldOps(...)` lazily evaluates that state transition and yields ordered operations.
- **Gain:** The reconciliation rules are now easier to inspect in isolation and can be reasoned about as state transitions.

### 2) Lazy Stream Generation (Generators)
- Uses JavaScript generators (`function*`) so operations flow sequentially from diffing into execution.
- Avoids buffering one giant planned-op array before execution.

### 3) Separation of concerns in pipeline execution
- `tapStream(iterable, tapFn)` overlays benchmark metrics collection without changing yielded operations.
- `chunkStream(iterable, maxBatchOps, maxPayloadBytes)` handles batch slicing and payload guardrails.
- `updateSpreadsheet(...)` drives the pipeline and performs ordered API calls.

### 4) Async-safe execution retained
- The API execution path remains `async` and correctly awaits `performOps(...)`.
- Tests continue to validate behavior against the provided async API contract.

### 5) Benchmark profiling compatibility restored
- Restored benchmark profiling counters expected by `bench/compare.mjs`, including:
  - `reconcileNs`
  - `estimateNs`
  - `estimatedPayloadBytes`
  - `apiAwaitNs`
  - `executeLoopNs`
- This keeps `BREAKDOWN=1` output meaningful after the refactor.

## Validation

### Tests
```bash
cd sheet_ops_js
npm test -- --runInBand
```

Result locally: `6` tests, `0` failures

### Benchmark (local mock, no credentials)
```bash
cd sheet_ops_js
CASE=example2,large_repeat LARGE_REPEAT=8 USE_PREGENERATED_REPEAT=1 IMPL=fixed WARMUP=0 ITERATIONS=1 BATCHING=0 BATCH_SWEEP=500 MAX_PAYLOAD_BYTES=1500000 BREAKDOWN=1 MOCK_APPLY_SWEEP=splice,batch_rebuild node bench/compare.mjs
```

**Example results (machine-dependent) for `~800k` operations (`large_repeat x8`):**
```
large_repeat | fixed | batch500 | 799968 ops | 1600 calls | ... ms
```

The benchmark also prints a `Mock Apply Mode Improvement Summary` with `x` ratios (same solution, same ops/calls, different local mock apply strategy), for example:
- `example2`: ~`2x` total speedup (`splice` -> `batch_rebuild`)
- `large` / `large_repeat`: often `10x+` total speedup in the local mock
- `mockApplyMs` / `innerLoopSpeedup`: typically much larger (`10x+`) on large synthetic cases

Interpretation:
- This does **not** mean the submitted solution changed semantics or op counts.
- It demonstrates that repeated `splice()` in the local mock can dominate benchmark runtime for large synthetic workloads.
- `batch_rebuild` is **benchmark-only** (diagnostic), not a product/runtime behavior change.

## Scope
### Notes
- Kept public API compatibility exactly as required (`updateSpreadsheet` acts identical on the surface).
- The `digitCount` and `estimateOpBytes` utilities remain lightweight numeric helpers for benchmark parity.
- Functional-style refactor improves structure/readability, but still intentionally uses local mutable state inside generators/batching where practical in JS.
