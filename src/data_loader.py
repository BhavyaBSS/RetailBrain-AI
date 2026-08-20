"""
RetailBrain AI - Data Loader
Loads and lightly type-casts all six source tables with robust error handling.
"""
import logging
import os
from functools import lru_cache
import pandas as pd
from typing import Dict
from . import config as cfg
from . import db

# Set up logger
logger = logging.getLogger("RetailBrain_AI.DataLoader")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


@lru_cache(maxsize=8)
def _load_reference_csv(filepath: str, modified_ns: int) -> pd.DataFrame:
    """Cache immutable reference CSVs until their source file changes."""
    return pd.read_csv(filepath)


def _load_cached_reference(filepath: str) -> pd.DataFrame:
    return _load_reference_csv(filepath, os.stat(filepath).st_mtime_ns).copy()


def _verify_file_exists(filepath: str, name: str) -> None:
    """Helper to check if a file exists and is not empty."""
    if not os.path.exists(filepath):
        logger.error(f"Required data file missing: {filepath}")
        raise FileNotFoundError(f"Required source table '{name}' not found at path: {filepath}")
    if os.path.getsize(filepath) == 0:
        logger.error(f"Data file is empty: {filepath}")
        raise ValueError(f"Required source table '{name}' is empty: {filepath}")


def load_products() -> pd.DataFrame:
    """Loads the products SKU catalog."""
    _verify_file_exists(cfg.PRODUCTS_FILE, "products")
    try:
        df = _load_cached_reference(cfg.PRODUCTS_FILE)
        logger.info(f"Successfully loaded products: {len(df)} SKUs")
        return df
    except Exception as e:
        logger.exception("Failed to parse products CSV")
        raise e


def load_stores() -> pd.DataFrame:
    """Loads the store locations catalog."""
    _verify_file_exists(cfg.STORES_FILE, "stores")
    try:
        df = _load_cached_reference(cfg.STORES_FILE)
        logger.info(f"Successfully loaded stores: {len(df)} locations")
        return df
    except Exception as e:
        logger.exception("Failed to parse stores CSV")
        raise e


def load_inventory() -> pd.DataFrame:
    """Loads the store x product inventory snapshot.

    Reads from the database when DATABASE_URL is configured (live, current
    stock levels, shared across every device), and falls back to the
    original inventory.csv only when no database is set up (e.g. local dev).
    """
    if db.is_configured():
        try:
            rows = db.get_inventory()
            df = pd.DataFrame(rows)
            if df.empty:
                # No inventory rows in the DB yet (fresh setup, migration not run).
                # Fall back to CSV so the app still has something to work with.
                logger.warning("Inventory table is empty in the database; falling back to inventory.csv")
            else:
                df = df.rename(columns={
                    "store_id": "Store_ID",
                    "product_id": "Product_ID",
                    "current_stock": "Current_Stock",
                    "reserved_stock": "Reserved_Stock",
                    "safety_stock": "Safety_Stock",
                    "maximum_capacity": "Maximum_Capacity",
                })
                logger.info(f"Successfully loaded inventory from database: {len(df)} records")
                return df
        except Exception as e:
            logger.error(f"Failed to load inventory from database, falling back to CSV: {e}")

    _verify_file_exists(cfg.INVENTORY_FILE, "inventory")
    try:
        df = _load_cached_reference(cfg.INVENTORY_FILE)
        logger.info(f"Successfully loaded inventory snapshot from CSV: {len(df)} records")
        return df
    except Exception as e:
        logger.exception("Failed to parse inventory CSV")
        raise e


def load_suppliers() -> pd.DataFrame:
    """Loads the supplier price & lead time offers list."""
    _verify_file_exists(cfg.SUPPLIERS_FILE, "suppliers")
    try:
        df = _load_cached_reference(cfg.SUPPLIERS_FILE)
        logger.info(f"Successfully loaded supplier offers: {len(df)} records")
        return df
    except Exception as e:
        logger.exception("Failed to parse suppliers CSV")
        raise e


def load_procurement() -> pd.DataFrame:
    """Loads historical procurement purchase orders."""
    _verify_file_exists(cfg.PROCUREMENT_FILE, "procurement")
    try:
        df = pd.read_csv(cfg.PROCUREMENT_FILE, low_memory=False)
        df["Purchase_Date"] = pd.to_datetime(df["Purchase_Date"])
        df["Delivery_Date"] = pd.to_datetime(df["Delivery_Date"])
        logger.info(f"Successfully loaded procurement records: {len(df)} rows")
        return df
    except Exception as e:
        logger.exception("Failed to parse procurement CSV")
        raise e


def load_sales() -> pd.DataFrame:
    """Loads historical sales transactions."""
    _verify_file_exists(cfg.SALES_FILE, "sales")
    try:
        df = pd.read_csv(cfg.SALES_FILE, low_memory=False)
        df["Date"] = pd.to_datetime(df["Date"])
        logger.info(f"Successfully loaded sales dataset: {len(df)} rows")
        return df
    except Exception as e:
        logger.exception("Failed to parse sales CSV")
        raise e


def load_all() -> Dict[str, pd.DataFrame]:
    """Convenience loader returning every table as a dictionary."""
    logger.info("Starting batch load of all source datasets...")
    return {
        "sales": load_sales(),
        "products": load_products(),
        "stores": load_stores(),
        "inventory": load_inventory(),
        "suppliers": load_suppliers(),
        "procurement": load_procurement(),
    }
