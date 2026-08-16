"""
RetailBrain AI - Supplier Optimization
Ranks suppliers per product on a weighted score of price, lead time, and
rating, and flags products where recent procurement price is trending up
(a signal to buy ahead of a further increase, e.g. before a festival).
"""
import logging
import numpy as np
import pandas as pd
from typing import Dict, Any, Optional

# Set up logger
logger = logging.getLogger("RetailBrain_AI.SupplierOptimizer")


def rank_suppliers(suppliers: pd.DataFrame, weights: Optional[Dict[str, float]] = None) -> pd.DataFrame:
    """
    Score = w_price * (1 / normalized price) + w_lead * (1 / normalized lead time) + w_rating * normalized rating
    All components min-max normalized within each product so suppliers are compared fairly per-SKU.
    """
    if suppliers.empty:
        logger.warning("Empty suppliers dataframe passed to rank_suppliers")
        return pd.DataFrame(columns=["Product_ID", "Supplier_ID", "Supplier_Name", "Supplier_Price",
                                     "Lead_Time", "Supplier_Rating", "supplier_score", "rank_in_product"])

    if weights is None:
        weights = {"price": 0.5, "lead_time": 0.2, "rating": 0.3}

    logger.info(f"Ranking suppliers with weights: {weights}")
    df = suppliers.copy()

    def normalize(s: pd.Series) -> pd.Series:
        rng = s.max() - s.min()
        if rng == 0:
            return pd.Series(1.0, index=s.index)
        return (s - s.min()) / rng

    df["price_norm_inv"] = df.groupby("Product_ID")["Supplier_Price"].transform(
        lambda s: 1 - normalize(s)
    )
    df["lead_norm_inv"] = df.groupby("Product_ID")["Lead_Time"].transform(
        lambda s: 1 - normalize(s)
    )
    df["rating_norm"] = df.groupby("Product_ID")["Supplier_Rating"].transform(normalize)

    df["supplier_score"] = (
        weights["price"] * df["price_norm_inv"]
        + weights["lead_time"] * df["lead_norm_inv"]
        + weights["rating"] * df["rating_norm"]
    ).round(4)

    df["rank_in_product"] = df.groupby("Product_ID")["supplier_score"].rank(
        ascending=False, method="first"
    ).astype(int)

    result_df = df.sort_values(["Product_ID", "rank_in_product"])[
        ["Product_ID", "Supplier_ID", "Supplier_Name", "Supplier_Price",
         "Lead_Time", "Supplier_Rating", "supplier_score", "rank_in_product"]
    ]
    logger.info(f"Ranks assigned successfully for {len(result_df)} supplier offers.")
    return result_df


def detect_price_trend(procurement: pd.DataFrame, lookback_days: int = 60) -> pd.DataFrame:
    """
    For each product, compare average Purchase_Price in the most recent
    `lookback_days` window vs the prior window of the same length.
    A rising trend suggests buying now before prices climb further.
    """
    if procurement.empty:
        logger.warning("Empty procurement dataframe passed to detect_price_trend")
        return pd.DataFrame(columns=["Product_ID", "recent_avg_price", "prior_avg_price", "pct_change", "buy_ahead_flag"])

    logger.info(f"Detecting procurement price trends (lookback={lookback_days} days)...")
    df = procurement.copy()
    max_date = df["Purchase_Date"].max()
    recent_start = max_date - pd.Timedelta(days=lookback_days)
    prior_start = recent_start - pd.Timedelta(days=lookback_days)

    recent = df[df["Purchase_Date"] > recent_start]
    prior = df[(df["Purchase_Date"] > prior_start) & (df["Purchase_Date"] <= recent_start)]

    recent_avg = recent.groupby("Product_ID")["Purchase_Price"].mean().rename("recent_avg_price")
    prior_avg = prior.groupby("Product_ID")["Purchase_Price"].mean().rename("prior_avg_price")

    trend = pd.concat([recent_avg, prior_avg], axis=1).reset_index()
    
    # Fill NAs
    trend["recent_avg_price"] = trend["recent_avg_price"].fillna(0.0)
    trend["prior_avg_price"] = trend["prior_avg_price"].fillna(0.0)

    # Compute percentage changes avoiding divide-by-zero
    trend["pct_change"] = np.where(
        trend["prior_avg_price"] > 0,
        ((trend["recent_avg_price"] - trend["prior_avg_price"]) / trend["prior_avg_price"] * 100).round(2),
        0.0
    )
    trend["buy_ahead_flag"] = trend["pct_change"] > 3.0  # >3% rise => recommend buying ahead
    
    logger.info(f"Price trend detection complete. {int(trend['buy_ahead_flag'].sum())} products show rising price trends.")
    return trend
