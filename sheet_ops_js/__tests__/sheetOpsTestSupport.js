import * as fs from "node:fs"
import GoogleSheetsApiMock from "./GoogleSheetsApiMock.js"

/**
 * Small shared helper for JS sheet-ops tests.
 *
 * Intent:
 * - keep test files focused on expectations, not mock wiring
 * - make it easy to reuse the same cases across multiple test files
 *
 * @param {Function} updateSpreadsheet Function under test.
 * @param {{ columns: (number | null)[], rows: (number | null)[] }} current Initial sheet state.
 * @param {{ columns: (number | null)[], rows: (number | null)[] }} target Target sheet state.
 * @param {{ spreadsheetId?: string }} [options] Optional mock spreadsheet id override.
 * @returns {Promise<{ state: { columns: (number | null)[], rows: (number | null)[] }, opsCount: number }>}
 */
export async function simulate(updateSpreadsheet, current, target, options = {}) {
  const spreadsheetId = options.spreadsheetId ?? "abc"
  const mock = new GoogleSheetsApiMock()
  mock.addSpreadsheet(spreadsheetId, current)
  await updateSpreadsheet(mock, spreadsheetId, current, target)
  return { state: mock.fetchSpreadsheetState(spreadsheetId), opsCount: mock.opsCount }
}

/**
 * Load one of the JSON fixtures under `__tests__/data`.
 *
 * @param {string} name File name (for example `large_current.json`).
 * @returns {{ columns: (number | null)[], rows: (number | null)[] }}
 */
export function loadJsonFixture(name) {
  return JSON.parse(fs.readFileSync(new URL(`./data/${name}`, import.meta.url), "utf8"))
}

/**
 * Small exact-output fixtures where both final state and exact op count are
 * stable and easy to assert.
 */
export const exactCases = [
  {
    name: "empty",
    current: { columns: [], rows: [] },
    target: { columns: [], rows: [] },
    expectedOpsCount: 0,
  },
  {
    name: "nulls",
    current: { columns: [null, null, null], rows: [null, null, null] },
    target: { columns: [null, null, null], rows: [null, null, null] },
    expectedOpsCount: 0,
  },
]

/**
 * Cases where we assert correctness plus an operation-budget upper bound.
 */
export const boundedCases = [
  {
    name: "example 1",
    current: {
      columns: [14, null, null, null, 12, 7, 4, 13, 6, null],
      rows: [15, 14, 13, null, 8, 11, null, 7, 12, 2, null, null, 9],
    },
    target: {
      columns: [null, null, 11, 14, null, 4, null, 9, 13, 5, 7, 3],
      rows: [9, 12, 3, 13, null, null, 4, 8, 5, null, 6, null, 10],
    },
    maxOpsCount: 28,
  },
  {
    name: "example 2",
    current: {
      columns: [8, 7, 15, null, 11, 13, 2],
      rows: [null, 2, 6, 7, 8, 1, 5],
    },
    target: {
      columns: [4, 5, null, 2, 6, 1, 8, 7],
      rows: [8, 6, 5, 7, 4, null, 1],
    },
    maxOpsCount: 23,
  },
  {
    name: "moved item remains correct",
    current: {
      columns: [1, 2, 3, 4],
      rows: [],
    },
    target: {
      columns: [2, 3, 4, 1],
      rows: [],
    },
    maxOpsCount: 6,
  },
]

/**
 * Large JSON fixture case with a pre-defined operation budget.
 *
 * @returns {{
 *   name: string,
 *   current: { columns: (number | null)[], rows: (number | null)[] },
 *   target: { columns: (number | null)[], rows: (number | null)[] },
 *   maxOpsCount: number
 * }}
 */
export function loadLargeSheetCase() {
  return {
    name: "large sheet",
    current: loadJsonFixture("large_current.json"),
    target: loadJsonFixture("large_target.json"),
    maxOpsCount: 99996,
  }
}
