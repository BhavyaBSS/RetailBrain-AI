"""
RetailBrain AI - Traffic-Aware ETA
-----------------------------------
Replaces the fixed "45 minutes" transfer time and fixed "2 days" purchase
lead time with numbers computed from real store locations, live traffic,
and each supplier's actual stated lead time.

Store-to-store transfers: uses Latitude/Longitude from Stores_Registry
(already present in your data) + TomTom's Routing API for live-traffic
travel time.

Purchase orders: uses each supplier's own Lead_Time (already present in
Suppliers_Directory but previously unused) instead of a hardcoded 2 days.
If you later add supplier coordinates, this same TomTom call can be reused
for purchase ETAs too.

TomTom Routing API: free tier, no credit card, 2,500 non-tile requests/day.
Sign up at https://developer.tomtom.com and set TOMTOM_API_KEY as an env var.
If the key is missing or the API call fails for any reason, we fall back to
a straight-line-distance formula so the app never breaks.
"""

import os
import time
import math
import logging
import pandas as pd
import requests

logger = logging.getLogger("RetailBrain_AI.TrafficETA")

TOMTOM_API_KEY = os.environ.get("TOMTOM_API_KEY", "")
# TomTom's newer Orbis Maps platform (what new accounts get issued keys for).
# Note the different base path and parameter values vs the older v1 API:
#   traffic=live (not "true"), routeType=fast (not "fastest").
TOMTOM_ROUTING_URL = "https://api.tomtom.com/maps/orbis/routing/calculateRoute/{coords}/json"
TOMTOM_API_VERSION = "2"

# ---- in-memory caches -------------------------------------------------
_route_cache = {}          # {(o_lat, o_lon, d_lat, d_lon): (timestamp, result)}
ROUTE_CACHE_TTL_SECONDS = 30 * 60  # re-check traffic every 30 min, not every click

_stores_cache = {"df": None, "loaded_at": 0}
STORES_CACHE_TTL_SECONDS = 10 * 60  # reload stores file periodically in case it changes

DEFAULT_AVG_SPEED_KMH = 25       # fallback if API is unavailable (dense city traffic)
DEFAULT_SUPPLIER_LEAD_DAYS = 2   # fallback if a supplier can't be matched at all


def _haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _fallback_eta(origin_lat, origin_lon, dest_lat, dest_lon, avg_speed_kmh=DEFAULT_AVG_SPEED_KMH):
    distance_km = _haversine_km(origin_lat, origin_lon, dest_lat, dest_lon) * 1.3  # road-distance fudge
    duration_minutes = round((distance_km / avg_speed_kmh) * 60)
    return {"distance_km": round(distance_km, 1), "duration_minutes": duration_minutes, "source": "fallback_formula"}


def get_transfer_eta(origin_lat, origin_lon, dest_lat, dest_lon, fetch_live_traffic=True):
    """Core routing call: returns {distance_km, duration_minutes, source} between two coordinates."""
    cache_key = (round(origin_lat, 4), round(origin_lon, 4), round(dest_lat, 4), round(dest_lon, 4))
    cached = _route_cache.get(cache_key)
    if cached and (time.time() - cached[0]) < ROUTE_CACHE_TTL_SECONDS:
        return cached[1]

    if not TOMTOM_API_KEY:
        result = _fallback_eta(origin_lat, origin_lon, dest_lat, dest_lon)
        _route_cache[cache_key] = (time.time(), result)
        return result

    if not fetch_live_traffic:
        return _fallback_eta(origin_lat, origin_lon, dest_lat, dest_lon)

    coords = f"{origin_lat},{origin_lon}:{dest_lat},{dest_lon}"
    url = TOMTOM_ROUTING_URL.format(coords=coords)
    params = {
        "key": TOMTOM_API_KEY,
        "apiVersion": TOMTOM_API_VERSION,
        "traffic": "live",       # Orbis uses "live"/"historical", not true/false
        "travelMode": "car",
        "routeType": "fast",     # Orbis uses "fast", not "fastest"
    }

    try:
        resp = requests.get(url, params=params, timeout=6)
        resp.raise_for_status()
        summary = resp.json()["routes"][0]["summary"]
        result = {
            "distance_km": round(summary["lengthInMeters"] / 1000, 1),
            "duration_minutes": round(summary["travelTimeInSeconds"] / 60),
            "source": "tomtom_live_traffic",
        }
    except Exception as e:
        logger.warning(f"TomTom routing call failed, using fallback formula: {e}")
        result = _fallback_eta(origin_lat, origin_lon, dest_lat, dest_lon)

    _route_cache[cache_key] = (time.time(), result)
    return result


def format_eta_for_log(eta_result):
    """Human-readable string for audit logs, e.g. '1h 8m (34.2 km, live traffic)'."""
    minutes = eta_result["duration_minutes"]
    hours, mins = divmod(minutes, 60)
    time_str = f"{hours}h {mins}m" if hours else f"{mins}m"
    tag = "live traffic" if eta_result["source"] == "tomtom_live_traffic" else "estimated"
    return f"{time_str} ({eta_result['distance_km']} km, {tag})"


# ---- store lookups ------------------------------------------------------

def _load_stores(stores_file):
    now = time.time()
    if _stores_cache["df"] is not None and (now - _stores_cache["loaded_at"]) < STORES_CACHE_TTL_SECONDS:
        return _stores_cache["df"]
    df = pd.read_csv(stores_file)
    _stores_cache["df"] = df
    _stores_cache["loaded_at"] = now
    return df


def get_store_transfer_eta(from_store_id, to_store_id, stores_file, fetch_live_traffic=True):
    """
    Looks up Latitude/Longitude for both stores from the stores file and
    returns a live-traffic ETA between them. Falls back to the distance
    formula (and ultimately to a flat 45 min) if coordinates are missing.
    """
    try:
        stores_df = _load_stores(stores_file)
        from_row = stores_df[stores_df["Store_ID"] == from_store_id].iloc[0]
        to_row = stores_df[stores_df["Store_ID"] == to_store_id].iloc[0]
        return get_transfer_eta(
            from_row["Latitude"], from_row["Longitude"],
            to_row["Latitude"], to_row["Longitude"],
            fetch_live_traffic=fetch_live_traffic,
        )
    except Exception as e:
        logger.warning(f"Could not compute store-to-store ETA ({from_store_id} -> {to_store_id}): {e}")
        return {"distance_km": None, "duration_minutes": 45, "source": "flat_default"}


# ---- supplier lookups -----------------------------------------------------

def get_supplier_lead_days(supplier_name, product_id, suppliers_file):
    """
    Looks up the supplier's actual stated Lead_Time (in days) for this
    product — used as a fallback when supplier coordinates aren't available.
    """
    try:
        suppliers_df = pd.read_csv(suppliers_file)
        match = suppliers_df[
            (suppliers_df["Supplier_Name"] == supplier_name) & (suppliers_df["Product_ID"] == product_id)
        ]
        if not match.empty:
            return float(match.iloc[0]["Lead_Time"])
        logger.warning(f"No Lead_Time match for supplier={supplier_name}, product={product_id}; using default.")
    except Exception as e:
        logger.warning(f"Could not read supplier lead time: {e}")
    return DEFAULT_SUPPLIER_LEAD_DAYS


def get_supplier_transfer_eta(supplier_name, product_id, store_id, suppliers_file, stores_file):
    """
    Live-traffic transit time from supplier to store (supplier's own
    Lead_Time field is intentionally left untouched here — that field is
    used elsewhere on the classic dashboard, e.g. reorder-point math in
    inventory_optimizer.py, and this function does not read or affect it).

    If the supplier has Supplier_Latitude/Supplier_Longitude set, this
    returns a real distance/traffic-based ETA. If coordinates are missing,
    falls back to a flat default (DEFAULT_SUPPLIER_LEAD_DAYS).

    Returns:
        {
            "distance_km": float | None,
            "transit_minutes": int | None,
            "total_lead_days": float,
            "source": "tomtom_live_traffic" | "fallback_formula" | "flat_default",
        }
    """
    try:
        suppliers_df = pd.read_csv(suppliers_file)
        match = suppliers_df[
            (suppliers_df["Supplier_Name"] == supplier_name) & (suppliers_df["Product_ID"] == product_id)
        ]
        if match.empty:
            raise ValueError(f"no supplier row for {supplier_name} / {product_id}")
        srow = match.iloc[0]

        s_lat = srow.get("Supplier_Latitude")
        s_lon = srow.get("Supplier_Longitude")
        has_supplier_coords = pd.notna(s_lat) and pd.notna(s_lon) and str(s_lat).strip() != "" and str(s_lon).strip() != ""

        if not has_supplier_coords:
            return {
                "distance_km": None, "transit_minutes": None,
                "total_lead_days": DEFAULT_SUPPLIER_LEAD_DAYS, "source": "flat_default",
            }

        stores_df = _load_stores(stores_file)
        store_match = stores_df[stores_df["Store_ID"] == store_id]
        if store_match.empty:
            raise ValueError(f"no store row for {store_id}")
        store_row = store_match.iloc[0]

        eta = get_transfer_eta(
            float(s_lat), float(s_lon),
            float(store_row["Latitude"]), float(store_row["Longitude"]),
        )
        total_lead_days = round(eta["duration_minutes"] / (60 * 24), 2)

        return {
            "distance_km": eta["distance_km"],
            "transit_minutes": eta["duration_minutes"],
            "total_lead_days": total_lead_days,
            "source": eta["source"],
        }

    except Exception as e:
        logger.warning(f"Could not compute supplier transfer ETA ({supplier_name} -> {store_id}): {e}")
        return {
            "distance_km": None, "transit_minutes": None,
            "total_lead_days": DEFAULT_SUPPLIER_LEAD_DAYS, "source": "flat_default",
        }
