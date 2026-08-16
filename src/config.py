"""
RetailBrain AI - Configuration
Central place for paths, constants, and tunable parameters.
"""
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # project root (parent of src/)
DATA_DIR = os.path.join(BASE_DIR, "data")
OUTPUT_DIR = os.path.join(BASE_DIR, "outputs")
MODEL_DIR = os.path.join(BASE_DIR, "models")

SALES_FILE = os.path.join(DATA_DIR, "corrected_sales_dataset.csv")
PRODUCTS_FILE = os.path.join(DATA_DIR, "products.csv")
STORES_FILE = os.path.join(DATA_DIR, "stores.csv")
INVENTORY_FILE = os.path.join(DATA_DIR, "inventory.csv")
SUPPLIERS_FILE = os.path.join(DATA_DIR, "suppliers.csv")
PROCUREMENT_FILE = os.path.join(DATA_DIR, "procurement.csv")
PURCHASE_ORDERS_FILE = os.path.join(DATA_DIR, "purchase_orders_history.csv")
STOCK_TRANSFERS_FILE = os.path.join(DATA_DIR, "stock_transfers_history.csv")

# Forecasting
FORECAST_HORIZON_DAYS = 14          # how far ahead we forecast demand
TEST_HOLDOUT_DAYS = 60              # last N days held out for backtesting
LAG_DAYS = [1, 7, 14, 28]           # lag features for demand model
ROLLING_WINDOWS = [7, 14, 30]       # rolling mean/std windows

# Inventory
SERVICE_LEVEL_Z = 1.65              # ~95% service level for safety stock
OVERSTOCK_MULTIPLIER = 1.5          # stock > 1.5x forecasted 30-day demand => overstock

# Festival -> category demand-boost map (used for cold-start / explainability)
# Built from the actual Festival and Category values present in the dataset.
FESTIVAL_CATEGORY_BOOST = {
    "Diwali": ["Sweets & Chocolates", "Dry Fruits & Cereals", "Festive Specials", "Chips & Namkeen"],
    "Holi": ["Sweets & Chocolates", "Drinks & Juices", "Chips & Namkeen"],
    "New Year": ["Drinks & Juices", "Chips & Namkeen", "Sweets & Chocolates"],
    "Raksha Bandhan": ["Sweets & Chocolates", "Festive Specials", "Dry Fruits & Cereals"],
    "Exam Season": ["Stationery & Games", "Instant Food", "Tea, Coffee & Milk Drinks"],
}

RANDOM_STATE = 42
