import sqlite3


def create_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE orders (id TEXT PRIMARY KEY, sku TEXT NOT NULL);
        CREATE TABLE inventory (sku TEXT PRIMARY KEY, available INTEGER NOT NULL);
        """
    )
    connection.commit()


def apply_order(connection: sqlite3.Connection, order_id: str, sku: str) -> None:
    connection.execute("BEGIN")
    try:
        connection.execute("INSERT INTO orders (id, sku) VALUES (?, ?)", (order_id, sku))
        connection.commit()
        updated = connection.execute(
            "UPDATE inventory SET available = available - 1 "
            "WHERE sku = ? AND available > 0",
            (sku,),
        )
        if updated.rowcount != 1:
            raise ValueError("out of stock")
    except Exception:
        connection.rollback()
        raise
