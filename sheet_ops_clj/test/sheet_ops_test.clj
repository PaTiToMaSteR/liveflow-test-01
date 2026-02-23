(ns sheet-ops-test
  (:require [clojure.data.json :as json]
            [clojure.test :refer [deftest is testing use-fixtures]]
            [google-sheet-api-mock]
            [schema.test]
            [sheet-ops]))

(use-fixtures :once schema.test/validate-schemas)

(defn simulate [current target]
  (let [mock (google-sheet-api-mock/new-mock)
        spreadsheet-id "test"]
    (google-sheet-api-mock/add-spreadsheet! mock spreadsheet-id current)
    (sheet-ops/update-spreadsheet mock spreadsheet-id current target)
    {:final (google-sheet-api-mock/get-spreadsheet mock spreadsheet-id)
     :ops-count (google-sheet-api-mock/get-ops-count mock)}))

(deftest update-spreadsheet
  (testing "empty"
    (let [current {:columns [], :rows []}
          target {:columns [], :rows []}
          {:keys [final ops-count]} (simulate current target)]
      (is (= target final))
      (is (= 0 ops-count))))

  (testing "nils"
    (let [current {:columns [nil nil nil], :rows [nil nil]}
          target {:columns [nil nil nil], :rows [nil nil]}
          {:keys [final ops-count]} (simulate current target)]
      (is (= target final))
      (is (= 0 ops-count))))

  (testing "example 1"
    (let [current {:columns [14, nil, nil, nil, 12, 7, 4, 13, 6, nil]
                   :rows [15, 14, 13, nil, 8, 11, nil, 7, 12, 2, nil, nil, 9]}
          target {:columns [nil, nil, 11, 14, nil, 4, nil, 9, 13, 5, 7, 3]
                  :rows [9, 12, 3, 13, nil, nil, 4, 8, 5, nil, 6, nil, 10]}
          {:keys [final ops-count]} (simulate current target)]
      (is (= target final))
      (is (<= 28 ops-count))))

  (testing "example 2"
    (let [current {:columns [8, 7, 15, nil, 11, 13, 2]
                   :rows [nil, 2, 6, 7, 8, 1, 5]}
          target {:columns [4, 5, nil, 2, 6, 1, 8, 7]
                  :rows [8, 6, 5, 7, 4, nil, 1]}
          {:keys [final ops-count]} (simulate current target)]
      (is (= target final))
      (is (<= 23 ops-count))))


  (testing "large sheet"
    (let [current (json/read-str (slurp "test/data/large_current.json") :key-fn keyword)
          target (json/read-str (slurp "test/data/large_target.json") :key-fn keyword)
          {:keys [final ops-count]} (simulate current target)]
      (is (= target final))
      (is (<= 99996 ops-count)))))
