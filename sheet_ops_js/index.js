import GoogleSheetsApi from "./GoogleSheetsApi.js"

/**
 *
 * @param {GoogleSheetsApi} api
 * @param {string} spreadsheetId
 * @param {Object} current - { columns: (number | null)[]], rows: (number | null)[]}
 * @param {Object} target - { columns: (number | null)[]], rows: (number | null)[]}
 */
export default async function updateSpreadsheet(api, spreadsheetId, current, target) {
  await ops(api, spreadsheetId, "column", current.columns, target.columns)
  await ops(api, spreadsheetId, "row", current.rows, target.rows)
}

async function ops(api, spreadsheetId, dim, cs, ts) {
  let ic = cs.length - 1
  let it = ts.length - 1
  while (true) {
    if (ic < 0 && it < 0) { return }
    if (ic < 0 && ts[it] === null) {
      it--
      continue
    }
    if (ic < 0) {
      await api.performOps(spreadsheetId, [["insert", dim, 0, ts[it]]])
      it--
      continue
    }
    if (cs[ic] === null && it < 0) {
      ic--
      continue
    }
    if (it < 0) {
      await api.performOps(spreadsheetId, [["delete", dim, ic]])
      ic--
      continue
    }
    if (cs[ic] === ts[it]) {
      ic--
      it--
      continue
    }
    if (cs[ic] === null) {
      await api.performOps(spreadsheetId, [["insert", dim, ic + 1, ts[it]]])
      it--
      continue
    }
    await api.performOps(spreadsheetId, [["delete", dim, ic]])
    ic--
  }
}
