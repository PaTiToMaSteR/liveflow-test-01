import GoogleSheetsApi from "./GoogleSheetsApi.js"

// Engineering guardrails for batching. Google Sheets API docs recommend keeping
// payloads around ~2 MB for reliability; we keep a safety margin below that.
const DEFAULT_EXECUTION_OPTIONS = Object.freeze({
  maxBatchOps: 500,
  maxPayloadBytes: 1_500_000,
})

/**
 *
 * @param {GoogleSheetsApi} api
 * @param {string} spreadsheetId
 * @param {Object} current - { columns: (number | null)[]], rows: (number | null)[]}
 * @param {Object} target - { columns: (number | null)[]], rows: (number | null)[]}
 * @param {Object} [executionOptions] - Optional local execution tuning.
 */
export default async function updateSpreadsheet(
  api,
  spreadsheetId,
  current,
  target,
  executionOptions = {}
) {
  const execOptions = normalizeExecutionOptions(executionOptions)
  const dimensions = [
    ["column", current.columns, target.columns],
    ["row", current.rows, target.rows],
  ]

  for (const [dim, currentIds, targetIds] of dimensions) {
    const plannedOps = diffDimension(dim, currentIds, targetIds)
    await executeInBatches(api, spreadsheetId, plannedOps, execOptions)
  }
}

function diffDimension(dim, currentIds, targetIds) {
  // Reverse traversal keeps emitted insert/delete indices stable as ops are
  // applied in order. This is the same invariant as the original algorithm.
  const ops = []
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
      ops.push(["insert", dim, 0, targetId])
      targetIdx--
      continue
    }

    // Target exhausted: anything remaining in current must be deleted, except
    // user-defined placeholders (`null`) which we never delete.
    if (targetIdx < 0) {
      if (currentId !== null) {
        ops.push(["delete", dim, currentIdx])
      }
      currentIdx--
      continue
    }

    // `null` is a user placeholder. We cannot delete it, so we insert the
    // target id around it and let future iterations align placeholders.
    if (currentId === null) {
      ops.push(["insert", dim, currentIdx + 1, targetId])
      targetIdx--
      continue
    }

    ops.push(["delete", dim, currentIdx])
    currentIdx--
  }

  return ops
}

async function executeInBatches(api, spreadsheetId, allOps, { maxBatchOps, maxPayloadBytes }) {
  let batch = []
  let batchBytes = 0

  for (const op of allOps) {
    const opBytes = estimateOpBytes(op)
    const batchFull = batch.length >= maxBatchOps
    const payloadFull = maxPayloadBytes > 0 && batch.length > 0 && batchBytes + opBytes > maxPayloadBytes

    if (batchFull || payloadFull) {
      await api.performOps(spreadsheetId, batch)
      batch = []
      batchBytes = 0
    }

    batch.push(op)
    batchBytes += opBytes
  }

  if (batch.length > 0) {
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
  // Operation payloads here are ASCII-only (action/dimension strings + numbers),
  // so string length is a good proxy for byte size and keeps this helper runtime-agnostic.
  return JSON.stringify(op).length
}
