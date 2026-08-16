# RetailBrain AI — Model Performance & Validation Report

This report documents the validation results, feature importances, and optimization metrics of the LightGBM predictive forecasting pipeline.

---

## 📈 1. Demand Forecasting Model Metrics
Evaluated on out-of-sample holdout data representing the final 60 days of the dataset (Nov 1 - Dec 31, 2025):

| Metric | Value | Interpretation |
| :--- | :---: | :--- |
| **Mean Absolute Error (MAE)** | **1.057 units** | On average, predictions deviate by just 1 unit from actual daily demand. |
| **Overall WAPE (Weighted Error)** | **9.86%** | The global model achieves **90.14% overall forecasting accuracy**. |
| **Normal Days WAPE** | **9.76%** | Forecasting error during baseline non-holiday periods. |
| **Festival Days WAPE** | **11.35%** | Forecasting error during high-stakes holiday surges (Diwali, Holi, Rakhi). |
| **Total Test Data Inspected** | **210,000 rows** | Standard time-series backtest holdout grid. |

*Note: In retail analytics, a WAPE below 10% is considered world-class and matches production-grade supply chain models.*

---

## 🏆 2. Feature Importance Rankings (Tree Splits)
The LightGBM booster model ranks variables by their frequency of selection in leaf splits:

1.  `sales_lag_7` (Highest frequency) — Captures weekly consumer behavior.
2.  `sales_lag_1` — Captures short-term daily momentum.
3.  `rolling_mean_30` — Establishes long-term baseline volume per dark store.
4.  `day_of_week` — Captures weekend spikes.
5.  `IsFestival` — Adjusts weights during holiday calendars.

---

## 🚀 3. Prescriptive Operations & Financial Gains
By implementing the optimization recommendations on top of the forecasts, the system projects the following efficiency gains:

*   **Total Expected Sourcing Profit Uplift**: **₹25,64,166.00 (₹25.6 Lakhs)**
    *(Price savings achieved by routing POs to optimal suppliers and utilizing buy-ahead trends before price spikes).*
*   **Active Stock Transfers Recommended**: **303 balanced transfers**
    *(Rebalancing overstocked items to stockout-threatened dark stores in the same city, minimizing waste and logistics costs).*
*   **Active Reorder Alerts**: **1,394 store-product lines**
    *(Replenishments triggered using safety stock boundaries and Economic Order Quantity).*

---

## ⚙️ 4. Model Hyperparameters (LightGBM)
*   `objective`: **poisson** (best for non-negative count data)
*   `metric`: **mae**
*   `learning_rate`: **0.05**
*   `num_leaves`: **63**
*   `min_data_in_leaf`: **50**
*   `feature_fraction`: **0.8**
