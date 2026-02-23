(ns google-sheets-api
  "DO NOT MODIFY THIS NAMESPACE.
  This namespace defines a protocol representing the Google Sheets API.
  Your solution should call the functions from this protocol to perform
  the actions required to update a spreadsheet."
  (:require [schema.core :as s]))

(s/defschema DimensionId s/Int)
(s/defschema DimensionType (s/enum :row :column))
(s/defschema Index (s/constrained s/Int (complement neg?)))
(s/defschema InsertOp [(s/one (s/eq :insert) "op")
                       (s/one DimensionType "dimension")
                       (s/one Index "index")
                       (s/one DimensionId "id")])
(s/defschema DeleteOp [(s/one (s/eq :delete) "op")
                       (s/one DimensionType "dimension")
                       (s/one Index "index")])
(s/defschema Op
  (s/conditional
   #(= :insert (first %)) InsertOp
   #(= :delete (first %)) DeleteOp))

(defprotocol GoogleSheetsApi
  (-perform-ops!
    [this spreadsheet-id ops]
    "Prefer using perform-ops!, which provides schema validation,
    instead of calling this method directly."))

(s/defn perform-ops!
  "Execute a list of operations on a spreadsheet.

   Operations are executed in the order they are provided.
   All operations in a batch are executed in a single \"transaction\" - they
   will either all succeed or all fail, and will not be interleaved with
   other operations on the same sheet.

   If only a single client is operating in a sheet, then
     (do (perform-ops api id ops) (perform-ops api id more-ops))
   is functionally equivalent to
     (perform-ops api id (concat ops more-ops))
   but the latter may be more efficient."
  [api :- (s/protocol GoogleSheetsApi)
   spreadsheet-id :- s/Str
   ops :- [Op]]
  (-perform-ops! api spreadsheet-id ops))
