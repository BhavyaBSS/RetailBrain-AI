# RetailBrain AI — AI-Powered Retail Profit Optimization & Decision Support System

This package is a complete, working implementation of the core intelligence
layer described in the project summary: demand forecasting, inventory
optimization, supplier ranking, and profit-ranked procurement recommendations
— trained and validated on real retail data.

## Folder structure

```
retailbrain_ai/
├── RetailBrain_AI_Project_Report.docx   <- Full project write-up (read this first)
├── run_pipeline.py                      <- Entry point: runs the whole pipeline end to end
├── src/                                 <- Source code (modular, importable)
│   ├── config.py                        <- Paths and tunable parameters
│   ├── data_loader.py                   <- Loads the 6 source tables
│   ├── feature_engineering.py           <- Builds the dense Date x Store x Product panel + features
│   ├── demand_forecast.py               <- LightGBM demand forecasting model
│   ├── inventory_optimizer.py           <- Reorder points, safety stock, stock transfers
│   ├── supplier_optimizer.py            <- Supplier ranking + price trend detection
│   └── profit_optimizer.py              <- Combines everything into profit-ranked recommendations
├── data/                                <- The six source datasets used to build and validate the model
│   ├── corrected_sales_dataset.csv      <- 2.48M cleaned transaction rows (Jan 2024 - Dec 2025)
│   ├── products.csv                     <- 35 SKUs: category, cost price, selling price, MRP
│   ├── stores.csv                       <- 100 stores: city, locality, type, capacity
│   ├── inventory.csv                    <- Current/reserved/safety stock per store x product (100 stores; 10 of them
│   │                                        updated with professionally corrected figures, see below)
│   ├── professional_inventory_dataset_source.csv  <- The corrected 10-store inventory extract as delivered
│   │                                        (Store/Product IDs standardized to BST-XXX/PROD-XXX, incoming-stock
│   │                                        capacity overflow fixed) — merged into inventory.csv above
│   ├── suppliers.csv                    <- 105 supplier offers: price, lead time, rating
│   └── procurement.csv                  <- 609,756 historical purchase order records
└── outputs/                             <- Results from the last pipeline run (already generated for you)
    ├── model_metrics.json               <- Backtest accuracy (WAPE, MAE)
    ├── dashboard_summary.json           <- Headline KPIs for a dashboard
    ├── demand_forecast_next_14_days.csv <- Day-by-day forecast, every store x product
    ├── inventory_reorder_recommendations.csv
    ├── stock_transfer_recommendations.csv
    ├── supplier_rankings.csv
    ├── supplier_price_trends.csv
    └── profit_optimization_recommendations.csv   <- The final, profit-ranked action list
```

## How to run it yourself

Requirements: Python 3.10+, `pandas`, `numpy`, `lightgbm`, `scikit-learn`, `joblib`.

```bash
pip install pandas numpy lightgbm scikit-learn joblib
cd retailbrain_ai
python run_pipeline.py
```

This will:
1. Load all six datasets from `data/`
2. Rebuild the full Date x Store x Product feature panel
3. Train and backtest the demand forecasting model
4. Forecast 14 days ahead
5. Generate inventory, supplier, and profit recommendations
6. Overwrite everything in `outputs/` with fresh results

Runtime on the full dataset: ~2.5–3 minutes on a standard machine.

## Key results (from the included run)

- **Forecast accuracy**: 9.87% WAPE overall (~90% accuracy), backtested on a 60-day holdout
- **1,395** Store x Product combinations flagged for reorder in the next 14 days
- **228** Store x Product combinations flagged as overstocked
- **303** inter-store stock transfer opportunities identified (satisfy shortages from surplus stock before buying new)
- **₹25.7 lakh** in expected profit identified from the recommended procurement actions
- Full methodology, metrics, and sample outputs are in the accompanying `.docx` report

## Next steps (not yet built)

The report's Section 9 covers this in detail, but in short: wrap each module
as a FastAPI endpoint, persist outputs to PostgreSQL, and connect the React
dashboard described in the original project brief for live daily runs.
