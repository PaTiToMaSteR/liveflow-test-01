import updateSpreadsheet from "../index.js"
import * as fs from 'fs'
import GoogleSheetsApiMock from "./GoogleSheetsApiMock.js"

function simulate(current, target) {
  const mock = new GoogleSheetsApiMock()
  mock.addSpreadsheet("abc", current)
  updateSpreadsheet(mock, "abc", current, target)
  return {state: mock.fetchSpreadsheetState("abc"), opsCount: mock.opsCount}
}

test("empty", () => {
  const current = { columns: [], rows: [] }
  const target = { columns: [], rows: [] }
  expect(simulate(current, target)).toStrictEqual({state: target, opsCount: 0})
})

test("nulls", () => {
  const current = { columns: [null, null, null], rows: [null, null, null] }
  const target = { columns: [null, null, null], rows: [null, null, null] }
  expect(simulate(current, target)).toStrictEqual({state: target, opsCount: 0})
})

test("example 1", () => {
  const current = {
    columns: [14, null, null, null, 12, 7, 4, 13, 6, null],
    rows: [15, 14, 13, null, 8, 11, null, 7, 12, 2, null, null, 9]
  }
  const target = {
    columns: [null, null, 11, 14, null, 4, null, 9, 13, 5, 7, 3],
    rows: [9, 12, 3, 13, null, null, 4, 8, 5, null, 6, null, 10]
  }
  const {state, opsCount} = simulate(current, target)
  expect(state).toStrictEqual(target)
  expect(opsCount).toBeLessThanOrEqual(28)
})

test("example 2", () => {
  const current = {
    columns: [8, 7, 15, null, 11, 13, 2],
    rows: [null, 2, 6, 7, 8, 1, 5]
  }
  const target = {
    columns: [4, 5, null, 2, 6, 1, 8, 7],
    rows: [8, 6, 5, 7, 4, null, 1]
  }
  const {state, opsCount} = simulate(current, target)
  expect(state).toStrictEqual(target)
  expect(opsCount).toBeLessThanOrEqual(23)
})

test("large sheet", () => {
  const current = JSON.parse(fs.readFileSync('./__tests__/data/large_current.json'))
  const target = JSON.parse(fs.readFileSync('./__tests__/data/large_target.json'))
  const {state, opsCount} = simulate(current, target)
  expect(state).toStrictEqual(target)
  expect(opsCount).toBeLessThanOrEqual(99996)
})
