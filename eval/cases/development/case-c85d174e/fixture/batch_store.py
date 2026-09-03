import sqlite3


def record_batch(connection: sqlite3.Connection, rows: list[tuple[str, int]]) -> None:
    with connection:
        connection.executemany("INSERT INTO readings (sensor, value) VALUES (?, ?)", rows)
