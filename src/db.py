"""
RetailBrain AI - Postgres & Local CSV Database Integration Layer
Handles persistence for purchase orders, stock transfers, inventory updates, and hidden row tracking.
"""
import os
import logging
from contextlib import contextmanager
from datetime import datetime
from zoneinfo import ZoneInfo
import pandas as pd

from src import config as cfg

logger = logging.getLogger("RetailBrain_AI.DB")
IST = ZoneInfo("Asia/Kolkata")

_hidden_row_ids = set()

def is_configured() -> bool:
    return bool(os.getenv("DATABASE_URL"))

def init_schema():
    if not is_configured():
        return
    try:
        import psycopg2
        conn = psycopg2.connect(os.getenv("DATABASE_URL"))
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS purchase_orders (
                    po_number VARCHAR(64) PRIMARY KEY,
                    ts TIMESTAMPTZ NOT NULL,
                    store_id VARCHAR(32) NOT NULL,
                    product_id VARCHAR(32) NOT NULL,
                    supplier_name VARCHAR(128) NOT NULL,
                    order_qty INT NOT NULL,
                    total_cost NUMERIC(12,2) NOT NULL,
                    status VARCHAR(64) NOT NULL,
                    estimated_delivery TIMESTAMPTZ,
                    transit_minutes INT,
                    distance_km NUMERIC(8,2)
                );
                CREATE TABLE IF NOT EXISTS stock_transfers (
                    transfer_id VARCHAR(64) PRIMARY KEY,
                    ts TIMESTAMPTZ NOT NULL,
                    from_store VARCHAR(32) NOT NULL,
                    to_store VARCHAR(32) NOT NULL,
                    product_id VARCHAR(32) NOT NULL,
                    transfer_qty INT NOT NULL,
                    city VARCHAR(64) NOT NULL,
                    status VARCHAR(64) NOT NULL,
                    eta_text VARCHAR(128),
                    distance_km NUMERIC(8,2),
                    eta_minutes INT,
                    eta_at TIMESTAMPTZ
                );
                CREATE TABLE IF NOT EXISTS inventory (
                    store_id VARCHAR(32) NOT NULL,
                    product_id VARCHAR(32) NOT NULL,
                    current_stock INT NOT NULL DEFAULT 0,
                    reserved_stock INT NOT NULL DEFAULT 0,
                    safety_stock INT NOT NULL DEFAULT 0,
                    maximum_capacity INT NOT NULL DEFAULT 5000,
                    PRIMARY KEY (store_id, product_id)
                );
                CREATE TABLE IF NOT EXISTS hidden_rows (
                    row_id VARCHAR(64) PRIMARY KEY,
                    hidden_at TIMESTAMPTZ DEFAULT NOW()
                );
            """)
            conn.commit()
            conn.close()
            logger.info("Database schema verified.")
    except Exception as e:
        logger.warning(f"Could not initialize Postgres schema: {e}")

def close_pool():
    pass

@contextmanager
def get_conn():
    if not is_configured():
        yield None
        return
    try:
        import psycopg2
        conn = psycopg2.connect(os.getenv("DATABASE_URL"))
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        logger.error(f"Postgres connection error: {e}")
        yield None

def insert_purchase_order(data: dict):
    if is_configured():
        try:
            with get_conn() as conn:
                if conn:
                    with conn.cursor() as cur:
                        cur.execute("""
                            INSERT INTO purchase_orders (po_number, ts, store_id, product_id, supplier_name, order_qty, total_cost, status, estimated_delivery, transit_minutes, distance_km)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            ON CONFLICT (po_number) DO NOTHING
                        """, (
                            data.get("po_number"), data.get("ts"), data.get("store_id"), data.get("product_id"),
                            data.get("supplier_name"), data.get("order_qty"), data.get("total_cost"),
                            data.get("status"), data.get("estimated_delivery"), data.get("transit_minutes"),
                            data.get("distance_km")
                        ))
                    return
        except Exception as e:
            logger.warning(f"Failed to insert purchase order to DB: {e}")

    # Local CSV fallback
    try:
        path = cfg.PURCHASE_ORDERS_FILE
        row = {
            "po_number": data.get("po_number"),
            "timestamp": data.get("ts").isoformat() if hasattr(data.get("ts"), "isoformat") else str(data.get("ts")),
            "store_id": data.get("store_id"),
            "product_id": data.get("product_id"),
            "supplier_name": data.get("supplier_name"),
            "order_qty": data.get("order_qty"),
            "total_cost": data.get("total_cost"),
            "status": data.get("status"),
            "estimated_delivery": data.get("estimated_delivery").isoformat() if hasattr(data.get("estimated_delivery"), "isoformat") else str(data.get("estimated_delivery")),
        }
        df_new = pd.DataFrame([row])
        if os.path.exists(path) and os.path.getsize(path) > 0:
            df_new.to_csv(path, mode="a", header=False, index=False)
        else:
            df_new.to_csv(path, mode="w", header=True, index=False)
    except Exception as e:
        logger.error(f"Error persisting purchase order to CSV: {e}")

def insert_stock_transfer(data: dict):
    if is_configured():
        try:
            with get_conn() as conn:
                if conn:
                    with conn.cursor() as cur:
                        cur.execute("""
                            INSERT INTO stock_transfers (transfer_id, ts, from_store, to_store, product_id, transfer_qty, city, status, eta_text, distance_km, eta_minutes, eta_at)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            ON CONFLICT (transfer_id) DO NOTHING
                        """, (
                            data.get("transfer_id"), data.get("ts"), data.get("from_store"), data.get("to_store"),
                            data.get("product_id"), data.get("transfer_qty"), data.get("city"), data.get("status"),
                            data.get("eta_text"), data.get("distance_km"), data.get("eta_minutes"), data.get("eta_at")
                        ))
                    return
        except Exception as e:
            logger.warning(f"Failed to insert stock transfer to DB: {e}")

    # Local CSV fallback
    try:
        path = cfg.STOCK_TRANSFERS_FILE
        row = {
            "transfer_id": data.get("transfer_id"),
            "timestamp": data.get("ts").isoformat() if hasattr(data.get("ts"), "isoformat") else str(data.get("ts")),
            "from_store": data.get("from_store"),
            "to_store": data.get("to_store"),
            "product_id": data.get("product_id"),
            "transfer_qty": data.get("transfer_qty"),
            "city": data.get("city"),
            "status": data.get("status"),
            "eta": data.get("eta_text"),
        }
        df_new = pd.DataFrame([row])
        if os.path.exists(path) and os.path.getsize(path) > 0:
            df_new.to_csv(path, mode="a", header=False, index=False)
        else:
            df_new.to_csv(path, mode="w", header=True, index=False)
    except Exception as e:
        logger.error(f"Error persisting stock transfer to CSV: {e}")

def update_inventory_stock(store_id: str, product_id: str, delta_qty: int):
    try:
        path = cfg.INVENTORY_FILE
        if os.path.exists(path):
            df = pd.read_csv(path)
            mask = (df["Store_ID"] == store_id) & (df["Product_ID"] == product_id)
            if mask.any():
                df.loc[mask, "Current_Stock"] = df.loc[mask, "Current_Stock"] + delta_qty
                df.to_csv(path, index=False)
    except Exception as e:
        logger.error(f"Error updating inventory CSV: {e}")

def record_stock_transfer_and_update_inventory(data: dict):
    insert_stock_transfer(data)
    from_store = data.get("from_store")
    to_store = data.get("to_store")
    product_id = data.get("product_id")
    qty = int(data.get("transfer_qty", 0))
    update_inventory_stock(from_store, product_id, -qty)
    update_inventory_stock(to_store, product_id, qty)

def update_stock_transfer_eta(transfer_id: str, eta_result: dict, eta_time: datetime):
    if is_configured():
        try:
            with get_conn() as conn:
                if conn:
                    with conn.cursor() as cur:
                        cur.execute("""
                            UPDATE stock_transfers
                            SET eta_text = %s, distance_km = %s, eta_minutes = %s, eta_at = %s
                            WHERE transfer_id = %s
                        """, (
                            eta_result.get("eta_text"), eta_result.get("distance_km"),
                            eta_result.get("duration_minutes") or eta_result.get("transit_minutes"),
                            eta_time, transfer_id
                        ))
                    return
        except Exception as e:
            logger.warning(f"Could not update stock transfer ETA in DB: {e}")

def get_purchase_orders() -> list:
    if is_configured():
        try:
            with get_conn() as conn:
                if conn:
                    import psycopg2.extras
                    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                        cur.execute("SELECT * FROM purchase_orders ORDER BY ts DESC")
                        return list(cur.fetchall())
        except Exception as e:
            logger.warning(f"Could not fetch purchase orders from DB: {e}")

    path = cfg.PURCHASE_ORDERS_FILE
    if os.path.exists(path) and os.path.getsize(path) > 0:
        try:
            df = pd.read_csv(path)
            rows = df.to_dict(orient="records")
            for r in rows:
                r["ts"] = r.get("timestamp")
            return rows
        except Exception:
            return []
    return []

def get_stock_transfers() -> list:
    if is_configured():
        try:
            with get_conn() as conn:
                if conn:
                    import psycopg2.extras
                    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                        cur.execute("SELECT * FROM stock_transfers ORDER BY ts DESC")
                        return list(cur.fetchall())
        except Exception as e:
            logger.warning(f"Could not fetch stock transfers from DB: {e}")

    path = cfg.STOCK_TRANSFERS_FILE
    if os.path.exists(path) and os.path.getsize(path) > 0:
        try:
            df = pd.read_csv(path)
            rows = df.to_dict(orient="records")
            for r in rows:
                r["ts"] = r.get("timestamp")
                r["eta_text"] = r.get("eta")
            return rows
        except Exception:
            return []
    return []

def get_hidden_row_ids() -> list:
    global _hidden_row_ids
    if is_configured():
        try:
            with get_conn() as conn:
                if conn:
                    with conn.cursor() as cur:
                        cur.execute("SELECT row_id FROM hidden_rows")
                        return [r[0] for r in cur.fetchall()]
        except Exception as e:
            logger.warning(f"Could not fetch hidden rows from DB: {e}")
    return list(_hidden_row_ids)

def hide_row(row_id: str):
    global _hidden_row_ids
    _hidden_row_ids.add(row_id)
    if is_configured():
        try:
            with get_conn() as conn:
                if conn:
                    with conn.cursor() as cur:
                        cur.execute("INSERT INTO hidden_rows (row_id) VALUES (%s) ON CONFLICT DO NOTHING", (row_id,))
        except Exception as e:
            logger.warning(f"Could not hide row in DB: {e}")

def unhide_row(row_id: str):
    global _hidden_row_ids
    _hidden_row_ids.discard(row_id)
    if is_configured():
        try:
            with get_conn() as conn:
                if conn:
                    with conn.cursor() as cur:
                        cur.execute("DELETE FROM hidden_rows WHERE row_id = %s", (row_id,))
        except Exception as e:
            logger.warning(f"Could not unhide row in DB: {e}")
