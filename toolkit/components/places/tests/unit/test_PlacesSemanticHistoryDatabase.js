/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { PlacesSemanticHistoryDatabase } = ChromeUtils.importESModule(
  "resource://gre/modules/PlacesSemanticHistoryDatabase.sys.mjs"
);

const SCHEMA_VERSION_BEFORE_NATIVE_BIT_INDEXING = 2;

// Must be divisible by 8.
const EMBEDDING_SIZE = 64;

add_setup(async function () {
  // Initialize Places.
  Assert.equal(
    PlacesUtils.history.databaseStatus,
    PlacesUtils.history.DATABASE_STATUS_CREATE,
    "Places initialized."
  );
  Services.fog.initializeFOG();
});

add_task(async function test_check_schema() {
  let db = new PlacesSemanticHistoryDatabase({
    embeddingSize: EMBEDDING_SIZE,
    fileName: "places_semantic.sqlite",
  });

  let conn = await db.getConnection();
  Assert.equal(
    await conn.getSchemaVersion(),
    db.currentSchemaVersion,
    "Schema version should match."
  );
  await db.closeConnection();
  await db.removeDatabaseFiles();
});

add_task(async function test_replace_on_downgrade() {
  let db = new PlacesSemanticHistoryDatabase({
    embeddingSize: EMBEDDING_SIZE,
    fileName: "places_semantic.sqlite",
  });

  let conn = await db.getConnection();
  let originalSchemaVersion = db.currentSchemaVersion;
  await db.setCurrentSchemaVersionForTests(originalSchemaVersion + 1);
  await db.closeConnection();
  await db.setCurrentSchemaVersionForTests(originalSchemaVersion);
  conn = await db.getConnection();
  Assert.equal(
    await conn.getSchemaVersion(),
    db.currentSchemaVersion,
    "Schema version should have been reset."
  );
  await db.closeConnection();
  await db.removeDatabaseFiles();
});

add_task(async function test_broken_schema() {
  let db = new PlacesSemanticHistoryDatabase({
    embeddingSize: EMBEDDING_SIZE,
    fileName: "places_semantic.sqlite",
  });

  let conn = await db.getConnection();
  await conn.execute("DROP TABLE vec_history_mapping");
  await db.closeConnection();

  conn = await db.getConnection();
  let rows = await conn.execute("SELECT COUNT(*) FROM vec_history_mapping");
  Assert.equal(
    rows[0].getResultByIndex(0),
    0,
    "Schema should have been reset."
  );
  await db.closeConnection();
  await db.removeDatabaseFiles();
});

add_task(async function test_corruptdb() {
  let db = new PlacesSemanticHistoryDatabase({
    embeddingSize: EMBEDDING_SIZE,
    fileName: "places_semantic.sqlite",
  });
  // Move a corrupt database file in place.
  await IOUtils.copy(
    do_get_file("../maintenance/corruptDB.sqlite").path,
    db.databaseFilePath
  );
  let conn = await db.getConnection();
  Assert.equal(
    await conn.getSchemaVersion(),
    db.currentSchemaVersion,
    "Schema version should have been set."
  );
  await db.closeConnection();
  await db.removeDatabaseFiles();
});

add_task(async function test_differentDimensionsReplacesDatabase() {
  let db = new PlacesSemanticHistoryDatabase({
    embeddingSize: EMBEDDING_SIZE,
    fileName: "places_semantic.sqlite",
  });
  let conn = await db.getConnection();
  Assert.ok(
    !!(
      await conn.execute(
        `SELECT INSTR(sql, :needle) > 0
       FROM sqlite_master WHERE name = 'vec_history'`,
        { needle: `FLOAT[${EMBEDDING_SIZE}]` }
      )
    )[0].getResultByIndex(0),
    "Check embeddings size for the table"
  );
  await db.closeConnection();

  db = new PlacesSemanticHistoryDatabase({
    embeddingSize: EMBEDDING_SIZE + 16,
    fileName: "places_semantic.sqlite",
  });
  conn = await db.getConnection();
  Assert.ok(
    !!(
      await conn.execute(
        `SELECT INSTR(sql, :needle) > 0
       FROM sqlite_master WHERE name = 'vec_history'`,
        { needle: `FLOAT[${EMBEDDING_SIZE + 16}]` }
      )
    )[0].getResultByIndex(0),
    "Check that the database was replaced"
  );
  await db.closeConnection();
  await db.removeDatabaseFiles();
});

add_task(async function test_healthydb() {
  let db = new PlacesSemanticHistoryDatabase({
    embeddingSize: EMBEDDING_SIZE,
    fileName: "places_semantic.sqlite",
  });
  await db.getConnection();
  await db.closeConnection();
  // Check database creation time won't change when reopening, as that would
  // indicate the database file was replaced.
  let creationTime = (await IOUtils.stat(db.databaseFilePath)).creationTime;
  db = new PlacesSemanticHistoryDatabase({
    embeddingSize: EMBEDDING_SIZE,
    fileName: "places_semantic.sqlite",
  });
  await db.getConnection();
  await db.closeConnection();
  Assert.equal(
    creationTime,
    (await IOUtils.stat(db.databaseFilePath)).creationTime,
    "Database creation time should not change."
  );
  await db.removeDatabaseFiles();
});

add_task(async function test_defragmentation() {
  let db = new PlacesSemanticHistoryDatabase({
    embeddingSize: EMBEDDING_SIZE,
    fileName: "places_semantic.sqlite",
  });
  // First connection creates the schema, the second connection does a database
  // health check, which includes fragmentation monitoring.
  let conn = await db.getConnection();
  await db.closeConnection();
  conn = await db.getConnection();
  Assert.less(
    Glean.places.databaseSemanticHistoryWastedPercentage.testGetValue(),
    10,
    "Wasted space should be less than 10%"
  );

  info("insert tensors and cause fragementation");
  const HOW_MANY_TENSORS = 2000;
  const FRACTION_TENSORS_REMAINING_RECIPROCAL = 100;
  // vec0 reclaims a chunk as soon as it has no live rows. To exercise the
  // defrag path we have to leave at least one row in every prior chunk —
  // otherwise empty chunks vanish and the wasted-space metric (which skips
  // the current chunk) reads 0%. Keep 1% spaced at regular intervals so
  // each chunk retains a handful of rows but is mostly empty.
  await conn.executeTransaction(async () => {
    for (let i = 1; i <= HOW_MANY_TENSORS; i++) {
      await insertTensor(conn, i, Array(EMBEDDING_SIZE).fill(Number(`0.${i}`)));
    }
    for (let i = 1; i <= HOW_MANY_TENSORS; i++) {
      if (i % FRACTION_TENSORS_REMAINING_RECIPROCAL) {
        await removeTensor(conn, i);
      }
    }
  });

  await db.closeConnection();
  info("Reopening the connection to trigger defragmentation");
  conn = await db.getConnection();

  Assert.greater(
    Glean.places.databaseSemanticHistoryWastedPercentage.testGetValue(),
    10,
    "Wasted space should be more than 10%"
  );
  Assert.equal(
    Glean.places.databaseSemanticHistoryDefragmentTime.testGetValue().count,
    1,
    "There should be one defragmentation event"
  );
  Assert.greater(
    Glean.places.databaseSemanticHistoryDefragmentTime.testGetValue().sum,
    0,
    "Defragmentation time should be greater than 0"
  );

  info("Check rowids were preserved in defragmentation");
  for (
    let i = FRACTION_TENSORS_REMAINING_RECIPROCAL;
    i <= HOW_MANY_TENSORS;
    i += FRACTION_TENSORS_REMAINING_RECIPROCAL
  ) {
    await checkTensor(conn, i, Array(EMBEDDING_SIZE).fill(Number(`0.${i}`)));
  }
  await db.closeConnection();
  conn = await db.getConnection();

  Assert.less(
    Glean.places.databaseSemanticHistoryWastedPercentage.testGetValue(),
    10,
    "Wasted space should be less than 10%"
  );

  info("Check old tables were removed");
  Assert.equal(
    (
      await conn.execute(
        `SELECT count(*) FROM sqlite_master WHERE name LIKE :suffix`,
        {
          suffix: "%_old",
        }
      )
    )[0].getResultByIndex(0),
    0,
    "There should not be 'old' tables"
  );
  await db.closeConnection();

  info("Reopen the connection and check fragmentation has been resolved");
  conn = await db.getConnection();
  Assert.less(
    Glean.places.databaseSemanticHistoryWastedPercentage.testGetValue(),
    10,
    "Wasted space should be less than 10%"
  );
  await db.closeConnection();

  await db.removeDatabaseFiles();
});

add_task(async function test_migate_to_native_bit_indexing() {
  let db = new PlacesSemanticHistoryDatabase({
    embeddingSize: EMBEDDING_SIZE,
    fileName: "places_semantic.sqlite",
  });
  let conn = await db.getConnection();
  await db.closeConnection();
  conn = await db.getConnection();
  info("insert tensors and cause fragementation");
  const HOW_MANY_TENSORS = 2000;

  await conn.executeTransaction(async () => {
    for (let i = 1; i <= HOW_MANY_TENSORS; i++) {
      await insertTensor(conn, i, Array(EMBEDDING_SIZE).fill(Number(`0.${i}`)));
    }
  });
  // Go back one so it thinks it has older indexing
  await db.setCurrentSchemaVersionForTests(
    SCHEMA_VERSION_BEFORE_NATIVE_BIT_INDEXING
  );
  await db.closeConnection();

  db = new PlacesSemanticHistoryDatabase({
    embeddingSize: EMBEDDING_SIZE,
    fileName: "places_semantic.sqlite",
  });

  info("Reindexing");
  conn = await db.getConnection();
  await db.closeConnection();

  conn = await db.getConnection();
  info("Check migration happened");
  Assert.equal(
    await conn.getSchemaVersion(),
    db.currentSchemaVersion,
    "Schema version should match."
  );

  Assert.greater(
    db.currentSchemaVersion,
    SCHEMA_VERSION_BEFORE_NATIVE_BIT_INDEXING,
    "Schema version updated."
  );

  info("Check rowids were preserved in reindexing");
  for (let i = 1; i <= HOW_MANY_TENSORS; i++) {
    await checkTensor(conn, i, Array(EMBEDDING_SIZE).fill(Number(`0.${i}`)));
  }
  info("Check old tables were removed");
  Assert.equal(
    (
      await conn.execute(
        `SELECT count(*) FROM sqlite_master WHERE name LIKE :suffix`,
        {
          suffix: "%_old",
        }
      )
    )[0].getResultByIndex(0),
    0,
    "There should not be 'old' tables"
  );
  await db.closeConnection();
  await db.removeDatabaseFiles();

  Assert.equal(
    Glean.places.databaseSemanticHistoryReindexTime.testGetValue().count,
    1,
    "One reindex index run in glean"
  );
});

async function insertTensor(conn, rowid, tensor) {
  await conn.execute(
    `
    INSERT INTO vec_history (rowid, embedding)
    VALUES (:rowid, :vector)
    `,
    {
      rowid,
      vector: PlacesUtils.tensorToSQLBindable(tensor),
    }
  );
}

async function removeTensor(conn, rowid) {
  await conn.execute(
    `
    DELETE FROM vec_history WHERE rowid = :rowid
    `,
    {
      rowid,
    }
  );
}

async function checkTensor(conn, rowid, tensor) {
  let rows = await conn.execute(
    `
    SELECT 1 FROM vec_history WHERE rowid = :rowid AND embedding = :vector
    `,
    {
      rowid,
      vector: PlacesUtils.tensorToSQLBindable(tensor),
    }
  );
  Assert.equal(rows.length, 1, "Tensor with specified rowid should exist");
}
