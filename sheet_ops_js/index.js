import GoogleSheetsApi from "./GoogleSheetsApi.js"

// Engineering guardrails for batching. Google Sheets API docs recommend keeping
// payloads around ~2 MB for reliability; we keep a safety margin below that.
const DEFAULT_EXECUTION_OPTIONS = Object.freeze({
  maxBatchOps: 500,
  maxPayloadBytes: 1_500_000,
})

/**
 * @typedef {{ columns: (number | null)[], rows: (number | null)[] }} SpreadsheetState
 * @typedef {{
 *   maxBatchOps?: number,
 *   maxPayloadBytes?: number,
 *   // Benchmark-only diagnostics collector used by bench/compare.mjs. This is
 *   // optional and should be omitted in normal usage; when absent there is no
 *   // profiling overhead in the solution path.
 *   profile?: Record<string, bigint | number>
 * }} ExecutionOptions
 */

/**
 * Update columns first, then rows, preserving the challenge contract while
 * batching API calls for better real-world behavior.
 *
 * @param {GoogleSheetsApi} api
 * @param {string} spreadsheetId
 * @param {SpreadsheetState} current
 * @param {SpreadsheetState} target
 * @param {ExecutionOptions} [executionOptions] Optional execution tuning.
 */
export default async function updateSpreadsheet(
  api,
  spreadsheetId,
  current,
  target,
  executionOptions = {}
) {
  const execOptions = normalizeExecutionOptions(executionOptions)
  // Optional benchmark-only instrumentation. The challenge/public API does not
  // depend on this object; it is only consumed when passed explicitly by the
  // local benchmark harness.
  const profile = isProfileCollector(executionOptions?.profile) ? executionOptions.profile : null
  // Dimension order matters because row/column indices are independent and the
  // challenge examples/process assume the two passes are executed separately.
  const dimensions = [
    ["column", current.columns, target.columns],
    ["row", current.rows, target.rows],
  ]

  for (const [dimension, currentIds, targetIds] of dimensions) {
    const plannedOps = diffDimensionOps(dimension, currentIds, targetIds)
    if (profile) {
      profile.dimensionPasses = (profile.dimensionPasses ?? 0) + 1
    }
    await executeInBatches(api, spreadsheetId, plannedOps, execOptions, profile)
  }
}

/**
 * Stream the ordered operations needed to reconcile one dimension (`row` or
 * `column`) from `currentIds` to `targetIds`.
 *
 * Intent:
 * - preserve the original reverse-traversal semantics (index-stable ops)
 * - avoid allocating one giant operations array before execution
 *
 * @param {"row" | "column"} dimension Dimension being reconciled.
 * @param {(number | null)[]} currentIds Current ids for the dimension.
 * @param {(number | null)[]} targetIds Target ids for the dimension.
 * @yields {["insert", "row" | "column", number, number] | ["delete", "row" | "column", number]}
 */
function *diffDimensionOps(dimension, currentIds, targetIds) {
  // Reverse traversal keeps emitted insert/delete indices stable as ops are
  // applied in order. Streaming via a generator avoids materializing very
  // large intermediate op arrays before execution.
  let currentIdx = currentIds.length - 1
  let targetIdx = targetIds.length - 1

  while (currentIdx >= 0 || targetIdx >= 0) {
    const currentId = currentIds[currentIdx]
    const targetId = targetIds[targetIdx]

    // Exact match: no mutation needed, move both pointers.
    if (currentIdx >= 0 && targetIdx >= 0 && currentId === targetId) {
      currentIdx--
      targetIdx--
      continue
    }

    // If we exhausted current but still have target values, only real ids
    // should be inserted (null placeholders are user-defined and skipped).
    if (currentIdx < 0 && targetId === null) {
      targetIdx--
      continue
    }

    if (currentIdx < 0) {
      yield ["insert", dimension, 0, targetId]
      targetIdx--
      continue
    }

    // Target exhausted: anything remaining in current must be deleted, except
    // user-defined placeholders (`null`) which we never delete.
    if (targetIdx < 0) {
      if (currentId !== null) {
        yield ["delete", dimension, currentIdx]
      }
      currentIdx--
      continue
    }

    // `null` is a user placeholder. We cannot delete it, so we insert the
    // target id around it and let future iterations align placeholders.
    if (currentId === null) {
      yield ["insert", dimension, currentIdx + 1, targetId]
      targetIdx--
      continue
    }

    // Mismatch on a real id: preserve original behavior and delete from the
    // current sequence, then continue reconciling at the same target index.
    yield ["delete", dimension, currentIdx]
    currentIdx--
  }
}

/**
 * Execute a stream of planned ops in ordered batches, respecting configured
 * batch-size and payload-size guardrails.
 *
 * Intent:
 * - keep API call count low for real integrations
 * - preserve operation order exactly (index-sensitive mutations)
 * - optionally collect benchmark-only timing counters with `profile`
 *
 * @param {GoogleSheetsApi} api API adapter used by the challenge solution.
 * @param {string} spreadsheetId Spreadsheet identifier passed to `performOps`.
 * @param {Iterable<["insert" | "delete", "row" | "column", number, number?]>} plannedOps
 *   Stream (or array) of ordered operations to execute.
 * @param {{ maxBatchOps: number, maxPayloadBytes: number }} executionLimits Normalized batch guardrails.
 * @param {Record<string, bigint | number> | null} [profile=null] Optional benchmark-only metrics collector.
 * @returns {Promise<void>}
 */
async function executeInBatches(api, spreadsheetId, plannedOps, { maxBatchOps, maxPayloadBytes }, profile = null) {
  // When profiling is enabled, these buckets are intended for diagnosis, not
  // for additive accounting. For example, `apiAwaitNs` includes time spent in
  // the mock's synchronous apply path when the benchmark calls the in-memory
  // mock directly.
  const executeStart = profile ? process.hrtime.bigint() : 0n
  let batch = []
  let batchBytes = 0
  let opCount = 0
  const iterator = plannedOps[Symbol.iterator]()

  while (true) {
    // `reconcileNs` measures iterator advancement / op generation only.
    const reconcileStart = profile ? process.hrtime.bigint() : 0n
    const next = iterator.next()
    if (profile) {
      profile.reconcileNs = (profile.reconcileNs ?? 0n) + (process.hrtime.bigint() - reconcileStart)
    }

    if (next.done) {
      break
    }

    const op = next.value
    opCount += 1
    if (profile) {
      if (op[0] === "insert") {
        profile.insertOps = (profile.insertOps ?? 0) + 1
      } else {
        profile.deleteOps = (profile.deleteOps ?? 0) + 1
      }
    }

    // `estimateNs` isolates payload-size accounting from reconciliation logic.
    const estimateStart = profile ? process.hrtime.bigint() : 0n
    const opBytes = estimateOpBytes(op)
    if (profile) {
      profile.estimateNs = (profile.estimateNs ?? 0n) + (process.hrtime.bigint() - estimateStart)
      profile.estimatedPayloadBytes = (profile.estimatedPayloadBytes ?? 0) + opBytes
    }
    const batchFull = batch.length >= maxBatchOps
    const payloadFull =
      maxPayloadBytes > 0 && batch.length > 0 && batchBytes + opBytes > maxPayloadBytes

    // Flush before adding the next op when either guardrail would be exceeded.
    if (batchFull || payloadFull) {
      // Await time here is usually tiny with real batching, but in the local
      // benchmark it also includes synchronous in-memory mutation time.
      const flushStart = profile ? process.hrtime.bigint() : 0n
      await api.performOps(spreadsheetId, batch)
      if (profile) {
        profile.apiAwaitNs = (profile.apiAwaitNs ?? 0n) + (process.hrtime.bigint() - flushStart)
        profile.apiFlushes = (profile.apiFlushes ?? 0) + 1
      }
      batch = []
      batchBytes = 0
    }

    batch.push(op)
    batchBytes += opBytes
  }

  if (batch.length > 0) {
    // Preserve operation order: the final partial batch must be flushed last.
    const flushStart = profile ? process.hrtime.bigint() : 0n
    await api.performOps(spreadsheetId, batch)
    if (profile) {
      profile.apiAwaitNs = (profile.apiAwaitNs ?? 0n) + (process.hrtime.bigint() - flushStart)
      profile.apiFlushes = (profile.apiFlushes ?? 0) + 1
    }
  }

  if (profile) {
    profile.executeLoopNs = (profile.executeLoopNs ?? 0n) + (process.hrtime.bigint() - executeStart)
    profile.streamedOps = (profile.streamedOps ?? 0) + opCount
  }
}

/**
 * Normalize caller-provided execution options into validated integers used by
 * the batching executor.
 *
 * Intent:
 * - keep `updateSpreadsheet` tolerant of missing/invalid tuning values
 * - centralize defaults/validation in one place
 *
 * @param {ExecutionOptions | undefined} executionOptions Optional caller tuning.
 * @returns {{ maxBatchOps: number, maxPayloadBytes: number }} Normalized execution limits.
 */
function normalizeExecutionOptions(executionOptions) {
  return {
    maxBatchOps: normalizePositiveInt(executionOptions.maxBatchOps, DEFAULT_EXECUTION_OPTIONS.maxBatchOps),
    maxPayloadBytes: normalizeNonNegativeInt(
      executionOptions.maxPayloadBytes,
      DEFAULT_EXECUTION_OPTIONS.maxPayloadBytes
    ),
  }
}

/**
 * Coerce a value into a positive integer, or fall back when invalid.
 *
 * Intent:
 * - guarantee `maxBatchOps >= 1`
 *
 * @param {unknown} value Candidate value from caller input.
 * @param {number} fallback Default value to use when `value` is invalid.
 * @returns {number} A positive integer.
 */
function normalizePositiveInt(value, fallback) {
  if (!Number.isFinite(value)) {
    return fallback
  }
  return Math.max(1, Math.floor(value))
}

/**
 * Coerce a value into a non-negative integer, or fall back when invalid.
 *
 * Intent:
 * - allow `0` as a special value to disable payload-size guardrails in local
 *   benchmarks while keeping production defaults positive
 *
 * @param {unknown} value Candidate value from caller input.
 * @param {number} fallback Default value to use when `value` is invalid.
 * @returns {number} A non-negative integer.
 */
function normalizeNonNegativeInt(value, fallback) {
  if (!Number.isFinite(value)) {
    return fallback
  }
  return Math.max(0, Math.floor(value))
}

/**
 * Estimate the serialized JSON byte size of a single op tuple without building
 * a JSON string for every operation.
 *
 * Intent:
 * - keep payload-size batching checks cheap on large workloads
 * - provide a stable approximation for ASCII-only op tuples
 *
 * @param {["insert" | "delete", "row" | "column", number, number?]} op Operation tuple.
 * @returns {number} Estimated serialized byte size for the op tuple.
 */
function estimateOpBytes(op) {
  // Payloads are ASCII-only and op shapes are fixed, so we can estimate JSON
  // size without allocating a string for every operation.
  if (op[0] === "insert") {
    const base = op[1] === "row" ? 18 : 21
    return base + digitCount(op[2]) + digitCount(op[3])
  }

  const base = op[1] === "row" ? 17 : 20
  return base + digitCount(op[2])
}

/**
 * Count decimal digits for a non-negative integer.
 *
 * Intent:
 * - support cheap payload-size estimation without string allocations
 *
 * @param {number} value Non-negative integer value.
 * @returns {number} Decimal digit count.
 */
function digitCount(value) {
  if (value < 10) {
    return 1
  }

  let digits = 0
  let n = value
  while (n > 0) {
    n = Math.floor(n / 10)
    digits++
  }

  return digits
}

/**
 * Check whether a value can be used as the optional benchmark profile
 * collector.
 *
 * Intent:
 * - keep profiling hooks opt-in and safe to ignore in normal production usage
 *
 * @param {unknown} value Candidate profile collector.
 * @returns {value is Record<string, bigint | number>} True when the value is an object collector.
 */
function isProfileCollector(value) {
  return value !== null && typeof value === "object"
}
