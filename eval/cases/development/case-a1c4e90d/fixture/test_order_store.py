import sqlite3
import tempfile
import unittest
from pathlib import Path

from order_store import apply_order, create_schema


class OrderStoreTests(unittest.TestCase):
    def open_database(self):
        temporary = tempfile.TemporaryDirectory()
        path = Path(temporary.name) / "orders.sqlite"
        connection = sqlite3.connect(path)
        create_schema(connection)
        connection.execute("INSERT INTO inventory (sku, available) VALUES ('A', 1)")
        connection.commit()
        return temporary, path, connection

    def test_success_persists_order_and_inventory_together(self):
        temporary, path, connection = self.open_database()
        with temporary:
            apply_order(connection, "order-1", "A")
            connection.close()
            reopened = sqlite3.connect(path)
            self.assertEqual(reopened.execute("SELECT count(*) FROM orders").fetchone()[0], 1)
            self.assertEqual(reopened.execute("SELECT available FROM inventory").fetchone()[0], 0)
            reopened.close()

    def test_rejected_order_leaves_no_record(self):
        temporary, path, connection = self.open_database()
        with temporary:
            connection.execute("UPDATE inventory SET available = 0")
            connection.commit()
            with self.assertRaisesRegex(ValueError, "out of stock"):
                apply_order(connection, "order-2", "A")
            connection.close()
            reopened = sqlite3.connect(path)
            self.assertEqual(reopened.execute("SELECT count(*) FROM orders").fetchone()[0], 0)
            reopened.close()


if __name__ == "__main__":
    unittest.main()
