import updateSpreadsheet from "../index.js"
import {
  boundedCases,
  exactCases,
  loadLargeSheetCase,
  simulate,
} from "./sheetOpsTestSupport.js"

test.each(exactCases)("$name", async ({ current, target, expectedOpsCount }) => {
  await expect(simulate(updateSpreadsheet, current, target)).resolves.toStrictEqual({
    state: target,
    opsCount: expectedOpsCount,
  })
})

test.each(boundedCases)("$name", async ({ current, target, maxOpsCount }) => {
  const { state, opsCount } = await simulate(updateSpreadsheet, current, target)
  expect(state).toStrictEqual(target)
  expect(opsCount).toBeLessThanOrEqual(maxOpsCount)
})

test("large sheet", async () => {
  const { current, target, maxOpsCount } = loadLargeSheetCase()
  const { state, opsCount } = await simulate(updateSpreadsheet, current, target)
  expect(state).toStrictEqual(target)
  expect(opsCount).toBeLessThanOrEqual(maxOpsCount)
})
