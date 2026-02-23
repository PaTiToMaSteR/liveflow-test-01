defmodule SheetOpsEx do
  def update_spreadsheet(api, spreadsheet_id, current, target) do
    go(
      api,
      spreadsheet_id,
      :column,
      Enum.count(current.columns) - 1,
      Enum.reverse(current.columns),
      Enum.reverse(target.columns)
    )

    go(
      api,
      spreadsheet_id,
      :row,
      Enum.count(current.rows) - 1,
      Enum.reverse(current.rows),
      Enum.reverse(target.rows)
    )
  end

  def go(api, spreadsheet_id, dim, ic, c, t) do
    case {c, t} do
      {[], []} ->
        nil

      {[], [nil | ts]} ->
        go(api, spreadsheet_id, dim, ic, [], ts)

      {[], [t | ts]} ->
        :ok = GoogleSheetsApi.perform_ops(api, spreadsheet_id, [{:insert, dim, 0, t}])
        go(api, spreadsheet_id, dim, ic, [], ts)

      {[c | cs], [t | ts]} when c == t ->
        go(api, spreadsheet_id, dim, ic - 1, cs, ts)

      {[nil | _] = cs, [t | ts]} ->
        :ok = GoogleSheetsApi.perform_ops(api, spreadsheet_id, [{:insert, dim, ic + 1, t}])
        go(api, spreadsheet_id, dim, ic, cs, ts)

      {[nil | cs], ts} ->
        go(api, spreadsheet_id, dim, ic - 1, cs, ts)

      {[_ | cs], ts} ->
        :ok = GoogleSheetsApi.perform_ops(api, spreadsheet_id, [{:delete, dim, ic}])
        go(api, spreadsheet_id, dim, ic - 1, cs, ts)
    end
  end
end
