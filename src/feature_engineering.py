"""
RetailBrain AI - Feature Engineering
Builds a dense Date x Store x Product panel (filling non-sale days with 0 demand),
then engineers calendar, lag, and rolling-window features for the demand model.
"""
import numpy as np
import pandas as pd
from . import config as cfg


def build_dense_panel(sales: pd.DataFrame, stores: pd.DataFrame, products: pd.DataFrame) -> pd.DataFrame:
    """
    The cleaned sales file only contains rows where Quantity_Sold > 0.
    For time-series forecasting we need explicit zero-demand days too,
    otherwise the model can't learn "this product doesn't sell here on
    a normal Tuesday". We reconstruct the full calendar x store x product
    grid and left-join actual sales onto it, filling missing days as 0 demand.
    """
    all_dates = pd.date_range(sales["Date"].min(), sales["Date"].max(), freq="D")
    store_ids = stores["Store_ID"].unique()
    product_ids = products["Product_ID"].unique()

    # Build the full grid via a cross join (dates x stores x products).
    # Done in chunks by store to keep memory reasonable.
    frames = []
    for store_id in store_ids:
        grid = pd.MultiIndex.from_product(
            [all_dates, [store_id], product_ids],
            names=["Date", "Store_ID", "Product_ID"],
        ).to_frame(index=False)
        frames.append(grid)
    full_grid = pd.concat(frames, ignore_index=True)

    sales_slim = sales[["Date", "Store_ID", "Product_ID", "Quantity_Sold",
                         "Revenue", "Profit", "Festival", "Season"]]

    panel = full_grid.merge(sales_slim, on=["Date", "Store_ID", "Product_ID"], how="left")
    panel["Quantity_Sold"] = panel["Quantity_Sold"].fillna(0).astype(int)
    panel["Revenue"] = panel["Revenue"].fillna(0.0)
    panel["Profit"] = panel["Profit"].fillna(0.0)

    # Festival/Season are date-level attributes, not store/product-level, so
    # forward/back-fill them within each date using the sales-derived values
    # where present; days with zero sales for a store/product still fall on
    # a real calendar date, so recover Festival/Season from any row sharing that date.
    date_attrs = sales.dropna(subset=["Season"])[["Date", "Season"]].drop_duplicates("Date")
    date_festival = sales.dropna(subset=["Festival"])[["Date", "Festival"]].drop_duplicates("Date")
    panel = panel.drop(columns=["Season"]).merge(date_attrs, on="Date", how="left")
    panel = panel.drop(columns=["Festival"]).merge(date_festival, on="Date", how="left")

    return panel


def add_calendar_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["DayOfWeek"] = df["Date"].dt.dayofweek
    df["Month"] = df["Date"].dt.month
    df["Day"] = df["Date"].dt.day
    df["WeekOfYear"] = df["Date"].dt.isocalendar().week.astype(int)
    df["IsWeekend"] = (df["DayOfWeek"] >= 5).astype(int)
    df["IsFestival"] = df["Festival"].notna().astype(int)
    return df


def add_lag_and_rolling_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Per Store x Product time series: lag features + rolling mean/std.
    Assumes df is already sorted is NOT required here; we sort explicitly.
    """
    df = df.sort_values(["Store_ID", "Product_ID", "Date"]).reset_index(drop=True)
    grp = df.groupby(["Store_ID", "Product_ID"], sort=False)["Quantity_Sold"]

    for lag in cfg.LAG_DAYS:
        df[f"lag_{lag}"] = grp.shift(lag)

    for window in cfg.ROLLING_WINDOWS:
        # shift(1) first so the rolling window never sees the current day (no leakage)
        shifted = grp.shift(1)
        df[f"roll_mean_{window}"] = (
            shifted.groupby([df["Store_ID"], df["Product_ID"]])
            .rolling(window, min_periods=1).mean()
            .reset_index(level=[0, 1], drop=True)
        )
        df[f"roll_std_{window}"] = (
            shifted.groupby([df["Store_ID"], df["Product_ID"]])
            .rolling(window, min_periods=1).std()
            .reset_index(level=[0, 1], drop=True)
        )

    return df


def add_categorical_encodings(df: pd.DataFrame, products: pd.DataFrame, stores: pd.DataFrame) -> pd.DataFrame:
    df = df.merge(products[["Product_ID", "Category"]], on="Product_ID", how="left")
    df = df.merge(stores[["Store_ID", "City", "Store_Type"]], on="Store_ID", how="left")

    for col in ["Store_ID", "Product_ID", "Category", "City", "Store_Type", "Festival", "Season"]:
        df[col] = df[col].astype("category")

    return df


def build_feature_table(sales, stores, products) -> pd.DataFrame:
    panel = build_dense_panel(sales, stores, products)
    panel = add_calendar_features(panel)
    panel = add_lag_and_rolling_features(panel)
    panel = add_categorical_encodings(panel, products, stores)
    return panel
