"""
RetailBrain AI - Database Layer (Postgres via Supabase)
---------------------------------------------------------
Replaces the runtime-mutable CSV files (purchase_orders_history.csv,
stock_transfers_history.csv, inventory.csv) with a real database so data
survives restarts and is shared across every device hitting the app —
laptop, phone, tablet all read/write the same rows.

Reference data that never changes at runtime (stores.csv, suppliers.csv,
products.csv, sales data) is untouched and still read from CSV via
data_loader.py, since there's nothing to lose there.

Set DATABASE_URL as an environment variable (Render + local .env) to a
Postgres connection string, e.g.:
    postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres

If DATABASE_URL is not set, every function here raises a clear error
rather than silently falling back — persistence is the whole point, so a
silent CSV fallback would defeat it. main.py is expected to check
db.is_configured() at startup and log a clear warning if it's missing.
"""

import os
import logging
from contextlib import contextmanager
from typing import Any, Dict, List, Optional

import psycopg2
import psycopg2.extras
from psycopg2.pool import ThreadedConnectionPool
from threading import Lock

logger = logging.getLogger("RetailBrain_AI.DB")

DATABASE_URL = os.environ.get("DATABASE_URL", "")
_connection_pool: Optional[ThreadedConnectionPool] = None
_pool_lock = Lock()


def is_configured() -> bool:
    return bool(DATABASE_URL)


@contextmanager
def get_conn():
    if not DATABASE_URL:
        raise RuntimeError(
            "DATABASE_URL is not set. Add it in Render's Environment tab "
            "(and your local .env) to enable persistent storage."
        )
    global _connection_pool
    with _pool_lock:
        if _connection_pool is None:
            _connection_pool = ThreadedConnectionPool(1, 4, DATABASE_URL)

    conn = _connection_pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _connection_pool.putconn(conn)


def close_pool() -> None:
    """Release pooled connections during application shutdown."""
    global _connection_pool
    with _pool_lock:
        if _connection_pool is not None:
            _connection_pool.closeall()
            _connection_pool = None


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS purchase_orders (
    po_number           TEXT PRIMARY KEY,
    ts                   TIMESTAMPTZ NOT NULL,
    store_id             TEXT NOT NULL,
    product_id           TEXT NOT NULL,
    supplier_name        TEXT NOT NULL,
    order_qty            INTEGER NOT NULL,
    total_cost           NUMERIC NOT NULL,
    status                TEXT NOT NULL,
    estimated_delivery   TIMESTAMPTZ,
    transit_minutes       NUMERIC,
    distance_km           NUMERIC
);

CREATE TABLE IF NOT EXISTS stock_transfers (
    transfer_id     TEXT PRIMARY KEY,
    ts               TIMESTAMPTZ NOT NULL,
    from_store       TEXT NOT NULL,
    to_store         TEXT NOT NULL,
    product_id       TEXT NOT NULL,
    transfer_qty     INTEGER NOT NULL,
    city             TEXT NOT NULL,
    status            TEXT NOT NULL,
    eta_text          TEXT,
    distance_km       NUMERIC,
    eta_minutes       NUMERIC,
    eta_at            TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS inventory (
    store_id          TEXT NOT NULL,
    product_id        TEXT NOT NULL,
    current_stock      INTEGER NOT NULL DEFAULT 0,
    reserved_stock      INTEGER NOT NULL DEFAULT 0,
    safety_stock        INTEGER NOT NULL DEFAULT 0,
    maximum_capacity    INTEGER NOT NULL DEFAULT 5000,
    PRIMARY KEY (store_id, product_id)
);

-- "removed"/dismissed rows in the audit log, synced across every device
-- instead of living in a single browser's localStorage.
CREATE TABLE IF NOT EXISTS hidden_audit_rows (
    row_id      TEXT PRIMARY KEY,
    hidden_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


def init_schema() -> None:
    """Creates all tables if they don't already exist. Safe to call every startup."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(SCHEMA_SQL)
    logger.info("Database schema verified/created.")


# ---------------------------------------------------------------------------
# Purchase orders
# ---------------------------------------------------------------------------

def insert_purchase_order(entry: Dict[str, Any]) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO purchase_orders
                    (po_number, ts, store_id, product_id, supplier_name,
                     order_qty, total_cost, status, estimated_delivery,
                     transit_minutes, distance_km)
                VALUES (%(po_number)s, %(ts)s, %(store_id)s, %(product_id)s,
                        %(supplier_name)s, %(order_qty)s, %(total_cost)s,
                        %(status)s, %(estimated_delivery)s,
                        %(transit_minutes)s, %(distance_km)s)
                ON CONFLICT (po_number) DO NOTHING
                """,
                entry,
            )


def get_purchase_orders() -> List[Dict[str, Any]]:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM purchase_orders ORDER BY ts DESC")
            return [dict(row) for row in cur.fetchall()]


# ---------------------------------------------------------------------------
# Stock transfers
# ---------------------------------------------------------------------------

def insert_stock_transfer(entry: Dict[str, Any]) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO stock_transfers
                    (transfer_id, ts, from_store, to_store, product_id,
                     transfer_qty, city, status, eta_text, distance_km,
                     eta_minutes, eta_at)
                VALUES (%(transfer_id)s, %(ts)s, %(from_store)s, %(to_store)s,
                        %(product_id)s, %(transfer_qty)s, %(city)s, %(status)s,
                        %(eta_text)s, %(distance_km)s, %(eta_minutes)s, %(eta_at)s)
                ON CONFLICT (transfer_id) DO NOTHING
                """,
                entry,
            )


def get_stock_transfers() -> List[Dict[str, Any]]:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM stock_transfers ORDER BY ts DESC")
            return [dict(row) for row in cur.fetchall()]


def record_stock_transfer_and_update_inventory(entry: Dict[str, Any]) -> None:
    """Persist a transfer and both stock movements as one transaction."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT current_stock FROM inventory
                WHERE store_id = %s AND product_id = %s FOR UPDATE
                """,
                (entry["from_store"], entry["product_id"]),
            )
            source_row = cur.fetchone()
            if source_row is None:
                raise ValueError("Source store inventory record was not found.")
            if source_row[0] < entry["transfer_qty"]:
                raise ValueError("Source store does not have enough stock for this transfer.")

            cur.execute(
                """
                INSERT INTO stock_transfers
                    (transfer_id, ts, from_store, to_store, product_id,
                     transfer_qty, city, status, eta_text, distance_km,
                     eta_minutes, eta_at)
                VALUES (%(transfer_id)s, %(ts)s, %(from_store)s, %(to_store)s,
                        %(product_id)s, %(transfer_qty)s, %(city)s, %(status)s,
                        %(eta_text)s, %(distance_km)s, %(eta_minutes)s, %(eta_at)s)
                """,
                entry,
            )
            cur.execute(
                """
                UPDATE inventory SET current_stock = current_stock - %s
                WHERE store_id = %s AND product_id = %s
                """,
                (entry["transfer_qty"], entry["from_store"], entry["product_id"]),
            )
            cur.execute(
                """
                INSERT INTO inventory (store_id, product_id, current_stock)
                VALUES (%s, %s, %s)
                ON CONFLICT (store_id, product_id) DO UPDATE
                SET current_stock = inventory.current_stock + EXCLUDED.current_stock
                """,
                (entry["to_store"], entry["product_id"], entry["transfer_qty"]),
            )


def update_stock_transfer_eta(transfer_id: str, eta_result: Dict[str, Any], eta_at: Any) -> None:
    """Replace an initial estimate with the resolved live-traffic route."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE stock_transfers
                SET eta_text = %s, distance_km = %s, eta_minutes = %s, eta_at = %s
                WHERE transfer_id = %s
                """,
                (
                    eta_result["eta_text"],
                    eta_result["distance_km"],
                    eta_result["duration_minutes"],
                    eta_at,
                    transfer_id,
                ),
            )


def mark_all_completed() -> None:
    """Mirrors the old mark_history_completed() CSV behavior."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE purchase_orders SET status = 'COMPLETED'")
            cur.execute("UPDATE stock_transfers SET status = 'COMPLETED'")


# ---------------------------------------------------------------------------
# Inventory
# ---------------------------------------------------------------------------

def update_inventory_stock(store_id: str, product_id: str, qty_change: int) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO inventory (store_id, product_id, current_stock)
                VALUES (%s, %s, GREATEST(%s, 0))
                ON CONFLICT (store_id, product_id) DO UPDATE
                SET current_stock = GREATEST(inventory.current_stock + %s, 0)
                """,
                (store_id, product_id, qty_change, qty_change),
            )


def get_inventory() -> List[Dict[str, Any]]:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM inventory")
            return [dict(row) for row in cur.fetchall()]


# ---------------------------------------------------------------------------
# Hidden ("removed") audit rows — synced across devices
# ---------------------------------------------------------------------------

def get_hidden_row_ids() -> List[str]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT row_id FROM hidden_audit_rows")
            return [r[0] for r in cur.fetchall()]


def hide_row(row_id: str) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO hidden_audit_rows (row_id) VALUES (%s) ON CONFLICT DO NOTHING",
                (row_id,),
            )


def unhide_row(row_id: str) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM hidden_audit_rows WHERE row_id = %s", (row_id,))
