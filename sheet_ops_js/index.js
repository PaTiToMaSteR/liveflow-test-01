import GoogleSheetsApi from "./GoogleSheetsApi.js"

// Engineering guardrails for batching. Google Sheets API docs recommend keeping
// payloads around ~2 MB for reliability; we keep a safety margin below that.
const DEFAULT_EXECUTION_OPTIONS = Object.freeze({
  maxBatchOps: 500,
  maxPayloadBytes: 1_500_000,
})

/**
 * @typedef {{ columns: (number | null)[], rows: (number | null)[] }} SpreadsheetState
 * @typedef {{ maxBatchOps?: number, maxPayloadBytes?: number }} ExecutionOptions
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
  // Dimension order matters because row/column indices are independent and the
  // challenge examples/process assume the two passes are executed separately.
  const dimensions = [
    ["column", current.columns, target.columns],
    ["row", current.rows, target.rows],
  ]

  for (const [dimension, currentIds, targetIds] of dimensions) {
    const plannedOps = diffDimensionOps(dimension, currentIds, targetIds)
    await executeInBatches(api, spreadsheetId, plannedOps, execOptions)
  }
}

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

async function executeInBatches(api, spreadsheetId, plannedOps, { maxBatchOps, maxPayloadBytes }) {
  let batch = []
  let batchBytes = 0

  for (const op of plannedOps) {
    const opBytes = estimateOpBytes(op)
    const batchFull = batch.length >= maxBatchOps
    const payloadFull =
      maxPayloadBytes > 0 && batch.length > 0 && batchBytes + opBytes > maxPayloadBytes

    // Flush before adding the next op when either guardrail would be exceeded.
    if (batchFull || payloadFull) {
      await api.performOps(spreadsheetId, batch)
      batch = []
      batchBytes = 0
    }

    batch.push(op)
    batchBytes += opBytes
  }

  if (batch.length > 0) {
    // Preserve operation order: the final partial batch must be flushed last.
    await api.performOps(spreadsheetId, batch)
  }
}

function normalizeExecutionOptions(executionOptions) {
  return {
    maxBatchOps: normalizePositiveInt(executionOptions.maxBatchOps, DEFAULT_EXECUTION_OPTIONS.maxBatchOps),
    maxPayloadBytes: normalizeNonNegativeInt(
      executionOptions.maxPayloadBytes,
      DEFAULT_EXECUTION_OPTIONS.maxPayloadBytes
    ),
  }
}

function normalizePositiveInt(value, fallback) {
  if (!Number.isFinite(value)) {
    return fallback
  }
  return Math.max(1, Math.floor(value))
}

function normalizeNonNegativeInt(value, fallback) {
  if (!Number.isFinite(value)) {
    return fallback
  }
  return Math.max(0, Math.floor(value))
}

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
