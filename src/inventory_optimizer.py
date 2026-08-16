"""
RetailBrain AI - Inventory Optimization
Turns demand forecasts + current inventory into concrete, explainable actions:
reorder points, reorder quantities, overstock flags, and store-to-store
stock transfer suggestions (transfer before buying new stock).
"""
import logging
import numpy as np
import pandas as pd
from typing import Dict
from . import config as cfg

# Set up logger
logger = logging.getLogger("RetailBrain_AI.InventoryOptimizer")


def summarize_forecast_demand(forecast_df: pd.DataFrame) -> pd.DataFrame:
    """Aggregate the recursive daily forecast into per Store x Product stats
    needed for inventory decisions: avg daily demand, demand std, total horizon demand."""
    if forecast_df.empty:
        logger.warning("Empty forecast dataframe passed to summarize_forecast_demand")
        return pd.DataFrame(columns=["Store_ID", "Product_ID", "avg_daily_demand", "demand_std", "horizon_total_demand"])

    logger.info("Aggregating forecast demands per Store x Product...")
    agg = (
        forecast_df.groupby(["Store_ID", "Product_ID"])["Predicted_Quantity"]
        .agg(avg_daily_demand="mean", demand_std="std", horizon_total_demand="sum")
        .reset_index()
    )
    agg["demand_std"] = agg["demand_std"].fillna(0.0)
    logger.info(f"Aggregated demand stats for {len(agg)} Store x Product series.")
    return agg


def compute_reorder_recommendations(
    inventory: pd.DataFrame,
    demand_summary: pd.DataFrame,
    suppliers: pd.DataFrame,
) -> pd.DataFrame:
    """
    Reorder point = (avg daily demand x supplier lead time) + safety stock
    Safety stock   = Z * demand_std * sqrt(lead time)   [classic newsvendor-style formula]
    Reorder qty    = enough to cover horizon demand + safety stock, minus what's on hand
    """
    if inventory.empty or demand_summary.empty or suppliers.empty:
        logger.error("One or more inputs to compute_reorder_recommendations are empty")
        raise ValueError("Inputs to compute_reorder_recommendations cannot be empty.")

    logger.info("Computing safety stock, reorder points, and order quantities...")

    # Use the fastest (lowest lead time) supplier per product as the planning lead time
    best_lead_time = (
        suppliers.groupby("Product_ID")["Lead_Time"].min().reset_index()
        .rename(columns={"Lead_Time": "Min_Lead_Time_Days"})
    )

    df = inventory.merge(demand_summary, on=["Store_ID", "Product_ID"], how="left")
    df = df.merge(best_lead_time, on="Product_ID", how="left")

    df["avg_daily_demand"] = df["avg_daily_demand"].fillna(0.0)
    df["demand_std"] = df["demand_std"].fillna(0.0)
    df["Min_Lead_Time_Days"] = df["Min_Lead_Time_Days"].fillna(3)

    df["safety_stock_calc"] = (
        cfg.SERVICE_LEVEL_Z * df["demand_std"] * np.sqrt(df["Min_Lead_Time_Days"])
    ).round(1)
    
    # Respect whichever is higher: dataset's stated safety stock or our computed one
    df["safety_stock_used"] = df[["Safety_Stock", "safety_stock_calc"]].max(axis=1)

    df["reorder_point"] = (
        df["avg_daily_demand"] * df["Min_Lead_Time_Days"] + df["safety_stock_used"]
    ).round(1)

    df["available_stock"] = df["Current_Stock"] - df["Reserved_Stock"]
    
    # Load active POs and transfers from history CSV logs to account for in-transit stock
    import os
    in_transit = {}
    
    # 1. Active Purchase Orders
    if os.path.exists(cfg.PURCHASE_ORDERS_FILE) and os.path.getsize(cfg.PURCHASE_ORDERS_FILE) > 0:
        try:
            po_df = pd.read_csv(cfg.PURCHASE_ORDERS_FILE)
            if not po_df.empty and "status" in po_df.columns:
                active_pos = po_df[po_df["status"] == "DISPATCHED_TO_SUPPLIER"]
                for _, row in active_pos.iterrows():
                    key = (str(row["store_id"]), str(row["product_id"]))
                    in_transit[key] = in_transit.get(key, 0) + int(row["order_qty"])
        except Exception as e:
            logger.warning(f"Could not parse purchase orders for in-transit calculation: {e}")
            
    # 2. Active Stock Transfers
    if os.path.exists(cfg.STOCK_TRANSFERS_FILE) and os.path.getsize(cfg.STOCK_TRANSFERS_FILE) > 0:
        try:
            st_df = pd.read_csv(cfg.STOCK_TRANSFERS_FILE)
            if not st_df.empty and "status" in st_df.columns:
                active_sts = st_df[st_df["status"] == "IN_TRANSIT"]
                for _, row in active_sts.iterrows():
                    key = (str(row["to_store"]), str(row["product_id"]))
                    in_transit[key] = in_transit.get(key, 0) + int(row["transfer_qty"])
        except Exception as e:
            logger.warning(f"Could not parse stock transfers for in-transit calculation: {e}")
            
    # Map in-transit stock to the DataFrame
    def get_in_transit_qty(row):
        return in_transit.get((str(row["Store_ID"]), str(row["Product_ID"])), 0)
        
    df["in_transit_qty"] = df.apply(get_in_transit_qty, axis=1)
    
    # Add in-transit stock to available stock to prevent double recommendation
    df["available_stock_effective"] = df["available_stock"] + df["in_transit_qty"]
    df["needs_reorder"] = df["available_stock_effective"] < df["reorder_point"]

    # Order enough to cover the forecast horizon + safety stock, net of what's available,
    # capped so we never plan above maximum warehouse capacity.
    target_stock = df["horizon_total_demand"].fillna(0.0) + df["safety_stock_used"]
    raw_order_qty = (target_stock - df["available_stock_effective"]).clip(lower=0)
    room_available = (df["Maximum_Capacity"] - df["Current_Stock"] - df["in_transit_qty"]).clip(lower=0)
    df["recommended_order_qty"] = np.minimum(raw_order_qty, room_available).round().astype(int)

    df["is_overstocked"] = df["Current_Stock"] > (
        df["avg_daily_demand"] * 30 * cfg.OVERSTOCK_MULTIPLIER
    ).clip(lower=1)

    cols = [
        "Store_ID", "Product_ID", "Current_Stock", "Reserved_Stock", "available_stock",
        "avg_daily_demand", "demand_std", "Min_Lead_Time_Days",
        "safety_stock_used", "reorder_point", "needs_reorder",
        "recommended_order_qty", "is_overstocked", "Maximum_Capacity",
    ]
    
    result_df = df[cols]
    logger.info(f"Reorder recommendations complete. {result_df['needs_reorder'].sum()} needs reorder, {result_df['is_overstocked'].sum()} overstocked.")
    return result_df


def recommend_stock_transfers(reorder_df: pd.DataFrame, stores: pd.DataFrame) -> pd.DataFrame:
    """
    For each product, match overstocked stores (surplus) with understocked
    stores (needs_reorder) in the same city, before recommending fresh procurement.
    Transfer qty = min(surplus available, shortage needed), capped at receiving
    store's remaining capacity.
    """
    if reorder_df.empty or stores.empty:
        logger.warning("Empty reorder or stores dataframe passed. No transfers generated.")
        return pd.DataFrame(columns=["Product_ID", "City", "From_Store", "To_Store", "Transfer_Qty"])

    logger.info("Computing inter-store stock transfer recommendations...")
    df = reorder_df.merge(stores[["Store_ID", "City"]], on="Store_ID", how="left")

    transfers = []
    for (product_id, city), grp in df.groupby(["Product_ID", "City"]):
        surplus_stores = grp[grp["is_overstocked"]].copy()
        shortage_stores = grp[grp["needs_reorder"]].copy()
        if surplus_stores.empty or shortage_stores.empty:
            continue

        # Rough greedy matching: largest surplus feeds largest shortage first
        surplus_stores["surplus_qty"] = (
            surplus_stores["Current_Stock"] - surplus_stores["reorder_point"]
        ).clip(lower=0)
        shortage_stores["shortage_qty"] = (
            shortage_stores["reorder_point"] - shortage_stores["available_stock"]
        ).clip(lower=0)

        surplus_stores = surplus_stores.sort_values("surplus_qty", ascending=False).reset_index(drop=True)
        shortage_stores = shortage_stores.sort_values("shortage_qty", ascending=False).reset_index(drop=True)

        s_idx, d_idx = 0, 0
        surplus_pool = surplus_stores["surplus_qty"].tolist()
        shortage_pool = shortage_stores["shortage_qty"].tolist()

        while s_idx < len(surplus_pool) and d_idx < len(shortage_pool):
            transfer_qty = min(surplus_pool[s_idx], shortage_pool[d_idx])
            if transfer_qty >= 1:
                transfers.append({
                    "Product_ID": product_id,
                    "City": city,
                    "From_Store": surplus_stores.loc[s_idx, "Store_ID"],
                    "To_Store": shortage_stores.loc[d_idx, "Store_ID"],
                    "Transfer_Qty": int(round(transfer_qty)),
                })
            surplus_pool[s_idx] -= transfer_qty
            shortage_pool[d_idx] -= transfer_qty
            if surplus_pool[s_idx] <= 0:
                s_idx += 1
            if shortage_pool[d_idx] <= 0:
                d_idx += 1

    transfers_df = pd.DataFrame(transfers)
    logger.info(f"Generated {len(transfers_df)} inter-store stock transfer recommendations.")
    return transfers_df
