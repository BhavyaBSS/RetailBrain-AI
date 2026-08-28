"""
RetailBrain AI - Traffic & Logistics Travel Time / ETA Calculator
Calculates Haversine distance and estimated transit times for store transfers & supplier dispatches.
"""
import math
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import pandas as pd

IST = ZoneInfo("Asia/Kolkata")

def calc_haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0 # Earth radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return round(R * c, 2)

def get_store_transfer_eta(from_store, to_store, stores_csv_path=None, fetch_live_traffic=False, **kwargs):
    # Default values
    dist_km = 4.5
    if isinstance(from_store, dict) and isinstance(to_store, dict):
        lat1, lon1 = float(from_store.get("Latitude", 28.61)), float(from_store.get("Longitude", 77.23))
        lat2, lon2 = float(to_store.get("Latitude", 28.61)), float(to_store.get("Longitude", 77.23))
        dist_km = calc_haversine_km(lat1, lon1, lat2, lon2)
    elif stores_csv_path:
        try:
            df = pd.read_csv(stores_csv_path)
            s1 = df[df["Store_ID"] == (from_store if isinstance(from_store, str) else from_store.get("Store_ID"))]
            s2 = df[df["Store_ID"] == (to_store if isinstance(to_store, str) else to_store.get("Store_ID"))]
            if not s1.empty and not s2.empty:
                dist_km = calc_haversine_km(
                    float(s1.iloc[0]["Latitude"]), float(s1.iloc[0]["Longitude"]),
                    float(s2.iloc[0]["Latitude"]), float(s2.iloc[0]["Longitude"])
                )
        except Exception:
            pass

    # Average city delivery speed ~ 20 km/h plus 10 mins loading/unloading
    transit_mins = max(10, int(round((dist_km / 20.0) * 60 + 10)))
    now = datetime.now(IST)
    eta_at = now + timedelta(minutes=transit_mins)
    
    return {
        "distance_km": dist_km,
        "transit_minutes": transit_mins,
        "duration_minutes": transit_mins,
        "eta_minutes": transit_mins,
        "eta_at": eta_at,
        "eta_text": f"{transit_mins} mins ({dist_km} km)"
    }

def get_supplier_transfer_eta(supplier, product_id=None, store_id=None, suppliers_csv_path=None, stores_csv_path=None, fetch_live_traffic=False, **kwargs):
    # Supplier lead time in days/hours
    lead_time_days = 1
    if isinstance(supplier, dict):
        lead_time_days = int(supplier.get("Lead_Time", 1))
    elif suppliers_csv_path:
        try:
            sup_df = pd.read_csv(suppliers_csv_path)
            match = sup_df[sup_df["Supplier_Name"] == supplier]
            if not match.empty:
                lead_time_days = int(match.iloc[0].get("Lead_Time", 1))
        except Exception:
            pass
    
    dist_km = 12.0
    transit_mins = max(60, lead_time_days * 24 * 60)
    now = datetime.now(IST)
    eta_at = now + timedelta(days=lead_time_days)
    
    return {
        "distance_km": dist_km,
        "transit_minutes": transit_mins,
        "duration_minutes": transit_mins,
        "eta_minutes": transit_mins,
        "lead_time_days": lead_time_days,
        "total_lead_days": lead_time_days,
        "eta_at": eta_at,
        "eta_text": f"{lead_time_days} Day(s) ({dist_km} km)"
    }

def format_eta_for_log(eta_result):
    if isinstance(eta_result, dict):
        return eta_result.get("eta_text", f"{eta_result.get('transit_minutes', 15)} mins")
    return str(eta_result)
