import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import GoogleSheetsApi from "../GoogleSheetsApi.js"
import updateSpreadsheet from "../index.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, "..")

const IMPLEMENTATIONS = {
  fixed: updateSpreadsheet,
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function cloneState(state) {
  return {
    columns: [...state.columns],
    rows: [...state.rows],
  }
}

function loadLargeFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, "__tests__", "data", name), "utf8"))
}

function loadElixirFixture(name) {
  return JSON.parse(
    fs.readFileSync(path.join(projectRoot, "..", "sheet_ops_ex", "test", "data", name), "utf8")
  )
}

function buildCases() {
  return {
    empty: {
      current: { columns: [], rows: [] },
      target: { columns: [], rows: [] },
    },
    nulls: {
      current: { columns: [null, null, null], rows: [null, null, null] },
      target: { columns: [null, null, null], rows: [null, null, null] },
    },
    example1: {
      current: {
        columns: [14, null, null, null, 12, 7, 4, 13, 6, null],
        rows: [15, 14, 13, null, 8, 11, null, 7, 12, 2, null, null, 9]
      },
      target: {
        columns: [null, null, 11, 14, null, 4, null, 9, 13, 5, 7, 3],
        rows: [9, 12, 3, 13, null, null, 4, 8, 5, null, 6, null, 10]
      }
    },
    example2: {
      current: {
        columns: [8, 7, 15, null, 11, 13, 2],
        rows: [null, 2, 6, 7, 8, 1, 5]
      },
      target: {
        columns: [4, 5, null, 2, 6, 1, 8, 7],
        rows: [8, 6, 5, 7, 4, null, 1]
      }
    },
    large: {
      current: loadLargeFixture("large_current.json"),
      target: loadLargeFixture("large_target.json"),
    },
    large_elixir: {
      current: loadElixirFixture("large_current.json"),
      target: loadElixirFixture("large_target.json"),
    }
  }
}

function maxNonNullId(...dimensions) {
  let maxId = 0
  for (const values of dimensions) {
    for (const value of values) {
      if (value !== null && value > maxId) {
        maxId = value
      }
    }
  }
  return maxId
}

function repeatDimensionIds(values, repeatCount, idOffset) {
  const repeated = []
  for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex += 1) {
    const baseOffset = repeatIndex * idOffset
    for (const value of values) {
      repeated.push(value === null ? null : value + baseOffset)
    }
  }
  return repeated
}

function repeatFixture(fixture, repeatCount) {
  if (repeatCount <= 1) {
    return {
      current: cloneState(fixture.current),
      target: cloneState(fixture.target),
    }
  }

  const columnOffset = maxNonNullId(fixture.current.columns, fixture.target.columns) + 1
  const rowOffset = maxNonNullId(fixture.current.rows, fixture.target.rows) + 1

  return {
    current: {
      columns: repeatDimensionIds(fixture.current.columns, repeatCount, columnOffset),
      rows: repeatDimensionIds(fixture.current.rows, repeatCount, rowOffset),
    },
    target: {
      columns: repeatDimensionIds(fixture.target.columns, repeatCount, columnOffset),
      rows: repeatDimensionIds(fixture.target.rows, repeatCount, rowOffset),
    },
  }
}

function tryLoadPregeneratedRepeatFixture(sourceCaseName, repeatCount) {
  const prefix = `${sourceCaseName}_repeat_${repeatCount}`
  const currentPath = path.join(projectRoot, "bench", "generated", `${prefix}_current.json`)
  const targetPath = path.join(projectRoot, "bench", "generated", `${prefix}_target.json`)

  if (!fs.existsSync(currentPath) || !fs.existsSync(targetPath)) {
    return null
  }

  return {
    current: JSON.parse(fs.readFileSync(currentPath, "utf8")),
    target: JSON.parse(fs.readFileSync(targetPath, "utf8")),
  }
}

function addGeneratedLargeCases(allCases, { largeRepeat, largeElixirRepeat, usePregeneratedRepeat }) {
  if (largeRepeat > 1) {
    allCases.large_repeat =
      (usePregeneratedRepeat ? tryLoadPregeneratedRepeatFixture("large", largeRepeat) : null) ??
      repeatFixture(allCases.large, largeRepeat)
  }

  if (largeElixirRepeat > 1) {
    allCases.large_elixir_repeat =
      (usePregeneratedRepeat ? tryLoadPregeneratedRepeatFixture("large_elixir", largeElixirRepeat) : null) ??
      repeatFixture(allCases.large_elixir, largeElixirRepeat)
  }
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) {
    return 0n
  }

  const lastIndex = sortedValues.length - 1
  const index = Math.floor((lastIndex * p) / 100)
  return sortedValues[index]
}

function formatMs(ns) {
  return (Number(ns) / 1_000_000).toFixed(3)
}

function digitCount(value) {
  if (value < 10) {
    return 1
  }

  let digits = 0
  let n = value
  while (n > 0) {
    n = Math.floor(n / 10)
    digits += 1
  }
  return digits
}

function estimateIdsArrayJsonBytes(values) {
  let bytes = 2

  for (let i = 0; i < values.length; i += 1) {
    if (i > 0) {
      bytes += 1
    }
    bytes += values[i] === null ? 4 : digitCount(values[i])
  }

  return bytes
}

function estimateStateJsonBytes(state) {
  return 20 + estimateIdsArrayJsonBytes(state.columns) + estimateIdsArrayJsonBytes(state.rows)
}

function formatByteSize(bytes) {
  return `${bytes} B (${(bytes / 1_000_000).toFixed(3)} MB, ${(bytes / 1024 / 1024).toFixed(3)} MiB)`
}

function printFixtureSizes(selectedCases) {
  console.log("Fixture sizes (pre-run, before measured timing):")

  for (const [caseName, fixture] of Object.entries(selectedCases)) {
    const currentBytes = estimateStateJsonBytes(fixture.current)
    const targetBytes = estimateStateJsonBytes(fixture.target)
    const combinedBytes = currentBytes + targetBytes

    console.log(
      `  ${caseName}: current=${formatByteSize(currentBytes)}, target=${formatByteSize(targetBytes)}, combined=${formatByteSize(combinedBytes)}`
    )
    console.log(
      `      currentLens(columns=${fixture.current.columns.length}, rows=${fixture.current.rows.length}), ` +
      `targetLens(columns=${fixture.target.columns.length}, rows=${fixture.target.rows.length})`
    )
  }
}

function safeStringify(value) {
  return JSON.stringify(value)
}

function summarizeDimensionDistance(actual, target) {
  const maxLen = Math.max(actual.length, target.length)
  let positionalMismatches = 0
  let firstMismatch = null

  for (let i = 0; i < maxLen; i += 1) {
    const actualValue = actual[i]
    const targetValue = target[i]
    if (actualValue !== targetValue) {
      positionalMismatches += 1
      if (firstMismatch === null) {
        firstMismatch = { index: i, actual: actualValue, target: targetValue }
      }
    }
  }

  return {
    lengthActual: actual.length,
    lengthTarget: target.length,
    lengthDelta: actual.length - target.length,
    positionalMismatches,
    firstMismatch,
  }
}

function summarizeDistance(actualState, targetState) {
  const columns = summarizeDimensionDistance(actualState.columns, targetState.columns)
  const rows = summarizeDimensionDistance(actualState.rows, targetState.rows)

  return {
    score: columns.positionalMismatches + rows.positionalMismatches,
    columns,
    rows,
  }
}

function formatDistanceSummary(distance) {
  return [
    `columns: mismatches=${distance.columns.positionalMismatches}, lenDelta=${distance.columns.lengthDelta}, first=${mismatchText(distance.columns.firstMismatch)}`,
    `rows: mismatches=${distance.rows.positionalMismatches}, lenDelta=${distance.rows.lengthDelta}, first=${mismatchText(distance.rows.firstMismatch)}`
  ].join("; ")
}

function mismatchText(mismatch) {
  if (!mismatch) {
    return "none"
  }

  return `[${mismatch.index}] actual=${safeStringify(mismatch.actual)} target=${safeStringify(mismatch.target)}`
}

function parseOp([action, dimension, index, value]) {
  return {
    action,
    dimension,
    index,
    value,
  }
}

function describeOps(ops) {
  return ops
    .map(([action, dimension, index, value]) => {
      if (action === "insert") {
        return `${action} ${dimension} @${index}=${safeStringify(value)}`
      }
      return `${action} ${dimension} @${index}`
    })
    .join(" | ")
}

class InstrumentedGoogleSheetsApiMock extends GoogleSheetsApi {
  constructor({
    label,
    targetState,
    trace = false,
    traceCallLimit = 15,
    progressEvery = 0,
    strictRules = false,
    asyncDelayMs = 0,
    collectTimingBreakdown = false,
    applyMode = "splice",
  }) {
    super()
    this.label = label
    this.targetState = cloneState(targetState)
    this.trace = trace
    this.traceCallLimit = traceCallLimit
    this.progressEvery = progressEvery
    this.strictRules = strictRules
    this.asyncDelayMs = asyncDelayMs
    this.collectTimingBreakdown = collectTimingBreakdown
    this.applyMode = applyMode

    this.spreadsheets = {}
    this.opsCount = 0
    this.apiCallCount = 0
    this.maxBatchSize = 0
    this._pending = new Set()
    // Breakdown-only timers (enabled via BREAKDOWN=1). These are disabled in
    // normal benchmark runs because per-op timers materially distort totals.
    this.applyTotalNs = 0n
    this.spliceTotalNs = 0n
    this.progressLogTotalNs = 0n
    this.rebuildApplyTotalNs = 0n
  }

  addSpreadsheet(spreadsheetId, { columns, rows }) {
    this.spreadsheets[spreadsheetId] = {
      columns: [...columns],
      rows: [...rows],
    }
  }

  fetchSpreadsheetState(spreadsheetId) {
    const spreadsheet = this.spreadsheets[spreadsheetId]
    if (!spreadsheet) {
      throw new Error(`Spreadsheet ${spreadsheetId} not found`)
    }
    return spreadsheet
  }

  async drainPending() {
    while (this._pending.size > 0) {
      await Promise.allSettled([...this._pending])
    }
  }

  performOps(spreadsheetId, ops) {
    this.apiCallCount += 1
    this.maxBatchSize = Math.max(this.maxBatchSize, ops.length)

    if (this.asyncDelayMs > 0) {
      const promise = (async () => {
        await sleep(this.asyncDelayMs)
        this.#applyOps(spreadsheetId, ops)
      })()

      this.#trackPending(promise)
      return promise
    }

    this.#applyOps(spreadsheetId, ops)
    return Promise.resolve()
  }

  #trackPending(promise) {
    this._pending.add(promise)
    promise.finally(() => {
      this._pending.delete(promise)
    })
  }

  #applyOps(spreadsheetId, ops) {
    const collectTimingBreakdown = this.collectTimingBreakdown
    const applyStart = collectTimingBreakdown ? process.hrtime.bigint() : 0n
    const spreadsheet = this.fetchSpreadsheetState(spreadsheetId)
    const parsedOps = ops.map(parseOp)

    if (this.applyMode === "batch_rebuild" && !this.strictRules && this.#canUseBatchRebuild(parsedOps)) {
      const rebuildStart = collectTimingBreakdown ? process.hrtime.bigint() : 0n
      this.#applyOpsByBatchRebuild(spreadsheet, parsedOps)
      this.opsCount += parsedOps.length
      if (collectTimingBreakdown) {
        this.rebuildApplyTotalNs += process.hrtime.bigint() - rebuildStart
      }
    } else {
      for (const op of parsedOps) {
        this.#validateOp(spreadsheet, op)
        this.#applySingleOp(spreadsheet, op)
        this.opsCount += 1
      }
    }

    const progressStart = collectTimingBreakdown ? process.hrtime.bigint() : 0n
    this.#maybeLogProgress(spreadsheetId, ops)
    if (collectTimingBreakdown) {
      this.progressLogTotalNs += process.hrtime.bigint() - progressStart
      this.applyTotalNs += process.hrtime.bigint() - applyStart
    }
  }

  #validateOp(spreadsheet, op) {
    if (!this.strictRules) {
      return
    }

    const values = spreadsheet[op.dimension + "s"]

    if (op.action === "insert" && op.value === null) {
      throw new Error(`Invalid insert: ${op.dimension} id cannot be null (index=${op.index})`)
    }

    if (op.action === "delete" && values[op.index] === null) {
      throw new Error(`Invalid delete: cannot delete user-defined ${op.dimension} at index ${op.index}`)
    }
  }

  #applySingleOp(spreadsheet, op) {
    const collectTimingBreakdown = this.collectTimingBreakdown
    const spliceStart = collectTimingBreakdown ? process.hrtime.bigint() : 0n
    switch (op.action) {
      case "delete":
        spreadsheet[op.dimension + "s"].splice(op.index, 1)
        if (collectTimingBreakdown) {
          this.spliceTotalNs += process.hrtime.bigint() - spliceStart
        }
        return
      case "insert":
        spreadsheet[op.dimension + "s"].splice(op.index, 0, op.value)
        if (collectTimingBreakdown) {
          this.spliceTotalNs += process.hrtime.bigint() - spliceStart
        }
        return
      default:
        throw new Error(`Unknown action: ${op.action}`)
    }
  }

  #canUseBatchRebuild(parsedOps) {
    const lastIndexByDimension = {
      row: Number.POSITIVE_INFINITY,
      column: Number.POSITIVE_INFINITY,
    }

    for (const op of parsedOps) {
      if (op.index > lastIndexByDimension[op.dimension]) {
        return false
      }
      lastIndexByDimension[op.dimension] = op.index
    }

    return true
  }

  #applyOpsByBatchRebuild(spreadsheet, parsedOps) {
    const rowOps = []
    const columnOps = []

    for (const op of parsedOps) {
      if (op.dimension === "row") {
        rowOps.push(op)
      } else {
        columnOps.push(op)
      }
    }

    if (columnOps.length > 0) {
      spreadsheet.columns = applyDimensionOpsByRebuild(spreadsheet.columns, columnOps)
    }

    if (rowOps.length > 0) {
      spreadsheet.rows = applyDimensionOpsByRebuild(spreadsheet.rows, rowOps)
    }
  }

  #maybeLogProgress(spreadsheetId, ops) {
    const shouldTrace = this.trace && this.apiCallCount <= this.traceCallLimit
    const shouldCheckpoint = this.progressEvery > 0 && this.apiCallCount % this.progressEvery === 0

    if (!shouldTrace && !shouldCheckpoint) {
      return
    }

    const state = this.fetchSpreadsheetState(spreadsheetId)
    const distance = summarizeDistance(state, this.targetState)
    const prefix = `[${this.label}] call=${this.apiCallCount} opsTotal=${this.opsCount}`

    if (shouldTrace) {
      console.log(`${prefix} | ${describeOps(ops)}`)
      console.log(`      progress: ${formatDistanceSummary(distance)}`)
      return
    }

    console.log(`${prefix} checkpoint | ${formatDistanceSummary(distance)}`)
  }
}

class BatchingQuotaApi {
  constructor(innerApi, options = {}) {
    this.innerApi = innerApi
    this.maxBatchOps = options.maxBatchOps || 1
    this.maxPayloadBytes = options.maxPayloadBytes || 0
    this.quotaWritesPerWindow = options.quotaWritesPerWindow || 0
    this.quotaWindowMs = options.quotaWindowMs || 60_000
    this.backoffBaseMs = options.backoffBaseMs || 50
    this.backoffMaxRetries = options.backoffMaxRetries || 0
    this.traceBatching = Boolean(options.traceBatching)

    this.pendingOps = []
    this.pendingPayloadBytes = 0
    this.windowStartedAt = Date.now()
    this.windowWrites = 0

    this.bufferedCalls = 0
    this.flushCount = 0
    this.retryCount = 0
    this.throttle429Count = 0
    this.totalBackoffMs = 0
    this.maxFlushPayloadBytes = 0
    this.totalBatchProcessingNs = 0n
  }

  async performOps(spreadsheetId, ops) {
    this.bufferedCalls += 1

    for (const op of ops) {
      const opBytes = estimateOpBytes(op)
      const wouldExceedBatchOps = this.maxBatchOps > 0 && this.pendingOps.length >= this.maxBatchOps
      const wouldExceedPayload =
        this.maxPayloadBytes > 0 &&
        this.pendingOps.length > 0 &&
        this.pendingPayloadBytes + opBytes > this.maxPayloadBytes

      if (wouldExceedBatchOps || wouldExceedPayload) {
        await this.flush(spreadsheetId)
      }

      this.pendingOps.push(op)
      this.pendingPayloadBytes += opBytes
    }
  }

  async flush(spreadsheetId) {
    if (this.pendingOps.length === 0) {
      return
    }

    const batch = this.pendingOps
    const payloadBytes = this.pendingPayloadBytes
    this.pendingOps = []
    this.pendingPayloadBytes = 0

    this.maxFlushPayloadBytes = Math.max(this.maxFlushPayloadBytes, payloadBytes)

    if (this.traceBatching) {
      console.log(
        `[batching] flushing batch ops=${batch.length} estBytes=${payloadBytes} bufferedCalls=${this.bufferedCalls}`
      )
    }

    let attempt = 0
    while (true) {
      try {
        this.#consumeQuota()
        this.flushCount += 1
        const batchStart = process.hrtime.bigint()
        await this.innerApi.performOps(spreadsheetId, batch)
        this.totalBatchProcessingNs += process.hrtime.bigint() - batchStart
        return
      } catch (error) {
        if (!isQuotaError(error) || attempt >= this.backoffMaxRetries) {
          throw error
        }

        this.retryCount += 1
        this.throttle429Count += 1
        const delayMs = this.backoffBaseMs * (2 ** attempt)
        this.totalBackoffMs += delayMs

        if (this.traceBatching) {
          console.log(
            `[batching] 429 retry attempt=${attempt + 1}/${this.backoffMaxRetries} delayMs=${delayMs}`
          )
        }

        await sleep(delayMs)
        attempt += 1
      }
    }
  }

  async drainPending(spreadsheetId) {
    await this.flush(spreadsheetId)
    if (typeof this.innerApi.drainPending === "function") {
      await this.innerApi.drainPending()
    }
  }

  #consumeQuota() {
    if (this.quotaWritesPerWindow <= 0) {
      return
    }

    const now = Date.now()
    if (now - this.windowStartedAt >= this.quotaWindowMs) {
      this.windowStartedAt = now
      this.windowWrites = 0
    }

    if (this.windowWrites >= this.quotaWritesPerWindow) {
      const error = new Error("429 Too Many Requests (simulated write quota)")
      error.code = 429
      error.status = 429
      throw error
    }

    this.windowWrites += 1
  }
}

function estimateOpBytes(op) {
  return Buffer.byteLength(JSON.stringify(op), "utf8")
}

function applyDimensionOpsByRebuild(sourceValues, ops) {
  if (ops.length === 0) {
    return sourceValues
  }

  const pieces = []
  let tail = sourceValues.length

  for (const op of ops) {
    if (op.action === "delete") {
      if (op.index + 1 < tail) {
        pieces.push(sourceValues.slice(op.index + 1, tail))
      }
      tail = op.index
      continue
    }

    if (op.index < tail) {
      pieces.push(sourceValues.slice(op.index, tail))
    }
    pieces.push([op.value])
    tail = op.index
  }

  const result = sourceValues.slice(0, tail)
  for (let i = pieces.length - 1; i >= 0; i -= 1) {
    const piece = pieces[i]
    for (let j = 0; j < piece.length; j += 1) {
      result.push(piece[j])
    }
  }

  return result
}

function isQuotaError(error) {
  return error?.status === 429 || error?.code === 429 || /429/.test(String(error?.message))
}

function isPromiseLike(value) {
  return value !== null && typeof value === "object" && typeof value.then === "function"
}

function assertStateEquals(actual, expected, label) {
  try {
    assert.deepStrictEqual(actual, expected)
    return null
  } catch (error) {
    return new Error(`${label}: final state mismatch`)
  }
}

async function runSingle(label, impl, fixture, runOptions) {
  const mock = new InstrumentedGoogleSheetsApiMock({
    label,
    targetState: fixture.target,
    trace: runOptions.trace,
    traceCallLimit: runOptions.traceCallLimit,
    progressEvery: runOptions.progressEvery,
    strictRules: runOptions.strictRules,
    asyncDelayMs: runOptions.asyncDelayMs,
    collectTimingBreakdown: runOptions.collectBreakdown,
    applyMode: runOptions.mockApplyMode,
  })

  const spreadsheetId = "bench"
  const current = cloneState(fixture.current)
  const target = cloneState(fixture.target)
  const executionApi = runOptions.batchingEnabled
    ? new BatchingQuotaApi(mock, {
      maxBatchOps: runOptions.maxBatchOps,
      maxPayloadBytes: runOptions.maxPayloadBytes,
      quotaWritesPerWindow: runOptions.quotaWritesPerWindow,
      quotaWindowMs: runOptions.quotaWindowMs,
      backoffBaseMs: runOptions.backoffBaseMs,
      backoffMaxRetries: runOptions.backoffMaxRetries,
      traceBatching: runOptions.traceBatching,
    })
    : mock

  mock.addSpreadsheet(spreadsheetId, current)
  const implProfile = runOptions.collectBreakdown ? {} : null

  const start = process.hrtime.bigint()
  try {
    const result = impl(executionApi, spreadsheetId, current, target, {
      maxBatchOps: runOptions.maxBatchOps,
      maxPayloadBytes: runOptions.maxPayloadBytes,
      ...(implProfile ? { profile: implProfile } : {}),
    })
    if (isPromiseLike(result)) {
      await result
    }
    if (runOptions.batchingEnabled) {
      await executionApi.drainPending?.(spreadsheetId)
    }
  } catch (error) {
    await executionApi.drainPending?.(spreadsheetId)
    throw new Error(`${label} threw during execution: ${error.message}`)
  }
  const elapsedNs = process.hrtime.bigint() - start

  const validationStart = process.hrtime.bigint()
  const immediateState = cloneState(mock.fetchSpreadsheetState(spreadsheetId))
  const mismatchError = assertStateEquals(immediateState, fixture.target, label)

  if (mismatchError) {
    let drainsToTarget = false
    try {
      await executionApi.drainPending?.(spreadsheetId)
      const drainedState = cloneState(mock.fetchSpreadsheetState(spreadsheetId))
      drainsToTarget = assertStateEquals(drainedState, fixture.target, label) === null
    } catch (error) {
      throw new Error(`${label} failed while draining pending API calls: ${error.message}`)
    }

    const distance = summarizeDistance(immediateState, fixture.target)
    const detail = `distance(${formatDistanceSummary(distance)})`

    if (runOptions.asyncDelayMs > 0 && drainsToTarget) {
      throw new Error(
        `${label} appears to rely on synchronous side effects from api.performOps(). ` +
        `With ASYNC_DELAY_MS=${runOptions.asyncDelayMs}, the state is wrong when the function returns but becomes correct after pending calls finish. ` +
        `This usually means missing await/async handling. ${detail}`
      )
    }

    throw new Error(`${label} produced a wrong final state. ${detail}`)
  }

  if (!runOptions.batchingEnabled) {
    await executionApi.drainPending?.(spreadsheetId)
  }
  const validationNs = process.hrtime.bigint() - validationStart

  const batchingStats = executionApi instanceof BatchingQuotaApi
    ? {
      bufferedCalls: executionApi.bufferedCalls,
      flushCount: executionApi.flushCount,
      retryCount: executionApi.retryCount,
      throttle429Count: executionApi.throttle429Count,
      totalBackoffMs: executionApi.totalBackoffMs,
      maxFlushPayloadBytes: executionApi.maxFlushPayloadBytes,
      totalBatchProcessingNs: executionApi.totalBatchProcessingNs,
    }
    : null

  const mockStats = {
    applyNs: mock.applyTotalNs,
    spliceNs: mock.spliceTotalNs,
    progressLogNs: mock.progressLogTotalNs,
    rebuildApplyNs: mock.rebuildApplyTotalNs,
  }

  return {
    elapsedNs,
    validationNs,
    opsCount: mock.opsCount,
    apiCalls: mock.apiCallCount,
    maxBatchSize: mock.maxBatchSize,
    batchingStats,
    implProfile,
    mockStats,
  }
}

async function runBenchmarkForImplementation(label, impl, fixture, options) {
  console.log(`  [${label}] warmup (${options.warmup})...`)
  for (let i = 0; i < options.warmup; i += 1) {
    await runSingle(label, impl, fixture, { ...options, trace: false })
    console.log(`    warmup ${i + 1}/${options.warmup}`)
  }

  console.log(`  [${label}] measured runs (${options.iterations})...`)
  const samples = []

  for (let i = 0; i < options.iterations; i += 1) {
    const sample = await runSingle(label, impl, fixture, {
      ...options,
      trace: options.trace && i === 0,
    })

    samples.push(sample)
    console.log(
      `    run ${i + 1}/${options.iterations} - ${formatMs(sample.elapsedNs)} ms, ops=${sample.opsCount}, calls=${sample.apiCalls}, maxBatch=${sample.maxBatchSize}` +
      formatBatchingStatsInline(sample.batchingStats)
    )
  }

  const times = samples.map((s) => s.elapsedNs).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const uniqueOpsCounts = [...new Set(samples.map((s) => s.opsCount))]
  const uniqueApiCalls = [...new Set(samples.map((s) => s.apiCalls))]
  const uniqueBatchSizes = [...new Set(samples.map((s) => s.maxBatchSize))]
  const uniqueFlushCounts = [...new Set(samples.map((s) => s.batchingStats?.flushCount).filter((v) => v !== undefined))]
  const uniqueRetryCounts = [...new Set(samples.map((s) => s.batchingStats?.retryCount).filter((v) => v !== undefined))]
  const unique429Counts = [...new Set(samples.map((s) => s.batchingStats?.throttle429Count).filter((v) => v !== undefined))]
  const batchProcessingTimes = samples
    .map((s) => s.batchingStats?.totalBatchProcessingNs)
    .filter((v) => v !== undefined)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const validationTimes = samples.map((s) => s.validationNs).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const implExecuteLoopTimes = samples
    .map((s) => s.implProfile?.executeLoopNs)
    .filter((v) => typeof v === "bigint")
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const implReconcileTimes = samples
    .map((s) => s.implProfile?.reconcileNs)
    .filter((v) => typeof v === "bigint")
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const implEstimateTimes = samples
    .map((s) => s.implProfile?.estimateNs)
    .filter((v) => typeof v === "bigint")
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const implApiAwaitTimes = samples
    .map((s) => s.implProfile?.apiAwaitNs)
    .filter((v) => typeof v === "bigint")
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const mockApplyTimes = samples
    .map((s) => s.mockStats?.applyNs)
    .filter((v) => typeof v === "bigint")
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const mockSpliceTimes = samples
    .map((s) => s.mockStats?.spliceNs)
    .filter((v) => typeof v === "bigint")
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const mockProgressLogTimes = samples
    .map((s) => s.mockStats?.progressLogNs)
    .filter((v) => typeof v === "bigint")
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const mockRebuildApplyTimes = samples
    .map((s) => s.mockStats?.rebuildApplyNs)
    .filter((v) => typeof v === "bigint")
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

  return {
    label,
    iterations: options.iterations,
    times,
    uniqueOpsCounts,
    uniqueApiCalls,
    uniqueBatchSizes,
    uniqueFlushCounts,
    uniqueRetryCounts,
    unique429Counts,
    batchProcessingTimes,
    validationTimes,
    implExecuteLoopTimes,
    implReconcileTimes,
    implEstimateTimes,
    implApiAwaitTimes,
    mockApplyTimes,
    mockSpliceTimes,
    mockProgressLogTimes,
    mockRebuildApplyTimes,
  }
}

function formatBatchingStatsInline(stats) {
  if (!stats) {
    return ""
  }

  return `, flushes=${stats.flushCount}, retries=${stats.retryCount}, quota429=${stats.throttle429Count}, maxFlushBytes=${stats.maxFlushPayloadBytes}`
}

function summarizeResult(result) {
  const totalNs = result.times.reduce((acc, ns) => acc + ns, 0n)
  const sumBigInts = (values) =>
    values && values.length > 0 ? values.reduce((acc, ns) => acc + ns, 0n) : null
  const formatBigIntTotal = (values) => {
    const total = sumBigInts(values)
    return total === null ? "-" : formatMs(total)
  }

  // `loopOverheadMs` is the residual inside executeInBatches after subtracting
  // the explicit breakdown buckets we track (`algo`, `serialize`, `awaitApi`).
  let loopOverheadTotal = null
  if (
    result.implExecuteLoopTimes.length === result.implReconcileTimes.length &&
    result.implExecuteLoopTimes.length === result.implEstimateTimes.length &&
    result.implExecuteLoopTimes.length === result.implApiAwaitTimes.length &&
    result.implExecuteLoopTimes.length > 0
  ) {
    loopOverheadTotal = 0n
    for (let i = 0; i < result.implExecuteLoopTimes.length; i += 1) {
      const residual =
        result.implExecuteLoopTimes[i] -
        result.implReconcileTimes[i] -
        result.implEstimateTimes[i] -
        result.implApiAwaitTimes[i]
      loopOverheadTotal += residual > 0n ? residual : 0n
    }
  }

  return {
    minMs: formatMs(result.times[0]),
    medianMs: formatMs(percentile(result.times, 50)),
    totalMs: formatMs(totalNs),
    batchMs: result.batchProcessingTimes?.length ? formatMs(result.batchProcessingTimes.reduce((acc, ns) => acc + ns, 0n)) : "-",
    verifyMs: formatBigIntTotal(result.validationTimes),
    algoMs: formatBigIntTotal(result.implReconcileTimes),
    serializeMs: formatBigIntTotal(result.implEstimateTimes),
    awaitApiMs: formatBigIntTotal(result.implApiAwaitTimes),
    loopOverheadMs: loopOverheadTotal === null ? "-" : formatMs(loopOverheadTotal),
    mockApplyMs: formatBigIntTotal(result.mockApplyTimes),
    mockSpliceMs: formatBigIntTotal(result.mockSpliceTimes),
    mockRebuildMs: formatBigIntTotal(result.mockRebuildApplyTimes),
    mockProgressLogMs: formatBigIntTotal(result.mockProgressLogTimes),
    p95Ms: formatMs(percentile(result.times, 95)),
    maxMs: formatMs(result.times[result.times.length - 1]),
    opsCounts: result.uniqueOpsCounts,
    apiCalls: result.uniqueApiCalls,
    maxBatchSizes: result.uniqueBatchSizes,
    flushCounts: result.uniqueFlushCounts,
    retryCounts: result.uniqueRetryCounts,
    quota429Counts: result.unique429Counts,
  }
}

function printFinalTable(rows) {
  if (rows.length === 0) {
    return
  }

  const headers = ["case", "impl", "ops", "calls", "maxBatch", "flushes", "retries", "429s", "medianMs", "totalMs", "batchMs"]
  const tableRows = rows.map((row) => [
    row.caseName,
    row.impl,
    String(row.ops),
    String(row.calls),
    String(row.maxBatch),
    String(row.flushes),
    String(row.retries),
    String(row.quota429),
    row.medianMs,
    row.totalMs,
    row.batchMs,
  ])

  const widths = headers.map((header, i) =>
    Math.max(header.length, ...tableRows.map((r) => r[i].length))
  )

  const fmt = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join(" | ")
  const sep = widths.map((w) => "-".repeat(w)).join("-|-")

  console.log("\nFinal Comparison Table")
  console.log(fmt(headers))
  console.log(sep)
  for (const row of tableRows) {
    console.log(fmt(row))
  }
}

function printTimingBreakdownTable(rows) {
  if (rows.length === 0) {
    return
  }

  const headers = [
    "case",
    "impl",
    "totalMs",
    "algoMs",
    "serializeMs",
    "awaitApiMs",
    "loopOverheadMs",
    "mockApplyMs",
    "mockSpliceMs",
    "mockRebuildMs",
    "verifyMs",
  ]
  const tableRows = rows.map((row) => [
    row.caseName,
    row.impl,
    row.totalMs,
    row.algoMs,
    row.serializeMs,
    row.awaitApiMs,
    row.loopOverheadMs,
    row.mockApplyMs,
    row.mockSpliceMs,
    row.mockRebuildMs,
    row.verifyMs,
  ])

  const widths = headers.map((header, i) =>
    Math.max(header.length, ...tableRows.map((r) => r[i].length))
  )
  const fmt = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join(" | ")
  const sep = widths.map((w) => "-".repeat(w)).join("-|-")

  console.log("\nTiming Breakdown Table (totals across measured runs)")
  console.log("Note: breakdown columns are diagnostic and not additive; some buckets overlap (e.g. awaitApiMs includes mock apply time in direct mock runs).")
  console.log("Note: mockSpliceMs is usually the dominant cost for large in-memory mock cases and is not representative of real network/API latency.")
  console.log(fmt(headers))
  console.log(sep)
  for (const row of tableRows) {
    console.log(fmt(row))
  }
}

function selectCases(allCases, caseSelector) {
  if (caseSelector === "all") {
    return allCases
  }

  const fixture = allCases[caseSelector]
  if (!fixture) {
    throw new Error(`Unknown CASE=${caseSelector}. Valid values: ${Object.keys(allCases).join(", ")}, all`)
  }

  return { [caseSelector]: fixture }
}

function intEnv(name, defaultValue) {
  const raw = process.env[name]
  if (raw === undefined) {
    return defaultValue
  }

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }

  return parsed
}

function boolEnv(name, defaultValue = false) {
  const raw = process.env[name]
  if (raw === undefined) {
    return defaultValue
  }

  return ["1", "true", "yes", "on"].includes(raw.toLowerCase())
}

function parseImplementationSelection() {
  const raw = process.env.IMPL ?? "fixed"

  if (!IMPLEMENTATIONS[raw]) {
    throw new Error(`Unknown IMPL=${raw}. Valid values: ${Object.keys(IMPLEMENTATIONS).join(", ")}`)
  }

  return [[raw, IMPLEMENTATIONS[raw]]]
}

function parseBatchSweep() {
  const raw = process.env.BATCH_SWEEP
  if (!raw) {
    return null
  }

  const values = raw
    .split(",")
    .map((v) => Number.parseInt(v.trim(), 10))
    .filter((v) => Number.isFinite(v) && v > 0)

  if (values.length === 0) {
    throw new Error("BATCH_SWEEP must contain one or more positive integers, e.g. '1,500'")
  }

  return [...new Set(values)]
}

async function main() {
  const warmup = intEnv("WARMUP", 1)
  const iterations = intEnv("ITERATIONS", 3)
  const caseSelector = process.env.CASE ?? "example2"
  const trace = boolEnv("TRACE", false)
  const traceCallLimit = intEnv("TRACE_CALLS", 15)
  const progressEvery = intEnv("PROGRESS_EVERY", 0)
  const strictRules = boolEnv("STRICT_RULES", false)
  const asyncDelayMs = intEnv("ASYNC_DELAY_MS", 0)
  const batchingEnabled = boolEnv("BATCHING", false)
  const maxBatchOps = intEnv("MAX_BATCH_OPS", 100)
  const maxPayloadBytes = intEnv("MAX_PAYLOAD_BYTES", 0)
  const quotaWritesPerWindow = intEnv("QUOTA_WRITES_PER_WINDOW", 0)
  const quotaWindowMs = intEnv("QUOTA_WINDOW_MS", 60_000)
  const backoffBaseMs = intEnv("BACKOFF_BASE_MS", 50)
  const backoffMaxRetries = intEnv("BACKOFF_MAX_RETRIES", 0)
  const traceBatching = boolEnv("TRACE_BATCHING", false)
  const collectBreakdown = boolEnv("BREAKDOWN", false)
  const mockApplyMode = process.env.MOCK_APPLY_MODE ?? "splice"
  const largeRepeat = intEnv("LARGE_REPEAT", 0)
  const largeElixirRepeat = intEnv("LARGE_ELIXIR_REPEAT", 0)
  const usePregeneratedRepeat = boolEnv("USE_PREGENERATED_REPEAT", false)
  const batchSweep = parseBatchSweep()
  const implEntries = parseImplementationSelection()

  const setupStart = process.hrtime.bigint()
  const allCases = buildCases()
  addGeneratedLargeCases(allCases, { largeRepeat, largeElixirRepeat, usePregeneratedRepeat })
  const selectedCases = selectCases(allCases, caseSelector)
  const setupNs = process.hrtime.bigint() - setupStart
  const finalRows = []

  console.log("JS local benchmark: fixed implementation")
  console.log(
    `Config: CASE=${caseSelector}, IMPL=${process.env.IMPL ?? "fixed"}, WARMUP=${warmup}, ITERATIONS=${iterations}, ` +
    `TRACE=${trace}, TRACE_CALLS=${traceCallLimit}, PROGRESS_EVERY=${progressEvery}, STRICT_RULES=${strictRules}, ASYNC_DELAY_MS=${asyncDelayMs}, BREAKDOWN=${collectBreakdown}, MOCK_APPLY_MODE=${mockApplyMode}, ` +
    `BATCHING=${batchingEnabled}, MAX_BATCH_OPS=${maxBatchOps}, MAX_PAYLOAD_BYTES=${maxPayloadBytes}, ` +
    `QUOTA_WRITES_PER_WINDOW=${quotaWritesPerWindow}, QUOTA_WINDOW_MS=${quotaWindowMs}, BACKOFF_BASE_MS=${backoffBaseMs}, BACKOFF_MAX_RETRIES=${backoffMaxRetries}` +
    `${batchSweep ? `, BATCH_SWEEP=${batchSweep.join(",")}` : ""}` +
    `${largeRepeat > 1 ? `, LARGE_REPEAT=${largeRepeat}` : ""}` +
    `${largeElixirRepeat > 1 ? `, LARGE_ELIXIR_REPEAT=${largeElixirRepeat}` : ""}` +
    `${usePregeneratedRepeat ? ", USE_PREGENERATED_REPEAT=true" : ""}`
  )
  console.log("This uses a local mock (no real Google account / API calls).")
  console.log(`Setup (load/generate/select) before measured runs: ${formatMs(setupNs)} ms`)
  printFixtureSizes(selectedCases)
  if (collectBreakdown) {
    console.log("BREAKDOWN=1 is enabled: per-op timers add overhead. Use this mode for diagnostics, not for apples-to-apples throughput comparisons.")
  }
  console.log("Tip: set TRACE=1 to see per-call progress; set ASYNC_DELAY_MS=1 to expose missing await issues.\n")

  for (const [caseName, fixture] of Object.entries(selectedCases)) {
    console.log(`Running case '${caseName}'`)

    const results = {}

    const batchProfiles = batchSweep ?? [maxBatchOps]

    for (const batchOpsValue of batchProfiles) {
      for (const [label, impl] of implEntries) {
        const resultKey = batchSweep ? `${label}@batch${batchOpsValue}` : label
        const labelForRun = batchSweep ? `${label} (batch=${batchOpsValue})` : label

        results[resultKey] = await runBenchmarkForImplementation(labelForRun, impl, fixture, {
          warmup,
          iterations,
          trace,
          traceCallLimit,
          progressEvery,
          strictRules,
          asyncDelayMs,
          collectBreakdown,
          mockApplyMode,
          batchingEnabled,
          maxBatchOps: batchOpsValue,
          maxPayloadBytes,
          quotaWritesPerWindow,
          quotaWindowMs,
          backoffBaseMs,
          backoffMaxRetries,
          traceBatching,
        })
      }
    }

    console.log(`\nCase: ${caseName}`)
    for (const [resultKey, resultValue] of Object.entries(results)) {
      const s = summarizeResult(resultValue)
      console.log(`  ${resultKey} summary: ${JSON.stringify(s)}`)
      finalRows.push({
        caseName,
        impl: resultKey,
        ops: s.opsCounts.join("/"),
        calls: s.apiCalls.join("/"),
        maxBatch: s.maxBatchSizes.join("/"),
        flushes: (s.flushCounts?.length ? s.flushCounts.join("/") : "-"),
        retries: (s.retryCounts?.length ? s.retryCounts.join("/") : "-"),
        quota429: (s.quota429Counts?.length ? s.quota429Counts.join("/") : "-"),
        medianMs: s.medianMs,
        totalMs: s.totalMs,
        batchMs: s.batchMs,
        algoMs: s.algoMs,
        serializeMs: s.serializeMs,
        awaitApiMs: s.awaitApiMs,
        loopOverheadMs: s.loopOverheadMs,
        mockApplyMs: s.mockApplyMs,
        mockSpliceMs: s.mockSpliceMs,
        mockRebuildMs: s.mockRebuildMs,
        verifyMs: s.verifyMs,
      })
    }

    console.log("")
  }

  printFinalTable(finalRows)
  if (collectBreakdown) {
    printTimingBreakdownTable(finalRows)
  }
  console.log("Done.")
}

await main()
