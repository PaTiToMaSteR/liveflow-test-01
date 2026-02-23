# SheetOps

**Your task**: improve the codebase in this repo so that it's easy to
understand and maintain. If you can make it perform better, that's great too.
You can change whatever you want, as long as you don't break the main API (i.e.
the existing tests still pass).

## Problem statement

_Live reports_ are a core LiveFlow feature: we populate a Google Sheet with
data from external services, and then refresh that data periodically to keep it
up to date.

When we update a Google Sheet with new information, sometimes we find that the
user has messed with it. They might have deleted some of our rows or columns,
or they might have created rows or columns of their own.

On the other hand, we also have to deal with changes in the data coming from
the external sources - the content of a report might change radically from
one moment to the next.

To get the spreadsheet to look just right after a refresh, we have to do two
things:
1. First, we need to get the `current` state of the spreadsheet, and the updated
   data from the external service. With these we can find the `target` state -
   what we want to spreadsheet to look like.
2. Given the `current` state and the `target` state, we need to call the Google
   Sheets API to insert and delete the right rows.

Good news: step 1 is solved and merged into our main repo already! But the 
implementation we have for step 2 is pretty rushed, so we're not happy with it
yet. We're pretty sure it works, but it can use a lot of improvement!

Here's an overview of what we have:

* The `sheet-ops` namespace exposes a function called `update-spreadsheet`
* The arguments to `update-spreadsheet` are:
  * An object that represents a connection to the Google Sheets API (see the
    `google-sheets-api` namespace)
  * The id of the spreadsheet
  * Two maps representing the current and target states of the spreadsheet.
* Each state has a list of row and column identifiers. These lists may have some
  `nil`s - these correspond to user-created rows and columns. We must _not_
  delete these rows, and we cannot insert a row with a `nil` identifier.
* Since we cannot mess with user-defined columns, in valid inputs the
  `current` and `target` states will have the same number of `nil`s on the
  respective `columns` and `rows` lists. **You do not have to validate this.**
* The `google-sheets-api.perform-ops` accepts a list of `:insert` and `:delete`
  vectors. These operations target an _index_ in the spreadsheet.
* At this point, we don't have to worry about the _contents_ of rows and columns.
  We have to get each column or row identifier in the right position - another
  part of our system will add the right contents associated with each identifier.

## Insert

Here's an example of a series of `insert` actions on columns, showing what they
would look like before and after each action:

| Index   | 0   | 1   | 2   | 3   | 4   |     | Action                    |
| ------- | --- | --- | --- | --- | --- | --- | ------------------------- |
| Columns | nil | 17  |     |     |     |     |                           |
|         |     |     |     |     |     |     | [:insert, :column, 0, 11] |
| Columns | 11  | nil | 17  |     |     |     |                           |
|         |     |     |     |     |     |     | [:insert, :column, 1, 12] |
| Columns | 11  | 12  | nil | 17  |     |     |                           |
|         |     |     |     |     |     |     | [:insert, :column, 1, 13] |
| Columns | 11  | 13  | 12  | nil | 17  |     |                           |


## Delete

Here's an example of a series of `delete` actions on columns, showing what they
would look like before and after each action:

| Index   | 0   | 1   | 2   | 3   | 4   |     | Action                |
| ------- | --- | --- | --- | --- | --- | --- | --------------------- |
| Columns | 11  | 13  | 12  | nil | 17  |     |                       |
|         |     |     |     |     |     |     | [:delete, :column, 1] |
| Columns | 11  | 12  | nil | 17  |     |     |                       |
|         |     |     |     |     |     |     | [:delete, :column, 1] |
| Columns | 11  | nil | 17  |     |     |     |                       |
|         |     |     |     |     |     |     | [:delete, :column, 0] |
| Columns | nil | 17  |     |     |     |     |                       |

## Running tests

```bash
clj -X:test
```
