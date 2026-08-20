"""
RetailBrain AI - Enterprise FastAPI Backend & Central Command Tower API
Serves dashboard APIs, real-time inventory risk monitoring, what-if scenario simulations,
ERP order dispatching, and triggers the automated LightGBM demand-forecasting pipeline.
"""
import os
import json
import logging
import subprocess
import time
import random
import io

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")

from typing import Dict, Any, List, Optional
import pandas as pd
import numpy as np
from fastapi import FastAPI, BackgroundTasks, HTTPException, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, PlainTextResponse

from src import config as cfg
from src import data_loader as dl
from src import traffic_eta
from src import db



# Set up logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("RetailBrain_AI.API")

app = FastAPI(
    title="RetailBrain AI - Central Command Tower API",
    description="Enterprise Decision Support & Inventory Optimization API for Quick-Commerce Logistics.",
    version="2.0.0"
)

# Enable CORS for local and remote control panel clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def _init_database():
    """Creates the Postgres tables (if missing) on startup. Logs a clear
    warning instead of crashing if DATABASE_URL isn't set yet, so the app
    still runs for local dev without a database configured."""
    if db.is_configured():
        try:
            db.init_schema()
        except Exception as e:
            logger.error(f"Failed to initialize database schema: {e}")
    else:
        logger.warning(
            "DATABASE_URL is not set — purchase orders, stock transfers, and "
            "inventory updates will NOT persist across restarts."
        )

# Global process tracker for pipeline execution
pipeline_state = {
    "is_running": False,
    "started_at": None,
    "completed_at": None,
    "exit_code": None,
    "log_file": os.path.join(cfg.OUTPUT_DIR, "pipeline_run.log")
}

# Define schema validation configurations
SCHEMAS = {
    "sales": {
        "columns": {
            "Transaction_ID": "object",
            "Date": "datetime",
            "Store_ID": "object",
            "Product_ID": "object",
            "Quantity_Sold": "int",
            "Selling_Price": "float",
            "Gross_Amount": "float",
            "Discount_Percentage": "float",
            "Discount_Amount": "float",
            "Revenue": "float",
            "Profit": "float",
            "Festival": "object",
            "Season": "object"
        },
        "non_negative": ["Quantity_Sold", "Selling_Price", "Gross_Amount", "Discount_Percentage", "Discount_Amount", "Revenue"]
    },
    "inventory": {
        "columns": {
            "Store_ID": "object",
            "Product_ID": "object",
            "Current_Stock": "int",
            "Reserved_Stock": "int",
            "Safety_Stock": "int",
            "Maximum_Capacity": "int"
        },
        "non_negative": ["Current_Stock", "Reserved_Stock", "Safety_Stock", "Maximum_Capacity"]
    },
    "products": {
        "columns": {
            "Product_ID": "object",
            "Product_Name": "object",
            "Category": "object",
            "Brand": "object",
            "MRP": "float",
            "Selling_Price": "float",
            "Cost_Price": "float",
            "Shelf_Life": "int",
            "Unit": "object"
        },
        "non_negative": ["MRP", "Selling_Price", "Cost_Price", "Shelf_Life"]
    },
    "stores": {
        "columns": {
            "Store_ID": "object",
            "Store_Name": "object",
            "City": "object",
            "Locality": "object",
            "Store_Type": "object",
            "Capacity": "int",
            "Latitude": "float",
            "Longitude": "float"
        },
        "non_negative": ["Capacity"]
    },
    "suppliers": {
        "columns": {
            "Supplier_ID": "object",
            "Supplier_Name": "object",
            "Product_ID": "object",
            "Supplier_Price": "float",
            "Lead_Time": "int",
            "Minimum_Order": "int",
            "Supplier_Rating": "float"
        },
        "non_negative": ["Supplier_Price", "Lead_Time", "Minimum_Order", "Supplier_Rating"]
    }
}

def validate_csv_schema(target: str, df: pd.DataFrame) -> None:
    if target not in SCHEMAS:
        return
        
    schema = SCHEMAS[target]
    expected_cols = list(schema["columns"].keys())
    
    # 1. Column presence check
    missing_cols = [col for col in expected_cols if col not in df.columns]
    if missing_cols:
        raise ValueError(f"Missing required columns for '{target}': {missing_cols}")
        
    # 2. Check for empty dataframe
    if df.empty:
        raise ValueError("Dataframe is empty.")
        
    # 3. Type checking and validation
    for col, dtype in schema["columns"].items():
        if dtype == "datetime":
            try:
                parsed = pd.to_datetime(df[col])
                if parsed.isna().any():
                    raise ValueError(f"Column '{col}' contains unparseable or missing date values.")
            except Exception as e:
                raise ValueError(f"Column '{col}' must contain valid date formats. Details: {e}")
        elif dtype == "int":
            if not pd.api.types.is_numeric_dtype(df[col]):
                raise ValueError(f"Column '{col}' must be numeric (integer).")
            # Check for non-null integer-like values
            if (df[col] % 1 != 0).any():
                raise ValueError(f"Column '{col}' must contain whole numbers (integers).")
        elif dtype == "float":
            if not pd.api.types.is_numeric_dtype(df[col]):
                raise ValueError(f"Column '{col}' must be numeric.")
                
    # 4. Non-negative constraints
    for col in schema.get("non_negative", []):
        if (df[col] < 0).any():
            raise ValueError(f"Column '{col}' cannot contain negative values.")

# Helper functions for CSV dispatch history persistence
PO_COLUMNS = ["po_number", "timestamp", "store_id", "product_id", "supplier_name", "order_qty", "total_cost", "status", "estimated_delivery"]
TRANSFER_COLUMNS = ["transfer_id", "timestamp", "from_store", "to_store", "product_id", "transfer_qty", "city", "status", "eta"]

def load_csv_history(file_path: str) -> List[Dict[str, Any]]:
    if not os.path.exists(file_path) or os.path.getsize(file_path) == 0:
        return []
    try:
        df = pd.read_csv(file_path)
        return df.fillna("").to_dict(orient="records")
    except Exception as e:
        logger.error(f"Error reading history CSV {file_path}: {e}")
        return []

def append_csv_history(file_path: str, entry: Dict[str, Any]) -> None:
    df_new = pd.DataFrame([entry])
    if os.path.exists(file_path) and os.path.getsize(file_path) > 0:
        try:
            df_old = pd.read_csv(file_path)
            df_combined = pd.concat([df_old, df_new], ignore_index=True)
            df_combined.to_csv(file_path, index=False)
        except Exception as e:
            logger.error(f"Error appending to history CSV {file_path}: {e}")
            df_new.to_csv(file_path, index=False)
    else:
        df_new.to_csv(file_path, index=False)

def mark_history_completed():
    for file_path in [cfg.PURCHASE_ORDERS_FILE, cfg.STOCK_TRANSFERS_FILE]:
        if os.path.exists(file_path) and os.path.getsize(file_path) > 0:
            try:
                df = pd.read_csv(file_path)
                if "status" in df.columns:
                    df["status"] = "COMPLETED"
                    df.to_csv(file_path, index=False)
            except Exception as e:
                logger.error(f"Error marking history as completed in {file_path}: {e}")

def run_pipeline_worker():
    """Worker function to execute the demand forecasting & profit optimization pipeline."""
    global pipeline_state
    pipeline_state["is_running"] = True
    pipeline_state["started_at"] = time.time()
    pipeline_state["completed_at"] = None
    pipeline_state["exit_code"] = None
    
    logger.info("Starting background execution of RetailBrain AI pipeline...")
    os.makedirs(cfg.OUTPUT_DIR, exist_ok=True)
    
    try:
        with open(pipeline_state["log_file"], "w", encoding="utf-8") as f:
            p = subprocess.Popen(
                ["python", "run_pipeline.py"],
                stdout=f,
                stderr=subprocess.STDOUT,
                cwd=cfg.BASE_DIR
            )
            p.wait()
            pipeline_state["exit_code"] = p.returncode
            logger.info(f"Pipeline execution finished with exit code {p.returncode}")
    except Exception as e:
        logger.exception("Exception occurred during background pipeline execution")
        with open(pipeline_state["log_file"], "a", encoding="utf-8") as f:
            f.write(f"\n[FATAL ERROR] API Worker exception: {str(e)}\n")
        pipeline_state["exit_code"] = -1
    finally:
        pipeline_state["is_running"] = False
        pipeline_state["completed_at"] = time.time()


# ==========================================
# 📊 CORE DASHBOARD & KPI API ENDPOINTS
# ==========================================

@app.get("/api/summary", response_model=Dict[str, Any])
def get_summary():
    """Returns executive KPIs, with inventory operations derived live."""
    summary_path = os.path.join(cfg.OUTPUT_DIR, "dashboard_summary.json")
    if not os.path.exists(summary_path):
        # Historical/model values have no live source; inventory values below do.
        summary = {
            "total_stores": 100,
            "total_products": 35,
            "total_historical_revenue": 345000000.0,
            "total_historical_profit": 89000000.0,
            "combos_needing_reorder": 1394,
            "combos_overstocked": 228,
            "stock_transfer_recommendations": 303,
            "products_with_rising_prices": 0,
            "total_expected_profit_uplift_next_horizon": 2564166.0,
            "forecast_model_wape_overall": 0.09857,
            "forecast_model_wape_festival_days": 0.11350,
            "forecast_model_wape_normal_days": 0.09762
        }
    else:
        try:
            with open(summary_path, "r", encoding="utf-8") as f:
                summary = json.load(f)
        except Exception as e:
            logger.error(f"Error reading dashboard summary: {e}")
            raise HTTPException(status_code=500, detail="Error reading dashboard summary.")

    operational = _get_live_operational_inventory()
    summary.update({
        "combos_needing_reorder": operational["reorder_count"],
        "combos_overstocked": operational["overstock_count"],
        "stock_transfer_recommendations": len(operational["transfers"]),
    })
    return summary


@app.get("/api/recommendations")
def get_recommendations(
    category: Optional[str] = None, 
    store: Optional[str] = None, 
    min_profit: float = 0.0,
    search: Optional[str] = None
):
    """Returns profit-ranked procurement recommendations with advanced filtering."""
    recs_path = os.path.join(cfg.OUTPUT_DIR, "profit_optimization_recommendations.csv")
    if not os.path.exists(recs_path):
        raise HTTPException(status_code=404, detail="Procurement recommendations data not found. Please run pipeline.")
    
    try:
        df = pd.read_csv(recs_path)
        if category and category.lower() != "all":
            df = df[df["Category"].str.lower() == category.lower()]
        if store and store.lower() != "all":
            df = df[df["Store_ID"].str.lower() == store.lower()]
        if min_profit > 0:
            df = df[df["expected_profit"] >= min_profit]
        if search:
            q = search.lower()
            df = df[
                df["Product_Name"].str.lower().str.contains(q) |
                df["Product_ID"].str.lower().str.contains(q) |
                df["Store_ID"].str.lower().str.contains(q) |
                df["Best_Supplier_Name"].str.lower().str.contains(q)
            ]
            
        df = df.fillna("")
        return df.to_dict(orient="records")
    except Exception as e:
        logger.error(f"Error loading recommendations: {e}")
        raise HTTPException(status_code=500, detail="Error loading recommendations.")


@app.get("/api/transfers")
def get_transfers(city: Optional[str] = None, product: Optional[str] = None):
    """Returns live inter-store stock transfer recommendations."""
    try:
        df = _get_live_operational_inventory()["transfers"]
        if city and city.lower() != "all":
            df = df[df["City"].str.lower() == city.lower()]
        if product and product.lower() != "all":
            df = df[df["Product_ID"].str.lower() == product.lower()]
            
        df = df.fillna("")
        return df.to_dict(orient="records")
    except Exception as e:
        logger.error(f"Error loading transfers: {e}")
        raise HTTPException(status_code=500, detail="Error loading stock transfers.")


@app.get("/api/trends")
def get_trends():
    """Returns supplier price trends and multi-criteria rankings."""
    trends_path = os.path.join(cfg.OUTPUT_DIR, "supplier_price_trends.csv")
    ranks_path = os.path.join(cfg.OUTPUT_DIR, "supplier_rankings.csv")
    
    if not os.path.exists(trends_path) or not os.path.exists(ranks_path):
        raise HTTPException(status_code=404, detail="Supplier rankings or price trends not found.")
    
    try:
        trends_df = pd.read_csv(trends_path).fillna("")
        ranks_df = pd.read_csv(ranks_path).fillna("")
        return {
            "price_trends": trends_df.to_dict(orient="records"),
            "supplier_rankings": ranks_df.to_dict(orient="records")
        }
    except Exception as e:
        logger.error(f"Error loading supplier analytics: {e}")
        raise HTTPException(status_code=500, detail="Error loading supplier analytics.")


@app.get("/api/suppliers/compare")
def compare_suppliers(product_id: Optional[str] = None):
    """
    Returns side-by-side supplier comparisons for all 35 product SKUs.
    Enables logistics managers to compare Wholesale Price, Lead Time, Quality Rating, and Min Order Qty.
    """
    try:
        suppliers = dl.load_suppliers()
        products = dl.load_products()
        
        merged = suppliers.merge(
            products[["Product_ID", "Product_Name", "Category", "Selling_Price", "Cost_Price"]],
            on="Product_ID",
            how="left"
        )
        
        if product_id and product_id.lower() != "all":
            merged = merged[merged["Product_ID"].str.lower() == product_id.lower()]
            
        from src import supplier_optimizer as sup_opt
        ranked = sup_opt.rank_suppliers(suppliers)
        
        merged = merged.merge(
            ranked[["Supplier_ID", "supplier_score", "rank_in_product"]],
            on="Supplier_ID",
            how="left"
        )
        
        return merged.fillna("").to_dict(orient="records")
    except Exception as e:
        logger.error(f"Error comparing suppliers: {e}")
        raise HTTPException(status_code=500, detail="Error comparing suppliers.")


@app.post("/api/suppliers/rank-custom")
def rank_suppliers_custom(
    w_price: float = Body(0.50, embed=True),
    w_lead_time: float = Body(0.20, embed=True),
    w_rating: float = Body(0.30, embed=True)
):
    """
    Recalculates multi-criteria supplier ranks dynamically based on manager weight preferences.
    Weights: Price (Profit Maximization), Lead Time (On-time Delivery), Quality Rating (Freshness/Quality).
    """
    try:
        from src import supplier_optimizer as sup_opt
        suppliers = dl.load_suppliers()
        products = dl.load_products()
        
        # Normalize weights to sum to 1.0
        tot = w_price + w_lead_time + w_rating
        if tot == 0:
            tot = 1.0
        weights = {
            "price": round(w_price / tot, 2),
            "lead_time": round(w_lead_time / tot, 2),
            "rating": round(w_rating / tot, 2)
        }
        
        ranked = sup_opt.rank_suppliers(suppliers, weights=weights)
        merged = ranked.merge(
            products[["Product_ID", "Product_Name", "Category", "Selling_Price"]],
            on="Product_ID",
            how="left"
        )
        
        return {
            "status": "success",
            "applied_weights": weights,
            "rankings": merged.fillna("").to_dict(orient="records")
        }
    except Exception as e:
        logger.error(f"Error in custom supplier ranking: {e}")
        raise HTTPException(status_code=500, detail="Error recalculating supplier rankings.")


# ==========================================
# 🏬 MASTER DATA & LIVE NETWORK TELEMETRY
# ==========================================

def classify_stock_risk(current_stock, safety_stock):
    """
    Shared stock-risk classification, used by BOTH /api/stores (for the
    Health Score / Reorder Alerts header stats) and /api/inventory/live
    (for the per-SKU cards and filter pills), so the two numbers shown
    on the same store drawer are always derived from one live rule
    instead of drifting apart from two separate calculations.
    """
    if current_stock <= (safety_stock * 0.5):
        return "CRITICAL_STOCKOUT"
    elif current_stock <= safety_stock:
        return "REORDER_NEEDED"
    elif current_stock >= (safety_stock * 3.5):
        return "OVERSTOCKED"
    return "OPTIMAL"


def _get_live_operational_inventory() -> Dict[str, Any]:
    """Build live inventory KPIs and transfer actions from current stock."""
    inventory = dl.load_inventory().copy()
    stores = dl.load_stores()[["Store_ID", "City"]]
    inventory["Available_Stock"] = (
        inventory["Current_Stock"] - inventory["Reserved_Stock"]
    ).clip(lower=0)
    inventory["Risk_State"] = inventory.apply(
        lambda row: classify_stock_risk(row["Current_Stock"], row["Safety_Stock"]), axis=1
    )
    inventory = inventory.merge(stores, on="Store_ID", how="left")

    transfers = []
    for (product_id, city), group in inventory.groupby(["Product_ID", "City"], dropna=False):
        donors = group[group["Risk_State"] == "OVERSTOCKED"].copy()
        recipients = group[group["Risk_State"].isin(["CRITICAL_STOCKOUT", "REORDER_NEEDED"])].copy()
        if donors.empty or recipients.empty:
            continue

        donors["available_qty"] = (donors["Available_Stock"] - donors["Safety_Stock"]).clip(lower=0)
        recipients["needed_qty"] = (recipients["Safety_Stock"] - recipients["Available_Stock"]).clip(lower=0)
        donors = donors.sort_values("available_qty", ascending=False).reset_index(drop=True)
        recipients = recipients.sort_values("needed_qty", ascending=False).reset_index(drop=True)
        donor_index = recipient_index = 0
        donor_pool = donors["available_qty"].tolist()
        recipient_pool = recipients["needed_qty"].tolist()

        while donor_index < len(donor_pool) and recipient_index < len(recipient_pool):
            quantity = int(min(donor_pool[donor_index], recipient_pool[recipient_index]))
            if quantity > 0:
                transfers.append({
                    "Product_ID": product_id,
                    "City": city or "Unknown",
                    "From_Store": donors.loc[donor_index, "Store_ID"],
                    "To_Store": recipients.loc[recipient_index, "Store_ID"],
                    "Transfer_Qty": quantity,
                })
            donor_pool[donor_index] -= quantity
            recipient_pool[recipient_index] -= quantity
            if donor_pool[donor_index] <= 0:
                donor_index += 1
            if recipient_pool[recipient_index] <= 0:
                recipient_index += 1

    return {
        "reorder_count": int(inventory["Risk_State"].isin(["CRITICAL_STOCKOUT", "REORDER_NEEDED"]).sum()),
        "overstock_count": int((inventory["Risk_State"] == "OVERSTOCKED").sum()),
        "transfers": pd.DataFrame(transfers, columns=["Product_ID", "City", "From_Store", "To_Store", "Transfer_Qty"]),
    }


@app.get("/api/stores")
def get_stores():
    """Returns dark store network master profiles across cities."""
    try:
        stores = dl.load_stores()
        inv = dl.load_inventory()

        # Live reorder count per store: SKUs currently classified as
        # CRITICAL_STOCKOUT or REORDER_NEEDED, using the same rule as
        # /api/inventory/live — not a precomputed/batch file that can go
        # stale relative to what the SKU drawer actually shows.
        inv = inv.copy()
        inv["Risk_State"] = inv.apply(
            lambda row: classify_stock_risk(row["Current_Stock"], row["Safety_Stock"]), axis=1
        )
        needs_reorder = inv[inv["Risk_State"].isin(["CRITICAL_STOCKOUT", "REORDER_NEEDED"])]
        reorder_counts = needs_reorder["Store_ID"].value_counts().to_dict()

        records = stores.to_dict(orient="records")
        for st in records:
            s_id = st["Store_ID"]
            st["reorder_alerts_count"] = reorder_counts.get(s_id, 0)
            st["health_score"] = max(60, 100 - (st["reorder_alerts_count"] * 2))
            st["status"] = "OPTIMAL" if st["health_score"] >= 85 else ("ATTENTION" if st["health_score"] >= 70 else "CRITICAL")
            
        return records
    except Exception as e:
        logger.error(f"Error reading stores master: {e}")
        raise HTTPException(status_code=500, detail="Error reading stores catalog.")


@app.get("/api/products")
def get_products():
    """Returns master SKU catalog with unit economics."""
    try:
        products = dl.load_products()
        products["Gross_Margin_Percent"] = (
            ((products["Selling_Price"] - products["Cost_Price"]) / products["Selling_Price"]) * 100
        ).round(1)
        return products.to_dict(orient="records")
    except Exception as e:
        logger.error(f"Error reading products master: {e}")
        raise HTTPException(status_code=500, detail="Error reading products catalog.")


@app.get("/api/inventory/live")
def get_live_inventory(store_id: Optional[str] = None, category: Optional[str] = None):
    """Returns granular live stock telemetry with stockout risk indicators."""
    try:
        inv = dl.load_inventory()
        prods = dl.load_products()
        stores = dl.load_stores()
        
        merged = inv.merge(prods[["Product_ID", "Product_Name", "Category", "Selling_Price"]], on="Product_ID", how="left")
        merged = merged.merge(stores[["Store_ID", "Store_Name", "City"]], on="Store_ID", how="left")
        
        if store_id and store_id.lower() != "all":
            merged = merged[merged["Store_ID"].str.lower() == store_id.lower()]
        if category and category.lower() != "all":
            merged = merged[merged["Category"].str.lower() == category.lower()]
            
        # Classify risk state using the same shared rule as /api/stores
        merged["Risk_State"] = merged.apply(
            lambda row: classify_stock_risk(row["Current_Stock"], row["Safety_Stock"]), axis=1
        )
        merged["Available_Stock"] = merged["Current_Stock"] - merged["Reserved_Stock"]
        
        return merged.fillna("").to_dict(orient="records")
    except Exception as e:
        logger.error(f"Error fetching live inventory: {e}")
        raise HTTPException(status_code=500, detail="Error fetching live inventory.")


@app.get("/api/forecast-chart")
def get_forecast_chart(store_id: str = "BST-001", product_id: str = "PROD-001"):
    """Returns 14-day future demand forecast curves for interactive ApexCharts rendering."""
    forecast_path = os.path.join(cfg.OUTPUT_DIR, "demand_forecast_next_14_days.csv")
    if not os.path.exists(forecast_path):
        # Fallback dummy curve if forecast has not run
        dates = [f"2026-01-{i:02d}" for i in range(1, 15)]
        values = [round(random.uniform(15, 35), 1) for _ in dates]
        return {"dates": dates, "forecast": values, "store_id": store_id, "product_id": product_id}
        
    try:
        df = pd.read_csv(forecast_path)
        sub = df[(df["Store_ID"] == store_id) & (df["Product_ID"] == product_id)]
        if sub.empty:
            sub = df[(df["Product_ID"] == product_id)].head(14)
            
        dates = sub["Date"].tolist()
        vals = [round(v, 2) for v in sub["Predicted_Quantity"].tolist()]
        return {
            "dates": dates,
            "forecast": vals,
            "store_id": store_id,
            "product_id": product_id
        }
    except Exception as e:
        logger.error(f"Error generating chart data: {e}")
        raise HTTPException(status_code=500, detail="Error generating chart data.")


# ==========================================
# ⚡ WHAT-IF SCENARIO SIMULATION ENGINE
# ==========================================

@app.post("/api/simulate")
def run_scenario_simulation(
    demand_surge_percent: float = Body(0.0, embed=True),
    lead_time_buffer_days: int = Body(0, embed=True),
    target_service_level: float = Body(0.95, embed=True),
    festival_boost: Optional[str] = Body(None, embed=True)
):
    """
    Executes a real-time 'What-If' scenario simulation.
    Allows central logistics managers to dynamically test demand spikes, supplier delays,
    and service-level targets without corrupting baseline database records.
    """
    try:
        recs_path = os.path.join(cfg.OUTPUT_DIR, "profit_optimization_recommendations.csv")
        if not os.path.exists(recs_path):
            raise HTTPException(status_code=400, detail="Base recommendations missing. Please run pipeline first.")
            
        df = pd.read_csv(recs_path)
        
        # Apply multipliers
        surge_mult = 1.0 + (demand_surge_percent / 100.0)
        
        # Service level Z-score lookup
        z_score = 1.65 if target_service_level >= 0.95 else (1.28 if target_service_level >= 0.90 else 2.05)
        
        simulated_results = []
        total_uplift = 0.0
        total_units = 0
        
        for _, row in df.head(100).iterrows():
            orig_qty = row["recommended_order_qty"]
            unit_profit = row["Selling_Price"] - row["Best_Supplier_Price"]
            
            # Apply surge & buffer
            sim_qty = int(np.ceil(orig_qty * surge_mult * (1.0 + (lead_time_buffer_days * 0.05))))
            
            if festival_boost and festival_boost.lower() != "none":
                # Check category boost map
                boosted_cats = cfg.FESTIVAL_CATEGORY_BOOST.get(festival_boost, [])
                if row["Category"] in boosted_cats:
                    sim_qty = int(sim_qty * 1.30)
                    
            sim_revenue = round(sim_qty * row["Selling_Price"], 2)
            sim_cost = round(sim_qty * row["Best_Supplier_Price"], 2)
            sim_profit = round(sim_revenue - sim_cost - (sim_cost * 0.02), 2)
            
            total_uplift += sim_profit
            total_units += sim_qty
            
            simulated_results.append({
                "Store_ID": row["Store_ID"],
                "Product_ID": row["Product_ID"],
                "Product_Name": row["Product_Name"],
                "Category": row["Category"],
                "Baseline_Order_Qty": orig_qty,
                "Simulated_Order_Qty": sim_qty,
                "Best_Supplier_Name": row["Best_Supplier_Name"],
                "Simulated_Cost": sim_cost,
                "Simulated_Profit": sim_profit
            })
            
        return {
            "status": "success",
            "scenario_parameters": {
                "demand_surge_percent": demand_surge_percent,
                "lead_time_buffer_days": lead_time_buffer_days,
                "target_service_level": target_service_level,
                "festival_boost": festival_boost or "None"
            },
            "summary": {
                "simulated_total_order_units": total_units,
                "simulated_total_profit_uplift": round(total_uplift, 2),
                "baseline_total_profit_uplift": round(df["expected_profit"].sum(), 2),
                "net_profit_delta": round(total_uplift - df.head(100)["expected_profit"].sum(), 2)
            },
            "sample_simulated_items": simulated_results[:15]
        }
    except Exception as e:
        logger.error(f"Error running simulation: {e}")
        raise HTTPException(status_code=500, detail=f"Simulation error: {str(e)}")


# ==========================================
# 🚀 REAL-TIME ERP & WMS ACTION DISPATCHERS
# ==========================================

def update_inventory_stock(store_id: str, product_id: str, qty_change: int) -> None:
    try:
        inv_path = cfg.INVENTORY_FILE
        if not os.path.exists(inv_path):
            logger.error(f"inventory.csv not found at {inv_path} during update")
            return
        df = pd.read_csv(inv_path)
        
        # Check if the row exists
        mask = (df["Store_ID"] == store_id) & (df["Product_ID"] == product_id)
        if mask.any():
            # Adjust the Current_Stock
            df.loc[mask, "Current_Stock"] = (df.loc[mask, "Current_Stock"] + qty_change).clip(lower=0)
            logger.info(f"Updated inventory for Store {store_id}, Product {product_id} by {qty_change}. New stock: {df.loc[mask, 'Current_Stock'].values[0]}")
        else:
            # Create a new row if it doesn't exist
            new_row = {
                "Store_ID": store_id,
                "Product_ID": product_id,
                "Current_Stock": max(0, qty_change),
                "Reserved_Stock": 0,
                "Safety_Stock": 0,
                "Maximum_Capacity": 5000 # default fallback
            }
            df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
            logger.info(f"Created new inventory row for Store {store_id}, Product {product_id} with stock {qty_change}")
            
        df.to_csv(inv_path, index=False)
    except Exception as e:
        logger.error(f"Failed to update stock in inventory.csv: {e}")


@app.post("/api/action/approve-po")
def approve_purchase_order(
    store_id: str = Body(..., embed=True),
    product_id: str = Body(..., embed=True),
    supplier_name: str = Body(..., embed=True),
    order_qty: int = Body(..., embed=True),
    total_cost: float = Body(..., embed=True)
):
    """
    Approves a Purchase Order, writes to history CSV, and updates the local inventory dataset.
    """
    po_number = f"PO-BLK-{random.randint(100000, 999999)}"
    transaction_time = datetime.now(IST)

    # Distance + live-traffic transit time (supplier -> store). This does
    # NOT read or touch the supplier's Lead_Time field — that stays exactly
    # as used elsewhere on the classic dashboard.
    eta_result = traffic_eta.get_supplier_transfer_eta(
        supplier_name, product_id, store_id, cfg.SUPPLIERS_FILE, cfg.STORES_FILE
    )
    lead_days = eta_result["total_lead_days"]

    dispatch_entry = {
        "po_number": po_number,
        "timestamp": transaction_time.isoformat(),
        "store_id": store_id,
        "product_id": product_id,
        "supplier_name": supplier_name,
        "order_qty": order_qty,
        "total_cost": total_cost,
        "status": "DISPATCHED_TO_SUPPLIER",
        "transit_minutes": eta_result["transit_minutes"],
        "distance_km": eta_result["distance_km"],
        "estimated_delivery": (
            transaction_time + timedelta(days=lead_days)
        ).isoformat()
    }

    # Persist action to the database (survives restarts, synced across every device)
    db.insert_purchase_order({
        "po_number": po_number,
        "ts": transaction_time,
        "store_id": store_id,
        "product_id": product_id,
        "supplier_name": supplier_name,
        "order_qty": order_qty,
        "total_cost": total_cost,
        "status": "DISPATCHED_TO_SUPPLIER",
        "estimated_delivery": transaction_time + timedelta(days=lead_days),
        "transit_minutes": eta_result["transit_minutes"],
        "distance_km": eta_result["distance_km"],
    })

    # Update live inventory stock levels in the database
    db.update_inventory_stock(store_id, product_id, order_qty)
    
    logger.info(f"CENTRAL ACTION: Purchase Order {po_number} approved for Store {store_id}, Product {product_id}")
    return {
        "success": True,
        "message": f"Purchase Order {po_number} successfully dispatched to {supplier_name} via ERP Integration.",
        "order_details": dispatch_entry
    }


@app.post("/api/action/approve-transfer")
def approve_stock_transfer(
    from_store: str = Body(..., embed=True),
    to_store: str = Body(..., embed=True),
    product_id: str = Body(..., embed=True),
    transfer_qty: int = Body(..., embed=True),
    city: str = Body(..., embed=True)
):
    """
    Approves an inter-store stock transfer and updates database inventory atomically.
    """
    transfer_id = f"TRK-{city[:3].upper()}-{random.randint(1000, 9999)}"
    transaction_time = datetime.now(IST)

    # Live-traffic ETA based on real store coordinates (Stores_Registry),
    # instead of a hardcoded 45 minutes.
    eta_result = traffic_eta.get_store_transfer_eta(from_store, to_store, cfg.STORES_FILE)
    eta_time = transaction_time + timedelta(minutes=eta_result["duration_minutes"])

    transfer_entry = {
        "transfer_id": transfer_id,
        "timestamp": transaction_time.isoformat(),
        "from_store": from_store,
        "to_store": to_store,
        "product_id": product_id,
        "transfer_qty": transfer_qty,
        "city": city,
        "status": "IN_TRANSIT",
        "distance_km": eta_result["distance_km"],
        "eta": traffic_eta.format_eta_for_log(eta_result),
        "eta_minutes": eta_result["duration_minutes"],
        "eta_at": eta_time.isoformat()
    }

    # Persist the action and both stock movements together.
    db_entry = {
        "transfer_id": transfer_id,
        "ts": transaction_time,
        "from_store": from_store,
        "to_store": to_store,
        "product_id": product_id,
        "transfer_qty": transfer_qty,
        "city": city,
        "status": "IN_TRANSIT",
        "eta_text": traffic_eta.format_eta_for_log(eta_result),
        "distance_km": eta_result["distance_km"],
        "eta_minutes": eta_result["duration_minutes"],
        "eta_at": eta_time,
    }
    try:
        db.record_stock_transfer_and_update_inventory(db_entry)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    logger.info(f"CENTRAL ACTION: Stock Transfer {transfer_id} approved from {from_store} -> {to_store}")
    return {
        "success": True,
        "message": f"Stock Transfer Truck {transfer_id} dispatched from {from_store} to {to_store} ({transfer_qty} units).",
        "transfer_details": transfer_entry
    }


@app.get("/api/action/dispatch-history")
def get_dispatch_history():
    """Returns audit log of all Central Manager actions, read from the database
    so every device sees the same, persisted data."""
    pos = db.get_purchase_orders()
    transfers = db.get_stock_transfers()

    def _iso(row, keys):
        for k in keys:
            if row.get(k) is not None and hasattr(row[k], "isoformat"):
                row[k] = row[k].isoformat()
        return row

    pos = [_iso(dict(r), ["ts", "estimated_delivery"]) for r in pos]
    transfers = [_iso(dict(r), ["ts", "eta_at"]) for r in transfers]

    # Rename DB columns back to the field names the frontend already expects
    for r in pos:
        r["timestamp"] = r.pop("ts", None)
        r["eta"] = None  # POs don't use the transfer-style eta text field
    for r in transfers:
        r["timestamp"] = r.pop("ts", None)
        r["eta"] = r.pop("eta_text", None)

    return {
        "purchase_orders": pos,
        "stock_transfers": transfers
    }


@app.get("/api/action/hidden-rows")
def get_hidden_rows():
    """Returns the set of audit-log row IDs dismissed ('Removed') by any
    device. Synced across devices instead of living in one browser's
    localStorage."""
    return {"hidden_ids": db.get_hidden_row_ids()}


@app.post("/api/action/hidden-rows")
def set_hidden_row(
    row_id: str = Body(..., embed=True),
    hidden: bool = Body(..., embed=True),
):
    """Marks a row as removed/restored. Any device calling this changes what
    every other device sees on next refresh."""
    if hidden:
        db.hide_row(row_id)
    else:
        db.unhide_row(row_id)
    return {"success": True, "row_id": row_id, "hidden": hidden}


# ==========================================
# ⚙️ PIPELINE EXECUTION & SYSTEM LOGS
# ==========================================

@app.post("/api/data/ingest-csv")
def ingest_new_data(
    target_dataset: str = Body(..., embed=True),
    raw_csv_content: str = Body(..., embed=True),
    auto_trigger_retrain: bool = Body(True, embed=True),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """
    Ingests new continuous CSV records into the target dataset file in data/ directory.
    Automatically triggers the background pipeline worker to retrain LightGBM and update forecasts.
    """
    valid_targets = {
        "sales": os.path.basename(cfg.SALES_FILE),
        "inventory": os.path.basename(cfg.INVENTORY_FILE),
        "products": os.path.basename(cfg.PRODUCTS_FILE),
        "suppliers": os.path.basename(cfg.SUPPLIERS_FILE),
        "stores": os.path.basename(cfg.STORES_FILE)
    }
    
    if target_dataset not in valid_targets:
        raise HTTPException(status_code=400, detail=f"Invalid target dataset. Must be one of {list(valid_targets.keys())}")
        
    file_name = valid_targets[target_dataset]
    file_path = os.path.join(cfg.DATA_DIR, file_name)
    
    try:
        new_df = pd.read_csv(io.StringIO(raw_csv_content.strip()))
        if new_df.empty:
            raise HTTPException(status_code=400, detail="Uploaded CSV data is empty.")
            
        # Validate schema before writing
        try:
            validate_csv_schema(target_dataset, new_df)
        except ValueError as val_err:
            logger.warning(f"Schema validation failed for target '{target_dataset}': {val_err}")
            raise HTTPException(status_code=400, detail=f"Schema validation error: {str(val_err)}")
            
        if os.path.exists(file_path):
            existing_df = pd.read_csv(file_path)
            combined_df = pd.concat([existing_df, new_df], ignore_index=True).drop_duplicates()
            combined_df.to_csv(file_path, index=False)
            msg = f"Successfully appended data to {file_name}. Total rows: {len(combined_df)} (Added {len(new_df)} new rows)."
        else:
            new_df.to_csv(file_path, index=False)
            msg = f"Created new {file_name} with {len(new_df)} rows."
            
        # If new inventory dataset is uploaded, consider all previous actions COMPLETED
        if target_dataset == "inventory":
            if db.is_configured():
                db.mark_all_completed()
            else:
                mark_history_completed()
            logger.info("New inventory snapshot uploaded. Existing pending transfers and POs marked as COMPLETED.")
            
        retrain_status = "Not triggered"
        if auto_trigger_retrain and not pipeline_state["is_running"]:
            os.makedirs(cfg.OUTPUT_DIR, exist_ok=True)
            with open(pipeline_state["log_file"], "w", encoding="utf-8") as f:
                f.write(f"--- Pipeline Execution Initialized via Data Ingestion API at {datetime.now(IST).isoformat()} ---\n")
            background_tasks.add_task(run_pipeline_worker)
            retrain_status = "Pipeline retrain worker triggered in background!"
            
        return {
            "success": True,
            "message": msg,
            "retrain_status": retrain_status,
            "target_dataset": target_dataset
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error ingesting CSV data: {e}")
        raise HTTPException(status_code=500, detail=f"Error processing CSV data: {str(e)}")


@app.post("/api/run-pipeline")
def trigger_pipeline(background_tasks: BackgroundTasks):
    """Triggers the background LightGBM forecasting & optimization pipeline."""
    global pipeline_state
    if pipeline_state["is_running"]:
        return {
            "status": "already_running",
            "message": "Pipeline is already executing.",
            "started_at": pipeline_state["started_at"]
        }
    
    os.makedirs(cfg.OUTPUT_DIR, exist_ok=True)
    with open(pipeline_state["log_file"], "w", encoding="utf-8") as f:
        f.write(f"--- Pipeline Execution Initialized via Web API at {datetime.now(IST).isoformat()} ---\n")
    
    background_tasks.add_task(run_pipeline_worker)
    return {
        "status": "started",
        "message": "Pipeline execution started in the background."
    }


@app.get("/api/pipeline-status")
def get_pipeline_status():
    """Returns real-time execution progress of the background worker."""
    global pipeline_state
    elapsed = 0.0
    if pipeline_state["is_running"] and pipeline_state["started_at"]:
        elapsed = time.time() - pipeline_state["started_at"]
    elif pipeline_state["completed_at"] and pipeline_state["started_at"]:
        elapsed = pipeline_state["completed_at"] - pipeline_state["started_at"]
        
    return {
        "is_running": pipeline_state["is_running"],
        "started_at": pipeline_state["started_at"],
        "completed_at": pipeline_state["completed_at"],
        "exit_code": pipeline_state["exit_code"],
        "elapsed_seconds": round(elapsed, 1)
    }


@app.get("/api/pipeline-logs", response_class=PlainTextResponse)
def get_pipeline_logs():
    """Returns real-time streaming tail of execution logs."""
    global pipeline_state
    if not os.path.exists(pipeline_state["log_file"]):
        return "No execution logs found. Click 'Run Pipeline' to initialize training."
    try:
        with open(pipeline_state["log_file"], "r", encoding="utf-8") as f:
            lines = f.readlines()
            return "".join(lines[-1000:])
    except Exception as e:
        return f"Error reading logs: {str(e)}"


# Serve the space-themed landing/intro experience on the root route
@app.get("/")
def get_landing():
    landing_path = os.path.join(cfg.BASE_DIR, "static", "landing", "index.html")
    if not os.path.exists(landing_path):
        return {"message": "RetailBrain AI Backend Active. Landing assets folder missing."}
    return FileResponse(landing_path)


# Serve the India store-network map (reached after clicking the globe)
@app.get("/india-map")
def get_india_map():
    map_path = os.path.join(cfg.BASE_DIR, "static", "landing", "india-map.html")
    if not os.path.exists(map_path):
        return {"message": "RetailBrain AI Backend Active. India map assets missing."}
    return FileResponse(map_path)


# Serve the main dashboard SPA at /dashboard (reached via the landing page)
@app.get("/dashboard")
def get_dashboard():
    index_path = os.path.join(cfg.BASE_DIR, "static", "index.html")
    if not os.path.exists(index_path):
        return {"message": "RetailBrain AI Backend Active. Static assets folder missing."}
    return FileResponse(index_path)


# Mount static assets directory
static_dir = os.path.join(cfg.BASE_DIR, "static")
os.makedirs(static_dir, exist_ok=True)
os.makedirs(os.path.join(static_dir, "css"), exist_ok=True)
os.makedirs(os.path.join(static_dir, "js"), exist_ok=True)

app.mount("/static", StaticFiles(directory=static_dir), name="static")

if __name__ == "__main__":
    import uvicorn
    print("\n" + "="*70)
    print(" >>> RetailBrain AI - Central Command Tower API Starting...")
    print(" >>> Control Center Interface: http://127.0.0.1:3500")
    print("="*70 + "\n")
    uvicorn.run("main:app", host="127.0.0.1", port=3500, reload=True)
