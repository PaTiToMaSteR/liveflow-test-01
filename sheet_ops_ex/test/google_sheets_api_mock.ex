defmodule GoogleSheetsApiMock do
  @moduledoc """
  DO NOT MODIFY THIS MODULE.
  This file is a mock module representing the Google Sheets API.
  This is used to test your solution.
  You can study this module to understand how the API is expected to behave.
  """
  defmodule State do
    defstruct [:spreadsheets, :ops_applied_count]

    def new(), do: %State{spreadsheets: %{}, ops_applied_count: 0}

    def add_spreadsheet(%__MODULE__{} = state, spreadsheet_id, spreadsheet_state) do
      put_in(state.spreadsheets[spreadsheet_id], spreadsheet_state)
    end

    def fetch_spreadsheet_state(%__MODULE__{} = state, spreadsheet_id) do
      case Map.fetch(state.spreadsheets, spreadsheet_id) do
        {:ok, spreadsheet_state} -> {:ok, spreadsheet_state}
        :error -> {:error, :not_found}
      end
    end

    def update_spreadsheet(%__MODULE__{} = state, spreadsheet_id, fun) do
      case Map.fetch(state.spreadsheets, spreadsheet_id) do
        {:ok, spreadsheet_state} ->
          case fun.(spreadsheet_state) do
            {:ok, spreadsheet_state, ops_applied_count} ->
              state = put_in(state.spreadsheets[spreadsheet_id], spreadsheet_state)
              state = update_in(state.ops_applied_count, &(&1 + ops_applied_count))
              {:ok, state}

            {:error, error} ->
              {:error, error}
          end

        :error ->
          {:error, :not_found}
      end
    end
  end

  defmodule Server do
    use Agent

    defstruct [:process]

    def new() do
      with {:ok, pid} <- Agent.start_link(fn -> State.new() end) do
        {:ok, %__MODULE__{process: pid}}
      end
    end

    def fetch_ops_applied_count(%__MODULE__{process: pid}), do: Agent.get(pid, &(&1.ops_applied_count))

    def add_spreadsheet(%__MODULE__{process: pid}, spreadsheet_id, spreadsheet_state) do
      Agent.update(pid, &State.add_spreadsheet(&1, spreadsheet_id, spreadsheet_state), :infinity)
    end

    def fetch_spreadsheet_state(%__MODULE__{process: pid}, spreadsheet_id) do
      Agent.get(pid, &State.fetch_spreadsheet_state(&1, spreadsheet_id))
    end

    def update_spreadsheet(%__MODULE__{process: pid}, spreadsheet_id, fun) do
      Agent.get_and_update(
        pid,
        fn state ->
          case State.update_spreadsheet(state, spreadsheet_id, fun) do
            {:ok, state} -> {:ok, state}
            {:error, error} -> {{:error, error}, state}
          end
        end,
        :infinity
      )
    end
  end

  defimpl GoogleSheetsApi, for: Server do
    def perform_ops(%Server{} = mock, spreadsheet_id, ops) do
      Server.update_spreadsheet(mock, spreadsheet_id, fn current ->
        Enum.reduce_while(ops, {:ok, current, 0}, fn op, {:ok, current, ops_count} ->
          case do_perform_op(op, current) do
            {:ok, current} -> {:cont, {:ok, current, ops_count + 1}}
            {:error, error} -> {:halt, {:error, error}}
          end
        end)
      end)
    end

    defp do_perform_op({:delete, :row, index}, current) do
      case(Enum.at(current.rows, index)) do
        nil -> {:error, "Row #{index} is user-defined and cannot be deleted"}
        _ -> {:ok, update_in(current.rows, &List.delete_at(&1, index))}
      end
    end

    defp do_perform_op({:delete, :column, index}, current) do
      case(Enum.at(current.columns, index)) do
        nil -> {:error, "Column #{index} is user-defined and cannot be deleted"}
        _ -> {:ok, update_in(current.columns, &List.delete_at(&1, index))}
      end
    end

    defp do_perform_op({:insert, :row, _index, nil}, _current),
      do: {:error, "Row ID cannot be nil"}

    defp do_perform_op({:insert, :row, index, id}, current),
      do: {:ok, update_in(current.rows, &List.insert_at(&1, index, id))}

    defp do_perform_op({:insert, :column, _index, nil}, _current),
      do: {:error, "Column ID cannot be nil"}

    defp do_perform_op({:insert, :column, index, id}, current),
      do: {:ok, update_in(current.columns, &List.insert_at(&1, index, id))}
  end
end
