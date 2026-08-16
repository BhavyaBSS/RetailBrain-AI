"""
RetailBrain AI - Profit Optimization Engine
Combines forecasted demand, best available supplier price, and current
selling price into an expected-profit-ranked procurement recommendation list.
This is the final layer that turns forecasts + supplier rankings into the
"Purchase X units now, expected profit increase ₹Y" style recommendation.
"""
import logging
import numpy as np
import pandas as pd

# Set up logger
logger = logging.getLogger("RetailBrain_AI.ProfitOptimizer")

HOLDING_COST_RATE = 0.02  # assumed 2% of cost price per holding period, as a simple estimate


def build_profit_recommendations(
    reorder_df: pd.DataFrame,
    supplier_ranks: pd.DataFrame,
    products: pd.DataFrame,
) -> pd.DataFrame:
    """
    Combines forecasted shortages and supplier ranks to select the best supplier per product,
    estimates holding and procurement costs, and ranks final procurement proposals by expected profit.
    """
    if reorder_df.empty or supplier_ranks.empty or products.empty:
        logger.warning("One or more inputs to build_profit_recommendations are empty. Returning empty recommendations.")
        return pd.DataFrame(columns=[
            "Store_ID", "Product_ID", "Product_Name", "Category",
            "recommended_order_qty", "Best_Supplier_ID", "Best_Supplier_Name",
            "Best_Supplier_Price", "Selling_Price", "procurement_cost",
            "expected_revenue", "holding_cost_est", "expected_profit"
        ])

    logger.info("Building profit-ranked procurement recommendations...")

    best_supplier = supplier_ranks[supplier_ranks["rank_in_product"] == 1][
        ["Product_ID", "Supplier_ID", "Supplier_Name", "Supplier_Price"]
    ].rename(columns={
        "Supplier_ID": "Best_Supplier_ID",
        "Supplier_Name": "Best_Supplier_Name",
        "Supplier_Price": "Best_Supplier_Price",
    })

    df = reorder_df.merge(best_supplier, on="Product_ID", how="left")
    df = df.merge(products[["Product_ID", "Product_Name", "Category", "Selling_Price", "Cost_Price"]],
                   on="Product_ID", how="left")

    # Filter only to combinations that require reordering and have quantity > 0
    df = df[df["needs_reorder"] & (df["recommended_order_qty"] > 0)].copy()

    if df.empty:
        logger.warning("No store-product combinations found that need reordering. Returning empty dataframe.")
        return pd.DataFrame(columns=[
            "Store_ID", "Product_ID", "Product_Name", "Category",
            "recommended_order_qty", "Best_Supplier_ID", "Best_Supplier_Name",
            "Best_Supplier_Price", "Selling_Price", "procurement_cost",
            "expected_revenue", "holding_cost_est", "expected_profit"
        ])

    df["procurement_cost"] = df["recommended_order_qty"] * df["Best_Supplier_Price"]
    df["expected_revenue"] = df["recommended_order_qty"] * df["Selling_Price"]
    df["holding_cost_est"] = df["procurement_cost"] * HOLDING_COST_RATE
    df["expected_profit"] = df["expected_revenue"] - df["procurement_cost"] - df["holding_cost_est"]

    df = df.sort_values("expected_profit", ascending=False)

    cols = [
        "Store_ID", "Product_ID", "Product_Name", "Category",
        "recommended_order_qty", "Best_Supplier_ID", "Best_Supplier_Name",
        "Best_Supplier_Price", "Selling_Price", "procurement_cost",
        "expected_revenue", "holding_cost_est", "expected_profit",
    ]
    
    result_df = df[cols].reset_index(drop=True)
    logger.info(f"Profit recommendations generated successfully with {len(result_df)} records.")
    return result_df
