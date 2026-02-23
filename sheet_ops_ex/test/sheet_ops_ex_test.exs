defmodule SheetOpsExTest do
  use ExUnit.Case
  doctest SheetOpsEx

  def simulate(current, target) do
    {:ok, mock} = GoogleSheetsApiMock.Server.new()
    GoogleSheetsApiMock.Server.add_spreadsheet(mock, "abc", current)
    SheetOpsEx.update_spreadsheet(mock, "abc", current, target)
    {:ok, final} = GoogleSheetsApiMock.Server.fetch_spreadsheet_state(mock, "abc")
    ops_count = GoogleSheetsApiMock.Server.fetch_ops_applied_count(mock)

    {final, ops_count}
  end

  test "empty" do
    {final, ops_count} = simulate(%{columns: [], rows: []}, %{columns: [], rows: []})
    assert %{columns: [], rows: []} == final
    assert 0 == ops_count
  end

  test "nils" do
    current = %{columns: [nil, nil, nil], rows: [nil, nil, nil]}
    target = %{columns: [nil, nil, nil], rows: [nil, nil, nil]}

    {final, ops_count} = simulate(current, target)
    assert final == target
    assert 0 == ops_count
  end

  test "example 1" do
    current = %{
      columns: [14, nil, nil, nil, 12, 7, 4, 13, 6, nil],
      rows: [15, 14, 13, nil, 8, 11, nil, 7, 12, 2, nil, nil, 9]
    }

    target = %{
      columns: [nil, nil, 11, 14, nil, 4, nil, 9, 13, 5, 7, 3],
      rows: [9, 12, 3, 13, nil, nil, 4, 8, 5, nil, 6, nil, 10]
    }

    {final, ops_count} = simulate(current, target)
    assert final == target
    assert ops_count <= 28, "Expected fewer ops, got #{ops_count}"
  end

  test "example 2" do
    current = %{
      columns: [8, 7, 15, nil, 11, 13, 2],
      rows: [nil, 2, 6, 7, 8, 1, 5]
    }

    target = %{
      columns: [4, 5, nil, 2, 6, 1, 8, 7],
      rows: [8, 6, 5, 7, 4, nil, 1]
    }

    {final, ops_count} = simulate(current, target)
    assert final == target
    assert ops_count <= 23, "Expected fewer ops, got #{ops_count}"
  end

  test "large sheet" do
    current = Jason.decode!(File.read!("test/data/large_current.json"), keys: :atoms)
    target = Jason.decode!(File.read!("test/data/large_target.json"), keys: :atoms)
    {final, ops_count} = simulate(current, target)

    assert final == target
    assert ops_count <= 99996, "Expected fewer ops, got #{ops_count}"
  end
end
