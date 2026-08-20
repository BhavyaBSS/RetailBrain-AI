"""
RetailBrain AI - One-time migration: local CSVs -> Postgres
--------------------------------------------------------------
Run this ONCE, locally, from your project root, after setting DATABASE_URL.

    export DATABASE_URL="postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres"
    pip install psycopg2-binary pandas --break-system-packages   # if not already installed
    python3 migrate_to_db.py

What it does:
  1. Creates the tables in Postgres (safe to re-run, uses IF NOT EXISTS).
  2. Reads your existing data/purchase_orders_history.csv,
     data/stock_transfers_history.csv, and data/inventory.csv.
  3. Inserts every row into the matching Postgres table.
     Existing rows (same primary key) are skipped, not duplicated, so this
     is safe to run more than once if something goes wrong halfway.

After this runs successfully, your Aug 16-and-earlier history and current
stock levels will be in the database, and everything going forward
(new purchase orders, transfers, stock changes) will be written there too
by main.py, and will be visible identically on every device.
"""

import os
import sys
import pandas as pd
from datetime import datetime
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from src import db, config as cfg

IST = ZoneInfo("Asia/Kolkata")


def _parse_ts(raw) -> datetime:
    """Parses either a full ISO timestamp (new-format rows) or a bare
    'YYYY-MM-DD HH:MM:SS' string (old-format rows) into an aware datetime."""
    if pd.isna(raw) or raw == "":
        return datetime.now(IST)
    s = str(raw)
    try:
        dt = pd.to_datetime(s)
        if dt.tzinfo is None:
            dt = dt.tz_localize(IST)
        return dt.to_pydatetime()
    except Exception:
        return datetime.now(IST)


def _parse_delivery(raw) -> datetime:
    """Old rows only have a bare date (e.g. '2026-08-18') with no time info,
    so we fall back to 6:00 PM IST for those, matching the frontend's old
    display convention. New rows already have a full timestamp."""
    if pd.isna(raw) or raw == "":
        return None
    s = str(raw)
    if len(s) > 10 and "T" in s:
        return _parse_ts(s)
    return datetime.strptime(s[:10], "%Y-%m-%d").replace(
        hour=18, minute=0, second=0, tzinfo=IST
    )


def _num_or_none(v):
    if v is None or (isinstance(v, float) and pd.isna(v)) or v == "":
        return None
    return v


def migrate_purchase_orders():
    path = cfg.PURCHASE_ORDERS_FILE
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        print("No purchase_orders_history.csv found, skipping.")
        return
    df = pd.read_csv(path)
    count = 0
    for _, row in df.iterrows():
        db.insert_purchase_order({
            "po_number": row["po_number"],
            "ts": _parse_ts(row.get("timestamp")),
            "store_id": row["store_id"],
            "product_id": row["product_id"],
            "supplier_name": row["supplier_name"],
            "order_qty": int(row["order_qty"]),
            "total_cost": float(row["total_cost"]),
            "status": row.get("status", "DISPATCHED_TO_SUPPLIER"),
            "estimated_delivery": _parse_delivery(row.get("estimated_delivery")),
            "transit_minutes": _num_or_none(row.get("transit_minutes")),
            "distance_km": _num_or_none(row.get("distance_km")),
        })
        count += 1
    print(f"Migrated {count} purchase orders.")


def migrate_stock_transfers():
    path = cfg.STOCK_TRANSFERS_FILE
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        print("No stock_transfers_history.csv found, skipping.")
        return
    df = pd.read_csv(path)
    count = 0
    for _, row in df.iterrows():
        eta_at_raw = row.get("eta_at")
        db.insert_stock_transfer({
            "transfer_id": row["transfer_id"],
            "ts": _parse_ts(row.get("timestamp")),
            "from_store": row["from_store"],
            "to_store": row["to_store"],
            "product_id": row["product_id"],
            "transfer_qty": int(row["transfer_qty"]),
            "city": row["city"],
            "status": row.get("status", "IN_TRANSIT"),
            "eta_text": row.get("eta", None),
            "distance_km": _num_or_none(row.get("distance_km")),
            "eta_minutes": _num_or_none(row.get("eta_minutes")),
            "eta_at": _parse_ts(eta_at_raw) if eta_at_raw and not pd.isna(eta_at_raw) else None,
        })
        count += 1
    print(f"Migrated {count} stock transfers.")


def migrate_inventory():
    path = cfg.INVENTORY_FILE
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        print("No inventory.csv found, skipping.")
        return
    df = pd.read_csv(path)
    count = 0
    # One connection reused for all rows (faster and more resilient than
    # opening a fresh connection per row, which is what caused the earlier
    # DNS hiccup on a larger file).
    with db.get_conn() as conn:
        with conn.cursor() as cur:
            for _, row in df.iterrows():
                cur.execute(
                    """
                    INSERT INTO inventory
                        (store_id, product_id, current_stock, reserved_stock,
                         safety_stock, maximum_capacity)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (store_id, product_id) DO UPDATE SET
                        current_stock = EXCLUDED.current_stock,
                        reserved_stock = EXCLUDED.reserved_stock,
                        safety_stock = EXCLUDED.safety_stock,
                        maximum_capacity = EXCLUDED.maximum_capacity
                    """,
                    (
                        row["Store_ID"], row["Product_ID"],
                        int(row.get("Current_Stock", 0) or 0),
                        int(row.get("Reserved_Stock", 0) or 0),
                        int(row.get("Safety_Stock", 0) or 0),
                        int(row.get("Maximum_Capacity", 5000) or 5000),
                    ),
                )
                count += 1
    print(f"Migrated {count} inventory rows.")


if __name__ == "__main__":
    if not db.is_configured():
        print("ERROR: DATABASE_URL is not set. Export it first, e.g.:")
        print('  export DATABASE_URL="postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres"')
        sys.exit(1)

    print("Creating schema (if not already present)...")
    db.init_schema()

    print("\nMigrating purchase orders...")
    migrate_purchase_orders()

    print("\nMigrating stock transfers...")
    migrate_stock_transfers()

    print("\nMigrating inventory...")
    migrate_inventory()

    print("\nDone. Your existing data is now in Postgres.")
