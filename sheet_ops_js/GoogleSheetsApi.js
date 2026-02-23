/**
 * DO NOT MODIFY THIS CLASS.
 * This is an abstract class representing the Google Sheets API.
 * Your solution should call the methods of this class to perform
 * the actions required to update a spreadsheet.
 */
export default class GoogleSheetsApi {
  constructor() { }

  /**
   * Execute a list of operations on a spreadsheet.
   * 
   * Operations are executed in the order they are provided.
   * All operations in a batch are executed in a single "transaction" - they will
   * either all succeed or all fail, and will not be interleaved with other
   * operations on the same sheet.
   * If only a single client is operating in a sheet, then
   *   api.performOps(id, ops); api.performOps(id, moreOps)
   * is functionally equivalent to
   *   api.performOps(id, ops.concat(more_ops))
   * but the latter may be more efficient.
   * 
   * An operation is an array with one of the forms below:
   *   ["insert", "row", index, rowId]
   *   ["insert", "column", index, columnId]
   *   ["delete", "row", index]
   *   ["delete", "column", index]
   * 
   * @param {string} spreadsheetId
   * @param {any[]} ops 
   */
  async performOps(_spreadsheetId, _ops) {
    throw new Error("Unimplemented method 'GoogleSheetsApi.performOps()'");
  }
}
