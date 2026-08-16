"""
RetailBrain AI - Data Loader
Loads and lightly type-casts all six source tables with robust error handling.
"""
import logging
import os
import pandas as pd
from typing import Dict
from . import config as cfg

# Set up logger
logger = logging.getLogger("RetailBrain_AI.DataLoader")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


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
        df = pd.read_csv(cfg.PRODUCTS_FILE)
        logger.info(f"Successfully loaded products: {len(df)} SKUs")
        return df
    except Exception as e:
        logger.exception("Failed to parse products CSV")
        raise e


def load_stores() -> pd.DataFrame:
    """Loads the store locations catalog."""
    _verify_file_exists(cfg.STORES_FILE, "stores")
    try:
        df = pd.read_csv(cfg.STORES_FILE)
        logger.info(f"Successfully loaded stores: {len(df)} locations")
        return df
    except Exception as e:
        logger.exception("Failed to parse stores CSV")
        raise e


def load_inventory() -> pd.DataFrame:
    """Loads the store x product inventory snapshots."""
    _verify_file_exists(cfg.INVENTORY_FILE, "inventory")
    try:
        df = pd.read_csv(cfg.INVENTORY_FILE)
        logger.info(f"Successfully loaded inventory snapshot: {len(df)} records")
        return df
    except Exception as e:
        logger.exception("Failed to parse inventory CSV")
        raise e


def load_suppliers() -> pd.DataFrame:
    """Loads the supplier price & lead time offers list."""
    _verify_file_exists(cfg.SUPPLIERS_FILE, "suppliers")
    try:
        df = pd.read_csv(cfg.SUPPLIERS_FILE)
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
