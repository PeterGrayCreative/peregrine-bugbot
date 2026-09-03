import sqlite3
import unittest

from batch_store import record_batch


class BatchStoreTests(unittest.TestCase):
    def setUp(self):
        self.connection = sqlite3.connect(":memory:")
        self.connection.execute("CREATE TABLE readings (sensor TEXT PRIMARY KEY, value INTEGER)")

    def tearDown(self):
        self.connection.close()

    def test_commits_complete_batch(self):
        record_batch(self.connection, [("a", 1), ("b", 2)])
        self.assertEqual(self.connection.execute("SELECT count(*) FROM readings").fetchone()[0], 2)
        self.assertFalse(self.connection.in_transaction)

    def test_rolls_back_complete_batch(self):
        with self.assertRaises(sqlite3.IntegrityError):
            record_batch(self.connection, [("a", 1), ("a", 2)])
        self.assertEqual(self.connection.execute("SELECT count(*) FROM readings").fetchone()[0], 0)
        self.assertFalse(self.connection.in_transaction)


if __name__ == "__main__":
    unittest.main()
