import GoogleSheetsApi from "../GoogleSheetsApi"

/**
 * DO NOT MODIFY THIS CLASS.
 * 
 * This is a mock class representing the Google Sheets API.
 * This is used to test your solution.
 * You can study this module to understand how the API is expected to behave.
 */
export default class GoogleSheetsApiMock extends GoogleSheetsApi {
  constructor() {
    super()
    this.spreadsheets = {}
    this.opsCount = 0
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

  async performOps(spreadsheetId, ops) {
    const spreadsheet = this.fetchSpreadsheetState(spreadsheetId)
    for (const [action, dimension, index, value] of ops) {
      this.opsCount += 1
      switch (action) {
        case "delete":
          spreadsheet[dimension + "s"].splice(index, 1)
          break
        case "insert":
          spreadsheet[dimension + "s"].splice(index, 0, value)
          break
      }
    }
  }
}
