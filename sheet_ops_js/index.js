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
  const executor = new BatchedOpsExecutor(api, spreadsheetId, executionOptions)

  await syncDimension(executor, "column", current.columns, target.columns)
  // Keep dimension boundaries explicit for readability and easier debugging.
  await executor.flush()

  await syncDimension(executor, "row", current.rows, target.rows)
  await executor.flush()
}

async function syncDimension(executor, dim, currentIds, targetIds) {
  // The algorithm traverses from the end so insert/delete indexes are emitted
  // in a way that remains valid as prior operations are applied in order.
  let ic = currentIds.length - 1
  let it = targetIds.length - 1

  while (true) {
    if (ic < 0 && it < 0) {
      return
    }

    // `null` represents a user-defined row/column placeholder. We never insert
    // or delete null IDs; we only skip past them while reconciling.
    if (ic < 0 && targetIds[it] === null) {
      it--
      continue
    }

    if (ic < 0) {
      await executor.insert(dim, 0, targetIds[it])
      it--
      continue
    }

    if (currentIds[ic] === null && it < 0) {
      ic--
      continue
    }

    if (it < 0) {
      await executor.delete(dim, ic)
      ic--
      continue
    }

    if (currentIds[ic] === targetIds[it]) {
      ic--
      it--
      continue
    }

    if (currentIds[ic] === null) {
      await executor.insert(dim, ic + 1, targetIds[it])
      it--
      continue
    }

    await executor.delete(dim, ic)
    ic--
  }
}

class BatchedOpsExecutor {
  /**
   * @param {GoogleSheetsApi} api
   * @param {string} spreadsheetId
   * @param {{ maxBatchOps?: number, maxPayloadBytes?: number }} executionOptions
   */
  constructor(api, spreadsheetId, executionOptions = {}) {
    this.api = api
    this.spreadsheetId = spreadsheetId

    const maxBatchOps = Number.isFinite(executionOptions.maxBatchOps)
      ? Math.max(1, Math.floor(executionOptions.maxBatchOps))
      : DEFAULT_EXECUTION_OPTIONS.maxBatchOps

    const maxPayloadBytes = Number.isFinite(executionOptions.maxPayloadBytes)
      ? Math.max(0, Math.floor(executionOptions.maxPayloadBytes))
      : DEFAULT_EXECUTION_OPTIONS.maxPayloadBytes

    this.maxBatchOps = maxBatchOps
    this.maxPayloadBytes = maxPayloadBytes
    this.pendingOps = []
    this.pendingPayloadBytes = 0
  }

  async insert(dim, index, value) {
    await this.queue(["insert", dim, index, value])
  }

  async delete(dim, index) {
    await this.queue(["delete", dim, index])
  }

  async queue(op) {
    const opBytes = estimateOpBytes(op)
    const batchFull = this.pendingOps.length >= this.maxBatchOps
    const payloadFull =
      this.maxPayloadBytes > 0 &&
      this.pendingOps.length > 0 &&
      this.pendingPayloadBytes + opBytes > this.maxPayloadBytes

    if (batchFull || payloadFull) {
      await this.flush()
    }

    this.pendingOps.push(op)
    this.pendingPayloadBytes += opBytes
  }

  async flush() {
    if (this.pendingOps.length === 0) {
      return
    }

    const ops = this.pendingOps
    this.pendingOps = []
    this.pendingPayloadBytes = 0
    await this.api.performOps(this.spreadsheetId, ops)
  }
}

function estimateOpBytes(op) {
  // Operation payloads here are ASCII-only (action/dimension strings + numbers),
  // so string length is a good proxy for byte size and keeps this helper runtime-agnostic.
  return JSON.stringify(op).length
}
