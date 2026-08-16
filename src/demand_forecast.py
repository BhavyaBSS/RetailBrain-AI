"""
RetailBrain AI - Demand Forecasting Model
A single global LightGBM regressor trained across all Store x Product series,
using lag/rolling/calendar/categorical features. Global models generalize far
better than 3,500 independent per-series models when many series are short
or intermittent (typical for retail SKUs).
"""
import logging
import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.metrics import mean_absolute_error
import joblib
from typing import Tuple, Dict, Any

from . import config as cfg

# Set up logger
logger = logging.getLogger("RetailBrain_AI.DemandForecast")

FEATURE_COLS = (
    ["DayOfWeek", "Month", "Day", "WeekOfYear", "IsWeekend", "IsFestival"]
    + [f"lag_{l}" for l in cfg.LAG_DAYS]
    + [f"roll_mean_{w}" for w in cfg.ROLLING_WINDOWS]
    + [f"roll_std_{w}" for w in cfg.ROLLING_WINDOWS]
    + ["Store_ID", "Product_ID", "Category", "City", "Store_Type", "Festival", "Season"]
)
TARGET_COL = "Quantity_Sold"
CATEGORICAL_COLS = ["Store_ID", "Product_ID", "Category", "City", "Store_Type", "Festival", "Season"]


def time_split(df: pd.DataFrame, holdout_days: int = cfg.TEST_HOLDOUT_DAYS) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """Splits the feature table into train and holdout datasets based on time."""
    if df.empty:
        logger.error("Empty dataframe passed to time_split")
        raise ValueError("Cannot perform time split on an empty DataFrame.")
    
    if "Date" not in df.columns:
        logger.error("Missing 'Date' column in time_split input")
        raise KeyError("Date column is required to perform time split.")

    cutoff = df["Date"].max() - pd.Timedelta(days=holdout_days)
    train = df[df["Date"] <= cutoff]
    test = df[df["Date"] > cutoff]
    
    logger.info(f"Split completed: train_rows={len(train):,}, test_rows={len(test):,} (cutoff date: {cutoff.strftime('%Y-%m-%d')})")
    return train, test


def train_model(train_df: pd.DataFrame, valid_df: pd.DataFrame) -> lgb.Booster:
    """Trains a LightGBM regressor using Poisson objective and early stopping."""
    # Ensure there is training data
    train_clean = train_df.dropna(subset=[f"lag_{cfg.LAG_DAYS[-1]}"])  # need full lag history
    if train_clean.empty:
        logger.error("Training dataset is empty after dropping missing lag values")
        raise ValueError("Insufficient data to train the model. Ensure lag history is built correctly.")
    
    if valid_df.empty:
        logger.error("Validation dataset is empty")
        raise ValueError("Validation dataset cannot be empty for early stopping.")

    logger.info(f"Preparing datasets for LightGBM. Train shape: {train_clean.shape}, Validation shape: {valid_df.shape}")

    X_train, y_train = train_clean[FEATURE_COLS], train_clean[TARGET_COL]
    X_valid, y_valid = valid_df[FEATURE_COLS], valid_df[TARGET_COL]

    train_set = lgb.Dataset(X_train, label=y_train, categorical_feature=CATEGORICAL_COLS)
    valid_set = lgb.Dataset(X_valid, label=y_valid, categorical_feature=CATEGORICAL_COLS, reference=train_set)

    params = {
        "objective": "poisson",       # demand counts are non-negative, right-skewed
        "metric": "mae",
        "learning_rate": 0.05,
        "num_leaves": 63,
        "min_data_in_leaf": 50,
        "feature_fraction": 0.8,
        "bagging_fraction": 0.8,
        "bagging_freq": 1,
        "verbose": -1,
        "seed": cfg.RANDOM_STATE,
    }

    logger.info("Starting LightGBM model training...")
    model = lgb.train(
        params,
        train_set,
        num_boost_round=500,
        valid_sets=[valid_set],
        callbacks=[lgb.early_stopping(30, verbose=False), lgb.log_evaluation(0)],
    )
    logger.info(f"Model training complete. Best iteration: {model.best_iteration}")
    return model


def evaluate(model: lgb.Booster, test_df: pd.DataFrame) -> Dict[str, Any]:
    """Evaluates model performance using MAE and WAPE (overall and by day type)."""
    test_clean = test_df.dropna(subset=[f"lag_{cfg.LAG_DAYS[-1]}"])
    if test_clean.empty:
        logger.warning("Empty test set after removing missing lag rows. Evaluation metrics may not be accurate.")
        return {"mae": 0.0, "wape_overall": 0.0, "wape_festival_days": 0.0, "wape_normal_days": 0.0, "n_test_rows": 0}

    X_test, y_test = test_clean[FEATURE_COLS], test_clean[TARGET_COL]
    preds = np.clip(model.predict(X_test), 0, None)

    mae = mean_absolute_error(y_test, preds)
    wape = np.sum(np.abs(y_test - preds)) / max(np.sum(y_test), 1e-9)

    festival_mask = test_clean["IsFestival"] == 1
    if festival_mask.sum() > 0:
        fest_wape = (
            np.sum(np.abs(y_test[festival_mask] - preds[festival_mask]))
            / max(np.sum(y_test[festival_mask]), 1e-9)
        )
    else:
        fest_wape = 0.0

    normal_mask = ~festival_mask
    if normal_mask.sum() > 0:
        normal_wape = (
            np.sum(np.abs(y_test[normal_mask] - preds[normal_mask]))
            / max(np.sum(y_test[normal_mask]), 1e-9)
        )
    else:
        normal_wape = 0.0

    metrics = {
        "mae": float(mae),
        "wape_overall": float(wape),
        "wape_festival_days": float(fest_wape),
        "wape_normal_days": float(normal_wape),
        "n_test_rows": int(len(test_clean)),
    }
    logger.info(f"Evaluation complete: MAE={mae:.4f}, WAPE={wape:.4%}")
    return metrics


def forecast_future(model: lgb.Booster, feature_table: pd.DataFrame, horizon_days: int = cfg.FORECAST_HORIZON_DAYS) -> pd.DataFrame:
    """
    Recursive multi-step forecast: predict day t+1, append it to history,
    recompute lag/rolling features, predict t+2, and so on, for `horizon_days`.
    """
    from . import feature_engineering as fe

    logger.info(f"Starting recursive multi-step forecast for a {horizon_days}-day horizon...")
    
    # Only need enough trailing history to compute the longest lag/rolling
    # window; keeping the full 2-year panel in memory for every recursive
    # step is unnecessary and slow.
    max_window = max(max(cfg.LAG_DAYS), max(cfg.ROLLING_WINDOWS)) + 5
    last_date = feature_table["Date"].max()
    cutoff = last_date - pd.Timedelta(days=max_window)

    history = feature_table[feature_table["Date"] > cutoff][
        ["Date", "Store_ID", "Product_ID", "Quantity_Sold",
         "Revenue", "Profit", "Festival", "Season",
         "Category", "City", "Store_Type"]
    ].copy()
    future_frames = []

    for step in range(1, horizon_days + 1):
        target_date = last_date + pd.Timedelta(days=step)
        logger.info(f"Forecasting step {step}/{horizon_days} (Date: {target_date.strftime('%Y-%m-%d')})...")

        # Build the feature row for this future date from current history
        base = history[["Store_ID", "Product_ID", "Category", "City", "Store_Type"]].drop_duplicates()
        base["Date"] = target_date
        base["Quantity_Sold"] = np.nan
        base["Revenue"] = np.nan
        base["Profit"] = np.nan
        base["Festival"] = np.nan  # future festival calendar not modeled here; extend via config map if known
        base["Season"] = history.sort_values("Date")["Season"].iloc[-1]

        combined = pd.concat([history, base], ignore_index=True)
        combined = fe.add_calendar_features(combined)
        combined = fe.add_lag_and_rolling_features(combined)
        for col in CATEGORICAL_COLS:
            combined[col] = combined[col].astype("category")

        step_rows = combined[combined["Date"] == target_date].copy()
        X_step = step_rows[FEATURE_COLS]
        step_rows["Predicted_Quantity"] = np.clip(model.predict(X_step), 0, None)

        future_frames.append(step_rows[["Date", "Store_ID", "Product_ID", "Predicted_Quantity"]])

        # Feed the prediction back into history so next step's lags see it
        step_rows["Quantity_Sold"] = step_rows["Predicted_Quantity"].round().astype(int)
        history = pd.concat(
            [history, step_rows[["Date", "Store_ID", "Product_ID", "Quantity_Sold",
                                  "Revenue", "Profit", "Festival", "Season",
                                  "Category", "City", "Store_Type"]]],
            ignore_index=True,
        )

    forecast_df = pd.concat(future_frames, ignore_index=True)
    logger.info("Recursive forecasting completed successfully.")
    return forecast_df


def save_model(model: lgb.Booster, path: str) -> None:
    """Saves the trained booster model using joblib."""
    logger.info(f"Saving model to {path}...")
    joblib.dump(model, path)
    logger.info("Model saved.")


def load_model(path: str) -> lgb.Booster:
    """Loads a booster model from disk."""
    logger.info(f"Loading model from {path}...")
    model = joblib.load(path)
    logger.info("Model loaded successfully.")
    return model
