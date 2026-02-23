(ns google-sheet-api-mock
  "DO NOT MODIFY THIS NAMESPACE.
  This namespace has a mock record representing the Google Sheets API.
  This is used to test your solution.
  You can study this module to understand how the API is expected to behave."
  (:require [google-sheets-api])
  (:import [java.util Vector]))

(defn- perform-ops-on-spreadsheet! [spreadsheet, ops]
  (doseq [[action dimension index id] ops]
    (let [^Vector vector (case dimension
                           :row (:rows spreadsheet)
                           :column (:columns spreadsheet))]
      (case action
        :insert (do
                  (when (nil? id)
                    (throw (ex-info "Id cannot be nil"
                                    {:dimension dimension, :index index})))
                  (.add vector index id))
        :delete (do
                  (when (nil? (nth vector index))
                    (throw (ex-info "Cannot delete user-defined dimension"
                                    {:dimension dimension, :index index})))
                  (.removeElementAt vector index))))))

(defrecord GoogleSheetsApiMock [spreadsheets ops_count]
  google-sheets-api/GoogleSheetsApi
  (-perform-ops! [this spreadsheet-id ops]
    (locking this
      (-> @(:spreadsheets this)
          (get spreadsheet-id)
          (perform-ops-on-spreadsheet! ops))
      (swap! ops_count + (count ops)))
    this))

(defn new-mock []
  (->GoogleSheetsApiMock (atom {}) (atom 0)))

(defn add-spreadsheet! [mock, spreadsheet-id, {:keys [columns rows]}]
  (swap! (:spreadsheets mock) assoc spreadsheet-id
         {:columns (Vector. columns), :rows (Vector. rows)})
  mock)

(defn get-spreadsheet [mock, spreadsheet-id]
  (locking mock
    (let [{:keys [columns rows]} (get @(:spreadsheets mock) spreadsheet-id)]
      {:columns (vec columns), :rows (vec rows)})))

(defn get-ops-count [mock]
  @(:ops_count mock))
