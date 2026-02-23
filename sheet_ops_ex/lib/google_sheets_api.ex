defprotocol GoogleSheetsApi do
  @moduledoc """
  DO NOT MODIFY THIS MODULE.
  This file is a protocol module representing the Google Sheets API.
  Your solution should call the functions in this module to perform
  the actions required to update a spreadsheet.
  """
  @type dimension_id() :: integer()
  @type dimension_type() :: :row | :column
  @type index() :: non_neg_integer()
  @type op() ::
          {:insert, dimension_type(), index(), dimension_id()}
          | {:delete, dimension_type(), index()}

  @doc """
  Execute a list of operations on a spreadsheet.
  Operations are executed in the order they are provided.
  All operations in a batch are executed in a single "transaction" - they will
  either all succeed or all fail, and will not be interleaved with other
  operations on the same sheet.
  If only a single client is operating in a sheet, then
    perform_ops(api, id, ops); perform_ops(api, id, more_ops)
  is functionally equivalent to
    perform_ops(api, id, ops ++ more_ops)
  but the latter may be more efficient.
  """
  @spec perform_ops(GoogleSheetsApi.t(), String.t(), list(op())) :: :ok | {:error, String.t()}
  def perform_ops(api, spreadsheet_id, ops)
end
