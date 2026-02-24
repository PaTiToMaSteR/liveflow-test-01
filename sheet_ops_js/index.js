import GoogleSheetsApi from "./GoogleSheetsApi.js"

// Engineering guardrails for batching. Google Sheets API docs recommend keeping
// payloads around ~2 MB for reliability; we keep a safety margin below that.
const DEFAULT_EXECUTION_OPTIONS = Object.freeze({
  maxBatchOps: 500,
  maxPayloadBytes: 1_500_000,
})

/**
 * Update columns first, then rows, preserving the challenge contract while
 * batching API calls for better real-world behavior.
 *
 * Designed with pure functional stream transformations.
 */
export default async function updateSpreadsheet(
  api,
  spreadsheetId,
  current,
  target,
  executionOptions = {}
) {
  const execOpts = normalizeExecutionOptions(executionOptions)
  const profile = isProfileCollector(executionOptions?.profile) ? executionOptions.profile : null

  const processDimension = async (dimension, currentIds, targetIds) => {
    if (profile) profile.dimensionPasses = (profile.dimensionPasses || 0) + 1

    // 1. Generate lazy diff ops stream functionally
    const opsStream = unfoldOps(dimension, currentIds, targetIds, profile)
    
    // 2. Tap profile metrics without mutating the stream directly
    const metricOpsStream = profile 
      ? tapStream(opsStream, op => {
          profile.streamedOps = (profile.streamedOps || 0) + 1
          profile[op[0] === "insert" ? "insertOps" : "deleteOps"] = (profile[op[0] === "insert" ? "insertOps" : "deleteOps"] || 0) + 1
        }) 
      : opsStream

    // 3. Transform basic operations sequence into batched subsets stream
    const batchStream = chunkStream(metricOpsStream, execOpts.maxBatchOps, execOpts.maxPayloadBytes, profile)
    
    // 4. Drive the lazy state machine
    for (const batch of batchStream) {
      const waitStart = profile ? process.hrtime.bigint() : 0n
      await api.performOps(spreadsheetId, batch)
      if (profile) {
        profile.apiAwaitNs = (profile.apiAwaitNs || 0n) + (process.hrtime.bigint() - waitStart)
        profile.apiFlushes = (profile.apiFlushes || 0) + 1
      }
    }
  }

  const execStart = profile ? process.hrtime.bigint() : 0n

  await processDimension("column", current.columns, target.columns)
  await processDimension("row", current.rows, target.rows)

  if (profile) {
    profile.executeLoopNs = (profile.executeLoopNs || 0n) + (process.hrtime.bigint() - execStart)
  }
}

/**
 * A pure function representing a single step in the state machine.
 * Returns { op, nextState } or null when traversal ends.
 * Keeps recursion/iteration pure by abstracting away mutation of pointer variables.
 */
function nextDiffState(dimension, currentIds, targetIds, { currentIdx, targetIdx }) {
  if (currentIdx < 0 && targetIdx < 0) return null

  const currentId = currentIdx >= 0 ? currentIds[currentIdx] : undefined
  const targetId = targetIdx >= 0 ? targetIds[targetIdx] : undefined

  // Match: move back both sequences safely, yielding no operation
  if (currentId !== undefined && targetId !== undefined && currentId === targetId) {
    return {
      op: null,
      nextState: { currentIdx: currentIdx - 1, targetIdx: targetIdx - 1 }
    }
  }

  // Exhausted current: map the rest of target to insertions (except un-insertable nulls)
  if (currentId === undefined) {
    return targetId === null
      ? { op: null, nextState: { currentIdx, targetIdx: targetIdx - 1 } }
      : { op: ["insert", dimension, 0, targetId], nextState: { currentIdx, targetIdx: targetIdx - 1 } }
  }

  // Exhausted target: simply delete remaining known items
  if (targetId === undefined) {
    return currentId !== null
      ? { op: ["delete", dimension, currentIdx], nextState: { currentIdx: currentIdx - 1, targetIdx } }
      : { op: null, nextState: { currentIdx: currentIdx - 1, targetIdx } }
  }

  // Current id is null (user-added component) -> wrap the target value around it by passing through
  if (currentId === null) {
    return {
      op: ["insert", dimension, currentIdx + 1, targetId],
      nextState: { currentIdx, targetIdx: targetIdx - 1 }
    }
  }

  // Standard mismatch -> Delete the known item to re-align
  return {
    op: ["delete", dimension, currentIdx],
    nextState: { currentIdx: currentIdx - 1, targetIdx }
  }
}

/**
 * Yields operations from `nextDiffState` as a lazy stream.
 *
 * When a `profile` collector is provided (benchmark-only), the generator records
 * time spent evaluating the diff transition function into `reconcileNs`.
 */
function* unfoldOps(dimension, currentIds, targetIds, profile = null) {
  let state = { currentIdx: currentIds.length - 1, targetIdx: targetIds.length - 1 }
  while (true) {
    const stepStart = profile ? process.hrtime.bigint() : 0n
    const result = nextDiffState(dimension, currentIds, targetIds, state)
    if (profile) {
      profile.reconcileNs = (profile.reconcileNs || 0n) + (process.hrtime.bigint() - stepStart)
    }
    if (!result) break
    if (result.op) yield result.op
    state = result.nextState
  }
}

/**
 * Generic lazy transformer that chunks bounded sub-arrays logic.
 *
 * When a `profile` collector is provided (benchmark-only), the generator records
 * payload estimation time into `estimateNs` and the estimated op bytes into
 * `estimatedPayloadBytes`.
 */
function* chunkStream(iterable, maxBatchOps, maxPayloadBytes, profile = null) {
  let batch = []
  let bytes = 0

  for (const item of iterable) {
    const estimateStart = profile ? process.hrtime.bigint() : 0n
    const itemBytes = estimateOpBytes(item)
    if (profile) {
      profile.estimateNs = (profile.estimateNs || 0n) + (process.hrtime.bigint() - estimateStart)
      profile.estimatedPayloadBytes = (profile.estimatedPayloadBytes || 0) + itemBytes
    }
    const wouldExceedSize = maxPayloadBytes > 0 && batch.length > 0 && (bytes + itemBytes > maxPayloadBytes)
    const wouldExceedCount = batch.length >= maxBatchOps

    if (wouldExceedCount || wouldExceedSize) {
      yield batch
      batch = []
      bytes = 0
    }

    batch.push(item)
    bytes += itemBytes
  }

  if (batch.length > 0) yield batch
}

/**
 * Functional stream utility. Taps side-effects invisibly onto a sequence lazily.
 */
function* tapStream(iterable, tapFn) {
  for (const item of iterable) {
    tapFn(item)
    yield item
  }
}

function normalizeExecutionOptions(executionOptions) {
  return {
    maxBatchOps: normalizePositiveInt(executionOptions?.maxBatchOps, DEFAULT_EXECUTION_OPTIONS.maxBatchOps),
    maxPayloadBytes: normalizeNonNegativeInt(
      executionOptions?.maxPayloadBytes,
      DEFAULT_EXECUTION_OPTIONS.maxPayloadBytes
    ),
  }
}

function normalizePositiveInt(value, fallback) {
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.floor(value))
}

function normalizeNonNegativeInt(value, fallback) {
  if (!Number.isFinite(value)) return fallback
  return Math.max(0, Math.floor(value))
}

function estimateOpBytes(op) {
  if (op[0] === "insert") {
    const base = op[1] === "row" ? 18 : 21
    return base + digitCount(op[2]) + digitCount(op[3])
  }
  const base = op[1] === "row" ? 17 : 20
  return base + digitCount(op[2])
}

function digitCount(value) {
  if (value < 10) return 1
  let digits = 0
  let n = value
  while (n > 0) {
    n = Math.floor(n / 10)
    digits++
  }
  return digits
}

function isProfileCollector(value) {
  return value !== null && typeof value === "object"
}
