/**
 * RetailBrain AI — India store network map (Phases 4, 5, 6)
 * MapLibre GL JS + OpenFreeMap (free, no key, no billing).
 */
(function () {
    // ---------------------------------------------------------------
    // 1. Reveal the page through the cloud transition (built in Phase 3)
    // ---------------------------------------------------------------
    if (window.CloudTransition) {
        window.CloudTransition.revealOnLoad();
    }

    // ---------------------------------------------------------------
    // 2. City centers — computed from real store lat/long data
    // ---------------------------------------------------------------
    const CITY_BOUNDARY_ROOT = "https://bharatlas.com/api/dl/admin";
    const CITIES = [
        { name: "Delhi NCR", lat: 28.5697, lon: 77.2095, storeCount: 25, boundaryKey: "delhi", boundaryUrl: `${CITY_BOUNDARY_ROOT}/wards-delhi/wards_delhi.geojson` },
        { name: "Mumbai",    lat: 19.0985, lon: 72.8887, storeCount: 15, boundaryKey: "mumbai", boundaryUrl: `${CITY_BOUNDARY_ROOT}/wards-mumbai/wards_mumbai.geojson` },
        { name: "Bengaluru", lat: 12.9572, lon: 77.6187, storeCount: 20, boundaryKey: "bengaluru", boundaryUrl: `${CITY_BOUNDARY_ROOT}/wards-bengaluru-gba/wards_bengaluru_gba.geojson` },
        { name: "Chennai",   lat: 12.9965, lon: 80.2236, storeCount: 10, boundaryKey: "chennai", boundaryUrl: `${CITY_BOUNDARY_ROOT}/wards-chennai/wards_chennai.geojson` },
        { name: "Hyderabad", lat: 17.4512, lon: 78.4071, storeCount: 10, boundaryKey: "hyderabad", boundaryUrl: `${CITY_BOUNDARY_ROOT}/wards-hyderabad/wards_hyderabad.geojson` },
        { name: "Kolkata",   lat: 22.5444, lon: 88.3739, storeCount: 10, boundaryKey: "kolkata", boundaryUrl: `${CITY_BOUNDARY_ROOT}/wards-kolkata/wards_kolkata.geojson` },
        { name: "Pune",      lat: 18.5497, lon: 73.8392, storeCount: 10, boundaryKey: "pune", boundaryUrl: "https://raw.githubusercontent.com/datameet/Municipal_Spatial_Data/master/Pune/pune-electoral-wards-2022.geojson" },
    ];

    const urlParams = new URLSearchParams(window.location.search);
    const activeCityName = urlParams.get("city");
    const activeCity = CITIES.find((c) => c.name.toLowerCase() === (activeCityName || "").toLowerCase());

    // ---------------------------------------------------------------
    // 3. Initialize map
    // ---------------------------------------------------------------
    const INDIA_BOUNDS = [
        [68.0, 6.5],   // southwest
        [97.5, 37.5],  // northeast
    ];

    const mapOptions = {
        container: "map",
        style: "https://tiles.openfreemap.org/styles/positron",
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        renderWorldCopies: false,
    };

    if (activeCity) {
        mapOptions.center = [activeCity.lon, activeCity.lat];
        mapOptions.zoom = 11.5;
        mapOptions.minZoom = 3.2;
        mapOptions.maxZoom = 16;
    } else {
        mapOptions.bounds = INDIA_BOUNDS;
        mapOptions.fitBoundsOptions = { padding: 40 };
        mapOptions.maxBounds = [
            [54.0, -6.0],
            [112.0, 50.0],
        ];
        mapOptions.minZoom = 3.2;
        mapOptions.maxZoom = 9;
    }

    const map = new maplibregl.Map(mapOptions);
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    let activeMarkers = [];
    if (map.touchZoomRotate && map.touchZoomRotate.disableRotation) {
        map.touchZoomRotate.disableRotation();
    }

    // Recolour the vector style itself instead of applying a CSS filter to
    // the whole map. This keeps roads, administrative boundaries, waterways,
    // parks and buildings readable without altering marker colours/position.
    function applySpaceMapTheme() {
        const layers = map.getStyle().layers || [];

        const setPaint = (layerId, property, value) => {
            try {
                map.setPaintProperty(layerId, property, value);
            } catch (error) {
                // OpenFreeMap may add or remove style-specific properties.
                // A missing optional property should not stop the map loading.
            }
        };

        layers.forEach((layer) => {
            const layerName = `${layer.id} ${layer["source-layer"] || ""}`.toLowerCase();
            const isWater = /water|ocean|river|stream|canal/.test(layerName);
            const isGreen = /park|garden|grass|wood|forest|vegetation|landcover|natural/.test(layerName);
            const isBuilding = /building/.test(layerName);
            const isBoundary = /boundary|admin/.test(layerName);
            const isRoad = /road|street|highway|motorway|trunk|primary|secondary|tertiary|transport/.test(layerName);

            if (layer.type === "background") {
                setPaint(layer.id, "background-color", "#05070d");
            } else if (layer.type === "fill") {
                if (isWater) {
                    setPaint(layer.id, "fill-color", "#08283a");
                    setPaint(layer.id, "fill-opacity", 0.95);
                } else if (isGreen) {
                    setPaint(layer.id, "fill-color", "#102b28");
                    setPaint(layer.id, "fill-opacity", 0.72);
                } else if (isBuilding) {
                    setPaint(layer.id, "fill-color", "#253246");
                    setPaint(layer.id, "fill-opacity", 0.78);
                } else {
                    setPaint(layer.id, "fill-color", "#0c1421");
                    setPaint(layer.id, "fill-opacity", 0.9);
                }
            } else if (layer.type === "line") {
                if (isBoundary) {
                    setPaint(layer.id, "line-color", "#4d8aa8");
                    setPaint(layer.id, "line-opacity", 0.9);
                } else if (isWater) {
                    setPaint(layer.id, "line-color", "#25769a");
                    setPaint(layer.id, "line-opacity", 0.88);
                } else if (isRoad) {
                    setPaint(layer.id, "line-color", "#52627a");
                    setPaint(layer.id, "line-opacity", 0.82);
                } else {
                    setPaint(layer.id, "line-color", "#34465d");
                    setPaint(layer.id, "line-opacity", 0.72);
                }
            } else if (layer.type === "symbol") {
                setPaint(layer.id, "text-color", "#b8c6d9");
                setPaint(layer.id, "text-halo-color", "#05070d");
                setPaint(layer.id, "text-halo-width", 1.4);
                setPaint(layer.id, "text-opacity", 0.82);
                setPaint(layer.id, "icon-opacity", 0.7);
            } else if (layer.type === "circle") {
                setPaint(layer.id, "circle-color", "#4d8aa8");
                setPaint(layer.id, "circle-stroke-color", "#07111d");
            } else if (layer.type === "fill-extrusion") {
                setPaint(layer.id, "fill-extrusion-color", "#253246");
                setPaint(layer.id, "fill-extrusion-opacity", 0.72);
            } else if (layer.type === "raster") {
                setPaint(layer.id, "raster-brightness-min", 0.05);
                setPaint(layer.id, "raster-brightness-max", 0.42);
                setPaint(layer.id, "raster-saturation", -0.45);
                setPaint(layer.id, "raster-contrast", 0.25);
            }
        });
    }

    function citySlug(city) {
        return city.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    }

    function firstLabelLayerId() {
        const labelLayer = (map.getStyle().layers || []).find((layer) => layer.type === "symbol");
        return labelLayer ? labelLayer.id : undefined;
    }

    function fallbackCityShape(city) {
        const turf = window.turf;
        if (turf) {
            try {
                return turf.buffer(turf.point([city.lon, city.lat]), 28, { units: "kilometers", steps: 32 });
            } catch (error) {
                // Continue to the small deterministic polygon below.
            }
        }
        const longitudeRadius = city.name === "Mumbai" ? 0.23 : 0.32;
        const latitudeRadius = city.name === "Mumbai" ? 0.36 : 0.27;
        return {
            type: "Feature",
            properties: { city: city.name, fallback: true },
            geometry: {
                type: "Polygon",
                coordinates: [[
                    [city.lon - longitudeRadius, city.lat - latitudeRadius],
                    [city.lon + longitudeRadius, city.lat - latitudeRadius],
                    [city.lon + longitudeRadius, city.lat + latitudeRadius],
                    [city.lon - longitudeRadius, city.lat + latitudeRadius],
                    [city.lon - longitudeRadius, city.lat - latitudeRadius],
                ]],
            },
        };
    }

    function combineBoundaryFeatures(data) {
        const turf = window.turf;
        const polygonFeatures = (data && data.features ? data.features : [])
            .filter((feature) => feature.geometry && /Polygon$/.test(feature.geometry.type));
        if (!polygonFeatures.length) throw new Error("Boundary file contains no polygon features");
        if (!turf || polygonFeatures.length === 1) return polygonFeatures[0];

        try {
            const combined = turf.union(turf.featureCollection(polygonFeatures));
            return turf.simplify(combined, { tolerance: 0.00025, highQuality: true, mutate: false });
        } catch (error) {
            // Keep one renderable city feature even when a browser cannot
            // dissolve touching wards into a topological union.
            return {
                type: "Feature",
                properties: { combinedWards: true },
                geometry: {
                    type: "MultiPolygon",
                    coordinates: polygonFeatures.flatMap((feature) => feature.geometry.type === "Polygon"
                        ? [feature.geometry.coordinates]
                        : feature.geometry.coordinates),
                },
            };
        }
    }

    function asFeatureCollection(shape) {
        return shape.type === "FeatureCollection" ? shape : { type: "FeatureCollection", features: [shape] };
    }

    async function loadRealCityBoundary(city) {
        const response = await fetch(city.boundaryUrl);
        if (!response.ok) throw new Error(`Boundary request failed (${response.status})`);
        return combineBoundaryFeatures(await response.json());
    }

    function addOverviewBoundary(city, initialShape) {
        const slug = citySlug(city);
        const sourceId = `retailbrain-city-shape-${slug}`;
        const fillId = `${sourceId}-fill`;
        const outlineId = `${sourceId}-outline`;
        const beforeId = firstLabelLayerId();

        const initialData = asFeatureCollection(initialShape);
        map.addSource(sourceId, { type: "geojson", data: initialData });
        map.addLayer({
            id: fillId,
            type: "fill",
            source: sourceId,
            paint: { "fill-color": "#5ee7ff", "fill-opacity": 0.12 },
        }, beforeId);
        map.addLayer({
            id: outlineId,
            type: "line",
            source: sourceId,
            paint: {
                "line-color": "#5ee7ff",
                "line-opacity": 0.78,
                "line-width": 2.4,
                "line-dasharray": [1.5, 1.5],
            },
        }, beforeId);

        map.on("click", fillId, () => onCityClick(city));
        loadRealCityBoundary(city)
            .then((shape) => map.getSource(sourceId)?.setData(asFeatureCollection(shape)))
            .catch((error) => console.warn(`${city.name} boundary unavailable; keeping local highlight.`, error));
    }

    function storeFootprintShape(city, stores) {
        const turf = window.turf;
        const points = stores
            .map((store) => [Number(store.Longitude), Number(store.Latitude)])
            .filter(([longitude, latitude]) => Number.isFinite(longitude) && Number.isFinite(latitude));
        if (turf && points.length) {
            try {
                const pointCollection = turf.featureCollection(points.map((point) => turf.point(point)));
                const hull = points.length >= 3 ? turf.convex(pointCollection) : null;
                return turf.buffer(hull || turf.point([city.lon, city.lat]), points.length >= 3 ? 5 : 22, {
                    units: "kilometers",
                    steps: 32,
                });
            } catch (error) {
                // Use the city fallback when Turf cannot build a hull.
            }
        }
        return fallbackCityShape(city);
    }

    function outsideMask(shape) {
        const turf = window.turf;
        const world = {
            type: "Feature",
            properties: {},
            geometry: { type: "Polygon", coordinates: [[[-179, -80], [179, -80], [179, 80], [-179, 80], [-179, -80]]] },
        };
        if (!turf) return world;
        try {
            return turf.difference(turf.featureCollection([world, shape])) || world;
        } catch (error) {
            return world;
        }
    }

    function keepSelectedBoundaryOnTop(slug) {
        [`retailbrain-selected-shape-${slug}-glow`, `retailbrain-selected-shape-${slug}-outline`].forEach((id) => {
            if (map.getLayer(id)) map.moveLayer(id);
        });
    }

    function addSelectedCityBoundary(city, stores) {
        const slug = citySlug(city);
        const sourceId = `retailbrain-selected-shape-${slug}`;
        const maskSourceId = `${sourceId}-outside-mask`;
        const immediateShape = storeFootprintShape(city, stores);
        const beforeId = firstLabelLayerId();

        // Selected-city views intentionally use the operational footprint
        // derived from the city's stores, not a municipal boundary. This
        // keeps every visible store inside one simple, stable network area.
        map.addSource(sourceId, { type: "geojson", data: immediateShape });
        map.addSource(maskSourceId, { type: "geojson", data: outsideMask(immediateShape) });
        map.addLayer({
            id: `${sourceId}-mask`, type: "fill", source: maskSourceId,
            paint: { "fill-color": "#03060d", "fill-opacity": 0.9 },
        }, beforeId);
        map.addLayer({
            id: `${sourceId}-fill`, type: "fill", source: sourceId,
            paint: { "fill-color": "#5ee7ff", "fill-opacity": 0.3 },
        }, beforeId);
        map.addLayer({
            id: `${sourceId}-glow`, type: "line", source: sourceId,
            paint: {
                "line-color": "#00dcff",
                "line-opacity": 0.24,
                "line-width": 12,
                "line-blur": 8,
            },
        }, beforeId);
        map.addLayer({
            id: `${sourceId}-outline`, type: "line", source: sourceId,
            paint: {
                "line-color": "#69eaff",
                "line-opacity": 0.95,
                "line-width": 4,
                "line-dasharray": [1.2, 1.2],
            },
        }, beforeId);
        keepSelectedBoundaryOnTop(slug);
    }

    function minimizeSurroundingMap() {
        (map.getStyle().layers || []).forEach((layer) => {
            const name = `${layer.id} ${layer["source-layer"] || ""}`.toLowerCase();
            try {
                if (layer.type === "line" && /road|street|highway|transport/.test(name)) map.setPaintProperty(layer.id, "line-opacity", 0.12);
                if (layer.type === "line" && /boundary|admin/.test(name)) map.setPaintProperty(layer.id, "line-opacity", 0.14);
                if (layer.type === "symbol") map.setPaintProperty(layer.id, "text-opacity", 0.24);
            } catch (error) {
                // Optional style layers vary between OpenFreeMap releases.
            }
        });
    }

    map.on("load", () => {
        applySpaceMapTheme();
        if (activeCity) {
            minimizeSurroundingMap();
            renderStoreMarkers(activeCity.name);
        } else {
            CITIES.forEach((city) => addOverviewBoundary(city, fallbackCityShape(city)));
            renderCityMarkers();
        }
    });

    // ---------------------------------------------------------------
    // 4. Update Header UI
    // ---------------------------------------------------------------
    const breadcrumbContainer = document.getElementById("breadcrumb-container");
    const mapTitle = document.getElementById("map-title-heading");
    const mapSubtitle = document.getElementById("map-subtitle-text");

    if (activeCity) {
        if (breadcrumbContainer) {
            breadcrumbContainer.innerHTML = `
                <a id="back-to-india-btn" class="back-link">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                    All India Network
                </a>
            `;
            document.getElementById("back-to-india-btn").addEventListener("click", (e) => {
                e.preventDefault();
                if (window.CloudTransition) {
                    window.CloudTransition.coverAndNavigate("/india-map");
                } else {
                    window.location.href = "/india-map";
                }
            });
        }
        if (mapTitle) mapTitle.innerHTML = `${activeCity.name} <span class="accent">Stores</span>`;
        if (mapSubtitle) mapSubtitle.textContent = `Displaying ${activeCity.storeCount} dark stores in ${activeCity.name}. Click a store to inspect SKU stock.`;
    }

    // ---------------------------------------------------------------
    // 5. City View (All-India)
    // ---------------------------------------------------------------
    function renderCityMarkers() {
        CITIES.forEach((city) => {
            const el = document.createElement("div");
            el.className = "city-marker";

            const dot = document.createElement("div");
            dot.className = "city-dot";

            const label = document.createElement("div");
            label.className = "city-label";
            label.textContent = city.name;

            const info = document.createElement("div");
            info.className = "city-info";
            info.innerHTML = `
                <div class="city-info-name">${city.name}</div>
                <div class="city-info-row">
                    <span>Stores</span>
                    <span class="value">${city.storeCount}</span>
                </div>
                <div class="city-info-row">
                    <span>Need restock</span>
                    <span class="value loading" data-restock="${city.name}">…</span>
                </div>
            `;

            el.appendChild(info);
            el.appendChild(dot);
            el.appendChild(label);

            el.addEventListener("click", () => onCityClick(city));

            const m = new maplibregl.Marker({ element: el, anchor: "center" })
                .setLngLat([city.lon, city.lat])
                .addTo(map);
            activeMarkers.push(m);
        });

        // Live restock counts per city
        fetch("/api/stores")
            .then((res) => res.json())
            .then((stores) => {
                const restockByCity = {};
                stores.forEach((s) => {
                    const cName = s.City;
                    const alerts = s.reorder_alerts_count || 0;
                    restockByCity[cName] = (restockByCity[cName] || 0) + (alerts > 0 ? 1 : 0);
                });

                document.querySelectorAll("[data-restock]").forEach((elm) => {
                    const cityName = elm.getAttribute("data-restock");
                    const count = restockByCity[cityName] ?? 0;
                    elm.textContent = count;
                    elm.classList.remove("loading");
                    if (count > 0) elm.classList.add("alert");
                });
            })
            .catch(() => {
                document.querySelectorAll("[data-restock]").forEach((elm) => {
                    elm.textContent = "—";
                    elm.classList.remove("loading");
                });
            });
    }

    function onCityClick(city) {
        if (window.CloudTransition) {
            window.CloudTransition.coverAndNavigate(`/india-map?city=${encodeURIComponent(city.name)}`);
        } else {
            window.location.href = `/india-map?city=${encodeURIComponent(city.name)}`;
        }
    }

    // ---------------------------------------------------------------
    // 6. Store Markers View (Chosen City)
    // ---------------------------------------------------------------
    function renderStoreMarkers(cityName) {
        fetch("/api/stores")
            .then((res) => res.json())
            .then((stores) => {
                const cityStores = stores.filter((s) => s.City.toLowerCase() === cityName.toLowerCase());

                fitMapToCityStores(cityStores);
                addSelectedCityBoundary(activeCity, cityStores);

                cityStores.forEach((s) => {
                    const el = document.createElement("div");
                    el.className = "store-marker";
                    el.setAttribute("data-store-id", s.Store_ID);

                    const dot = document.createElement("div");
                    dot.className = `store-dot ${s.reorder_alerts_count > 0 ? "has-alert" : ""}`;

                    const label = document.createElement("div");
                    label.className = "store-label";
                    label.textContent = s.Store_Name.replace(` (${s.City})`, "").replace(`${s.City} `, "");

                    const info = document.createElement("div");
                    info.className = "store-info";
                    info.innerHTML = `
                        <div class="store-info-title">${s.Store_Name}</div>
                        <div class="store-info-locality">${s.Locality}, ${s.City}</div>
                        <div class="store-info-row">
                            <span>Store Type</span>
                            <span class="value">${s.Store_Type}</span>
                        </div>
                        <div class="store-info-row">
                            <span>Health Score</span>
                            <span class="value">${s.health_score ?? 100}%</span>
                        </div>
                        <div class="store-info-row">
                            <span>Reorder Alerts</span>
                            <span class="value ${s.reorder_alerts_count > 0 ? 'alert' : ''}">${s.reorder_alerts_count || 0}</span>
                        </div>
                        <div class="store-click-hint">Click to inspect inventory</div>
                    `;

                    el.appendChild(info);
                    el.appendChild(dot);
                    el.appendChild(label);

                    el.addEventListener("click", () => onStoreClick(s));

                    const m = new maplibregl.Marker({ element: el, anchor: "center" })
                        .setLngLat([s.Longitude, s.Latitude])
                        .addTo(map);
                    activeMarkers.push(m);
                });
            })
            .catch((err) => {
                console.error("Error loading store markers:", err);
            });
    }

    function fitMapToCityStores(stores) {
        const coordinates = stores
            .map((store) => [Number(store.Longitude), Number(store.Latitude)])
            .filter(([longitude, latitude]) => Number.isFinite(longitude) && Number.isFinite(latitude));

        if (!coordinates.length) return;

        const longitudes = coordinates.map(([longitude]) => longitude);
        const latitudes = coordinates.map(([, latitude]) => latitude);
        const west = Math.min(...longitudes);
        const east = Math.max(...longitudes);
        const south = Math.min(...latitudes);
        const north = Math.max(...latitudes);
        const bounds = new maplibregl.LngLatBounds([west, south], [east, north]);
        const longitudePadding = Math.max((east - west) * 1.2, 0.2);
        const latitudePadding = Math.max((north - south) * 1.2, 0.2);
        const viewBounds = new maplibregl.LngLatBounds(
            [west - longitudePadding, south - latitudePadding],
            [east + longitudePadding, north + latitudePadding]
        );

        map.setMaxBounds([
            [west - longitudePadding, south - latitudePadding],
            [east + longitudePadding, north + latitudePadding],
        ]);

        const compactLayout = window.innerWidth < 720;
        const cameraPadding = {
            top: compactLayout ? 150 : 220,
            right: compactLayout ? 32 : 130,
            bottom: compactLayout ? 72 : 125,
            left: compactLayout ? 32 : 130,
        };
        const camera = map.cameraForBounds(viewBounds, {
            padding: cameraPadding,
            maxZoom: 13.25,
        });

        if (camera) {
            // Allow additional context around the city without letting the
            // user zoom so far out that the selected network becomes lost.
            map.setMinZoom(Math.max(4.5, camera.zoom - 2.5));
        }

        map.fitBounds(viewBounds, {
            padding: cameraPadding,
            maxZoom: 13.25,
            duration: 800,
        });
    }

    function onStoreClick(store) {
        console.log("Store clicked:", store);
        if (window.showStoreInventoryDrawer) {
            window.showStoreInventoryDrawer(store);
        }
    }

    window.RetailBrainMap = { map, CITIES, activeCity };
})();
