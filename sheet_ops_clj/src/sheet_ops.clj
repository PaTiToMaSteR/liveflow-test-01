(ns sheet-ops
  (:require [google-sheets-api]))

(defn- go [api, spreadsheet-id, dim, ic, cs, ts]
  (if-let [[c & more-cs] (seq cs)]
    (if-let [[t & more-ts] (seq ts)]
      (cond
        (= c t)
        (recur api spreadsheet-id dim (dec ic) more-cs more-ts)

        (nil? c)
        (do (google-sheets-api/perform-ops! api
                                            spreadsheet-id
                                            [[:insert dim (inc ic) t]])
            (recur api spreadsheet-id dim ic cs more-ts))

        :else
        (do (google-sheets-api/perform-ops! api
                                            spreadsheet-id
                                            [[:delete dim ic]])
            (recur api spreadsheet-id dim (dec ic) more-cs ts)))
      (if (nil? c)
        (recur api spreadsheet-id dim (dec ic) more-cs ts)
        (do (google-sheets-api/perform-ops! api
                                            spreadsheet-id
                                            [[:delete dim ic]])
            (recur api spreadsheet-id dim (dec ic) more-cs ts))))
    (if-let [[t & ts] (seq ts)]
      (if t
        (do (google-sheets-api/perform-ops! api
                                            spreadsheet-id
                                            [[:insert dim 0 t]])
            (recur api spreadsheet-id dim ic [] ts))
        (recur api spreadsheet-id dim ic [] ts))
      nil)))

(defn update-spreadsheet
  [api, spreadsheet-id, current, target]
  (go api spreadsheet-id :column
      (-> current :columns count dec)
      (-> current :columns reverse)
      (-> target :columns reverse))
  (go api spreadsheet-id :row
      (-> current :rows count dec)
      (-> current :rows reverse)
      (-> target :rows reverse)))
