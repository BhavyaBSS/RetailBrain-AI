"""
RetailBrain AI - Full Pipeline Runner
Loads data -> builds features -> trains demand model -> backtests it ->
forecasts ahead -> generates inventory, supplier, and profit recommendations
-> writes dashboard-ready CSVs to outputs/.
"""
import json
import time
import pandas as pd

from src import config as cfg
from src import data_loader as dl
from src import feature_engineering as fe
from src import demand_forecast as df_model
from src import inventory_optimizer as inv_opt
from src import supplier_optimizer as sup_opt
from src import profit_optimizer as profit_opt


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def main():
    t0 = time.time()

    log("Loading source tables...")
    data = dl.load_all()
    sales, products, stores = data["sales"], data["products"], data["stores"]
    inventory, suppliers, procurement = data["inventory"], data["suppliers"], data["procurement"]
    log(f"  sales={len(sales):,} rows | products={len(products)} | stores={len(stores)} "
        f"| inventory={len(inventory):,} | suppliers={len(suppliers)} | procurement={len(procurement):,}")

    log("Building dense Date x Store x Product feature panel (this reconstructs zero-demand days)...")
    feature_table = fe.build_feature_table(sales, stores, products)
    log(f"  feature table shape: {feature_table.shape}")

    log("Splitting train/test by time and training demand forecasting model...")
    train_df, test_df = df_model.time_split(feature_table)
    log(f"  train rows={len(train_df):,} | test rows={len(test_df):,} "
        f"(holdout = last {cfg.TEST_HOLDOUT_DAYS} days)")

    model = df_model.train_model(train_df, test_df)
    df_model.save_model(model, f"{cfg.MODEL_DIR}/demand_model.pkl")
    log("  model trained and saved.")

    log("Backtesting on holdout period...")
    metrics = df_model.evaluate(model, test_df)
    log(f"  metrics: {metrics}")
    with open(f"{cfg.OUTPUT_DIR}/model_metrics.json", "w") as f:
        json.dump(metrics, f, indent=2, default=float)

    log(f"Forecasting {cfg.FORECAST_HORIZON_DAYS} days ahead (recursive)...")
    forecast_df = df_model.forecast_future(model, feature_table, cfg.FORECAST_HORIZON_DAYS)
    forecast_df.to_csv(f"{cfg.OUTPUT_DIR}/demand_forecast_next_{cfg.FORECAST_HORIZON_DAYS}_days.csv", index=False)
    log(f"  forecast rows: {len(forecast_df):,}")

    log("Summarizing forecast into per Store x Product demand stats...")
    demand_summary = inv_opt.summarize_forecast_demand(forecast_df)

    log("Computing inventory reorder recommendations...")
    reorder_df = inv_opt.compute_reorder_recommendations(inventory, demand_summary, suppliers)
    reorder_df.to_csv(f"{cfg.OUTPUT_DIR}/inventory_reorder_recommendations.csv", index=False)
    log(f"  {reorder_df['needs_reorder'].sum():,} Store x Product combos need reorder; "
        f"{reorder_df['is_overstocked'].sum():,} are overstocked")

    log("Computing stock transfer recommendations (transfer before buying new stock)...")
    transfers_df = inv_opt.recommend_stock_transfers(reorder_df, stores)
    transfers_df.to_csv(f"{cfg.OUTPUT_DIR}/stock_transfer_recommendations.csv", index=False)
    log(f"  {len(transfers_df):,} transfer recommendations generated")

    log("Ranking suppliers per product...")
    supplier_ranks = sup_opt.rank_suppliers(suppliers)
    supplier_ranks.to_csv(f"{cfg.OUTPUT_DIR}/supplier_rankings.csv", index=False)

    log("Detecting procurement price trends (buy-ahead signals)...")
    price_trends = sup_opt.detect_price_trend(procurement)
    price_trends.to_csv(f"{cfg.OUTPUT_DIR}/supplier_price_trends.csv", index=False)
    log(f"  {int(price_trends['buy_ahead_flag'].sum())} products show a rising price trend")

    log("Building profit-ranked procurement recommendations...")
    profit_recs = profit_opt.build_profit_recommendations(reorder_df, supplier_ranks, products)
    profit_recs.to_csv(f"{cfg.OUTPUT_DIR}/profit_optimization_recommendations.csv", index=False)
    log(f"  {len(profit_recs):,} procurement recommendations, "
        f"total expected profit uplift = Rs {profit_recs['expected_profit'].sum():,.0f}")

    log("Building dashboard summary...")
    dashboard_summary = {
        "total_stores": int(stores.shape[0]),
        "total_products": int(products.shape[0]),
        "total_historical_revenue": float(sales["Revenue"].sum()),
        "total_historical_profit": float(sales["Profit"].sum()),
        "combos_needing_reorder": int(reorder_df["needs_reorder"].sum()),
        "combos_overstocked": int(reorder_df["is_overstocked"].sum()),
        "stock_transfer_recommendations": int(len(transfers_df)),
        "products_with_rising_prices": int(price_trends["buy_ahead_flag"].sum()),
        "total_expected_profit_uplift_next_horizon": float(profit_recs["expected_profit"].sum()),
        "forecast_model_wape_overall": metrics["wape_overall"],
        "forecast_model_wape_festival_days": metrics["wape_festival_days"],
        "forecast_model_wape_normal_days": metrics["wape_normal_days"],
    }
    with open(f"{cfg.OUTPUT_DIR}/dashboard_summary.json", "w") as f:
        json.dump(dashboard_summary, f, indent=2, default=float)

    log(f"Pipeline complete in {time.time()-t0:.1f}s. Outputs written to {cfg.OUTPUT_DIR}")


if __name__ == "__main__":
    main()
