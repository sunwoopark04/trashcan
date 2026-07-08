const APP_KEY = window.KAKAO_MAP_APP_KEY || "";

const rawCountEl = document.getElementById("rawCount");
const placeCountEl = document.getElementById("placeCount");
const resolvedCountEl = document.getElementById("resolvedCount");
const statusTextEl = document.getElementById("statusText");
const districtFilterEl = document.getElementById("districtFilter");
const typeFilterEl = document.getElementById("typeFilter");
const locationListEl = document.getElementById("locationList");
const locateBtnEl = document.getElementById("locateBtn");
const routeBtnEl = document.getElementById("routeBtn");
const emergencyBtnEl = document.getElementById("emergencyBtn");
const routeStatusEl = document.getElementById("routeStatus");
const emergencyStatusEl = document.getElementById("emergencyStatus");

const typePriority = ["일반쓰레기", "재활용쓰레기", "담배꽁초 수거함"];
const colorByType = {
  일반쓰레기: "#38bdf8",
  재활용쓰레기: "#22c55e",
  "담배꽁초 수거함": "#fb7185",
};

const EARTH_RADIUS_M = 6371000;
const ROUTE_API = "https://router.project-osrm.org/route/v1/walking/";
const MAX_NEARBY = 5;

const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const uniqueTypes = (types) =>
  [...types].sort((a, b) => typePriority.indexOf(a) - typePriority.indexOf(b));

function normalizeTypeValue(value) {
  const compact = normalize(value).replace(/\s+/g, "");
  if (!compact) return [];
  if (compact.includes("담배꽁초")) {
    const types = ["담배꽁초 수거함"];
    if (compact.includes("재활용")) types.push("재활용쓰레기");
    return types;
  }
  if (compact.includes("일반") && compact.includes("재활용")) {
    return ["일반쓰레기", "재활용쓰레기"];
  }
  if (compact.includes("재활용")) return ["재활용쓰레기"];
  if (compact.includes("일반")) return ["일반쓰레기"];
  return [normalize(value)];
}

function groupRawRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = [row.district, normalize(row.address), normalize(row.place || "-")].join("|");
    if (!map.has(key)) {
      map.set(key, {
        key,
        district: row.district,
        address: normalize(row.address),
        place: normalize(row.place),
        category: row.category,
        ids: [],
        types: new Set(),
        rows: [],
        lat: null,
        lng: null,
        loaded: false,
      });
    }
    const place = map.get(key);
    place.ids.push(row.id);
    for (const type of normalizeTypeValue(row.type)) {
      place.types.add(type);
    }
    place.rows.push(row);
  }
  return [...map.values()].sort((a, b) =>
    `${a.district}${a.address}${a.place}`.localeCompare(`${b.district}${b.address}${b.place}`, "ko")
  );
}

function buildDistrictMap(groupedPlaces) {
  const map = new Map();
  for (const place of groupedPlaces) {
    if (!map.has(place.district)) {
      map.set(place.district, []);
    }
    map.get(place.district).push(place);
  }
  return map;
}

function loadKakaoSdk() {
  return new Promise((resolve, reject) => {
    if (!APP_KEY || APP_KEY === "YOUR_KAKAO_JS_KEY") {
      reject(new Error("Kakao JavaScript key is not set."));
      return;
    }

    if (window.kakao && window.kakao.maps) {
      resolve(window.kakao);
      return;
    }

    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(
      APP_KEY
    )}&libraries=services&autoload=false`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.kakao);
    script.onerror = () => reject(new Error("Failed to load Kakao SDK."));
    document.head.appendChild(script);
  });
}

function buildMarkerImage(kakao, color) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">
      <circle cx="17" cy="17" r="11" fill="${color}" stroke="#0f172a" stroke-width="2"/>
      <circle cx="17" cy="17" r="4" fill="white" opacity="0.95"/>
    </svg>
  `;
  return new kakao.maps.MarkerImage(
    `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    new kakao.maps.Size(34, 34),
    { offset: new kakao.maps.Point(17, 17) }
  );
}

function buildTargetImage(kakao) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">
      <circle cx="17" cy="17" r="11" fill="#f97316" stroke="#0f172a" stroke-width="2"/>
      <circle cx="17" cy="17" r="4" fill="white" opacity="0.95"/>
    </svg>
  `;
  return new kakao.maps.MarkerImage(
    `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    new kakao.maps.Size(34, 34),
    { offset: new kakao.maps.Point(17, 17) }
  );
}

function getMarkerColor(place, state) {
  if (state.routeTargetKey === place.key) return "#fbbf24";
  const types = [...place.types];
  if (types.includes("담배꽁초 수거함")) return colorByType["담배꽁초 수거함"];
  if (types.includes("재활용쓰레기") && types.includes("일반쓰레기")) return "#14b8a6";
  if (types.includes("재활용쓰레기")) return colorByType["재활용쓰레기"];
  return colorByType["일반쓰레기"];
}

function popupHtml(place) {
  const typeBadges = uniqueTypes(place.types)
    .map((type) => `<span class="pill">${type}</span>`)
    .join("");
  return `
    <div class="popup-title">${place.district} ${place.place || ""}</div>
    <div class="popup-line">Address: ${place.address}</div>
    <div class="popup-line">Detail: ${place.place || "-"}</div>
    <div class="popup-line">ID: ${place.ids.join(", ")}</div>
    <div class="popup-line">Type: ${uniqueTypes(place.types).join(", ")}</div>
    <div>${typeBadges}</div>
  `;
}

function buildKakaoRouteUrl(place, originLatLng) {
  const label = encodeURIComponent(place.place || place.address || "Trash Bin");
  if (!originLatLng || typeof originLatLng.getLat !== "function" || typeof originLatLng.getLng !== "function") {
    return `https://map.kakao.com/link/to/${label},${place.lat},${place.lng}`;
  }

  const originLabel = encodeURIComponent("Current Location");
  const originLat = originLatLng.getLat();
  const originLng = originLatLng.getLng();
  return `https://map.kakao.com/link/from/${originLabel},${originLat},${originLng}/to/${label},${place.lat},${place.lng}`;
}

function openKakaoRouteWindow(place, originLatLng, routeWindow = null) {
  const routeUrl = buildKakaoRouteUrl(place, originLatLng);
  if (routeWindow && !routeWindow.closed) {
    const popup = routeWindow;
    popup.opener = null;
    popup.location.replace(routeUrl);
    return popup;
  }
  window.location.href = routeUrl;
  return null;
}

function renderList(items, onSelect) {
  locationListEl.innerHTML = "";
  if (!items.length) {
    locationListEl.innerHTML = '<div class="status">No places match the current filters.</div>';
    return;
  }

  for (const item of items) {
    const node = document.createElement("div");
    node.className = "location-item";
    node.innerHTML = `
      <div class="location-title">${item.district} ${item.place || "(no detail)"}</div>
      <div class="location-sub">${item.address}</div>
      <div class="location-sub">Types: ${uniqueTypes(item.types).join(", ")}</div>
      <div class="location-sub">ID: ${item.ids.join(", ")}</div>
    `;
    node.addEventListener("click", () => onSelect(item));
    locationListEl.appendChild(node);
  }
}

function createMapState(kakao) {
  const mapContainer = document.getElementById("map");
  const map = new kakao.maps.Map(mapContainer, {
    center: new kakao.maps.LatLng(37.5665, 126.978),
    level: 8,
  });

  return {
    kakao,
    map,
    geocoder: new kakao.maps.services.Geocoder(),
    infoWindow: new kakao.maps.InfoWindow({ zIndex: 10 }),
    markers: new Map(),
    currentLocation: { marker: null, circle: null, latLng: null },
    routeState: { polyline: null, targetMarker: null, routeCoords: null },
    activeDistrict: "all",
    activeType: "all",
    activeLoadToken: 0,
    districtLoadPromises: new Map(),
    loadedDistricts: new Set(),
    preferredDistrict: null,
    routeTargetKey: null,
    selectedPlaceKey: null,
  };
}

function clearAllMarkers(state) {
  for (const marker of state.markers.values()) {
    marker.setMap(null);
  }
  state.markers.clear();
}

function removeMarker(state, key) {
  const marker = state.markers.get(key);
  if (marker) {
    marker.setMap(null);
    state.markers.delete(key);
  }
}

function createOrUpdateMarker(state, place) {
  if (!place.loaded || !place.lat || !place.lng) return;
  const position = new state.kakao.maps.LatLng(place.lat, place.lng);
  let marker = state.markers.get(place.key);

    if (!marker) {
      marker = new state.kakao.maps.Marker({
        map: state.map,
        position,
        image: buildMarkerImage(state.kakao, getMarkerColor(place, state)),
      });
      state.kakao.maps.event.addListener(marker, "click", () => {
        state.selectedPlaceKey = place.key;
        state.infoWindow.setContent(
          `<div style="padding:12px 14px;min-width:240px;max-width:320px;">${popupHtml(place)}</div>`
        );
        state.infoWindow.open(state.map, marker);
      });
    state.markers.set(place.key, marker);
  } else {
    marker.setPosition(position);
    marker.setImage(buildMarkerImage(state.kakao, getMarkerColor(place, state)));
    marker.setMap(state.map);
  }
}

function refreshMarkerStyles(state, places) {
  for (const place of places) {
    const marker = state.markers.get(place.key);
    if (marker) {
      marker.setImage(buildMarkerImage(state.kakao, getMarkerColor(place, state)));
    }
  }
}

function geocodeCacheKey(query) {
  return `kakao-geocode:${query}`;
}

function districtCacheKey(district) {
  return `district-geocode:${district}`;
}

function buildQueries(place) {
  const queries = [];
  if (place.address && place.address !== "-") {
    queries.push(`서울특별시 ${place.district} ${place.address} ${place.place}`.trim());
    queries.push(`서울특별시 ${place.district} ${place.address}`.trim());
  }
  if (place.place && place.place !== "-" && place.place !== place.address) {
    queries.push(`서울특별시 ${place.district} ${place.place}`.trim());
  }
  return [...new Set(queries)];
}

async function resolvePlaceCoordinates(state, place) {
  for (const query of buildQueries(place)) {
    const cached = localStorage.getItem(geocodeCacheKey(query));
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed) return parsed;
    }

    const result = await new Promise((resolve) => {
      state.geocoder.addressSearch(query, (data, status) => {
        if (status === state.kakao.maps.services.Status.OK && data && data.length) {
          resolve({ lat: Number(data[0].y), lng: Number(data[0].x) });
        } else {
          resolve(null);
        }
      });
    });

    if (result) {
      localStorage.setItem(geocodeCacheKey(query), JSON.stringify(result));
      return result;
    }

    await sleep(50);
  }

  return null;
}

async function centerToDistrict(state, district) {
  if (!district || district === "all") return;

  const cached = localStorage.getItem(districtCacheKey(district));
  if (cached) {
    const parsed = JSON.parse(cached);
    if (parsed) {
      state.map.setCenter(new state.kakao.maps.LatLng(parsed.lat, parsed.lng));
      state.map.setLevel(6);
      return;
    }
  }

  const result = await new Promise((resolve) => {
    state.geocoder.addressSearch(`서울특별시 ${district}`, (data, status) => {
      if (status === state.kakao.maps.services.Status.OK && data && data.length) {
        resolve({ lat: Number(data[0].y), lng: Number(data[0].x) });
      } else {
        resolve(null);
      }
    });
  });

  if (result) {
    localStorage.setItem(districtCacheKey(district), JSON.stringify(result));
    state.map.setCenter(new state.kakao.maps.LatLng(result.lat, result.lng));
    state.map.setLevel(6);
  }
}

async function getDistrictCenterCoords(state, district) {
  if (!district || district === "all") return null;

  const cached = localStorage.getItem(districtCacheKey(district));
  if (cached) {
    const parsed = JSON.parse(cached);
    if (parsed) return parsed;
  }

  const result = await new Promise((resolve) => {
    state.geocoder.addressSearch(`서울특별시 ${district}`, (data, status) => {
      if (status === state.kakao.maps.services.Status.OK && data && data.length) {
        resolve({ lat: Number(data[0].y), lng: Number(data[0].x) });
      } else {
        resolve(null);
      }
    });
  });

  if (result) {
    localStorage.setItem(districtCacheKey(district), JSON.stringify(result));
  }

  return result;
}

async function resolvePreferredDistrict(state, districtNames) {
  const current = state.currentLocation.latLng;
  if (!current) return null;

  const currentLat = current.getLat();
  const currentLng = current.getLng();

  const regionName = await new Promise((resolve) => {
    state.geocoder.coord2RegionCode(currentLng, currentLat, (data, status) => {
      if (status !== state.kakao.maps.services.Status.OK || !data || !data.length) {
        resolve(null);
        return;
      }

      const match = data.find((item) => item.region_type === "H" || item.region_type === "B") || data[0];
      const name = match?.region_2depth_name || null;
      resolve(name && districtNames.includes(name) ? name : null);
    });
  });

  if (regionName) return regionName;

  let nearestDistrict = null;
  let nearestDistance = Infinity;
  for (const district of districtNames) {
    const center = await getDistrictCenterCoords(state, district);
    if (!center) continue;
    const distance = distanceMeters(currentLat, currentLng, center.lat, center.lng);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestDistrict = district;
    }
  }

  return nearestDistrict;
}

async function loadDistrict(state, placesByDistrict, district, onProgress) {
  if (!district || district === "all") return [];
  if (state.loadedDistricts.has(district)) {
    return placesByDistrict.get(district) || [];
  }
  if (state.districtLoadPromises.has(district)) {
    return state.districtLoadPromises.get(district);
  }

  const promise = (async () => {
    const places = placesByDistrict.get(district) || [];
    let loadedCount = 0;

    for (const place of places) {
      if (!place.loaded) {
        const coords = await resolvePlaceCoordinates(state, place);
        if (coords) {
          place.lat = coords.lat;
          place.lng = coords.lng;
          place.loaded = true;
          loadedCount += 1;
        }
      }
      onProgress?.(loadedCount, places.length, place);
      await sleep(15);
    }

    state.loadedDistricts.add(district);
    return places;
  })();

  state.districtLoadPromises.set(district, promise);
  return promise;
}

async function loadAllDistricts(state, placesByDistrict, onProgress, districtOrder = null) {
  const districts = districtOrder || [...placesByDistrict.keys()].sort((a, b) => a.localeCompare(b, "ko"));
  for (const district of districts) {
    await loadDistrict(state, placesByDistrict, district, onProgress);
  }
}

function countLoadedPlaces(placesByDistrict) {
  let count = 0;
  for (const places of placesByDistrict.values()) {
    for (const place of places) {
      if (place.loaded) count += 1;
    }
  }
  return count;
}

function getAllPlaces(placesByDistrict) {
  return [...placesByDistrict.values()].flat();
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getReferenceLatLng(state) {
  if (state.currentLocation.latLng) return state.currentLocation.latLng;
  return state.map.getCenter();
}

function sortByDistance(referenceLatLng, places) {
  const ref = { lat: referenceLatLng.getLat(), lng: referenceLatLng.getLng() };
  return [...places].sort((a, b) => {
    const da = distanceMeters(ref.lat, ref.lng, a.lat, a.lng);
    const db = distanceMeters(ref.lat, ref.lng, b.lat, b.lng);
    return da - db;
  });
}

function getVisiblePlaces(state, placesByDistrict) {
  const source =
    state.activeDistrict === "all"
      ? getAllPlaces(placesByDistrict)
      : placesByDistrict.get(state.activeDistrict) || [];

  const filtered = source.filter(
    (place) => place.loaded && (state.activeType === "all" || place.types.has(state.activeType))
  );

  if (state.activeDistrict === "all") {
    const ref = getReferenceLatLng(state);
    return sortByDistance(ref, filtered).slice(0, MAX_NEARBY);
  }

  return filtered;
}

function updateListAndMarkers(state, placesByDistrict) {
  const districtPlaces =
    state.activeDistrict === "all"
      ? getAllPlaces(placesByDistrict)
      : placesByDistrict.get(state.activeDistrict) || [];
  const visible = getVisiblePlaces(state, placesByDistrict);
  const visibleKeySet = new Set(visible.map((place) => place.key));

  for (const place of districtPlaces) {
    if (visibleKeySet.has(place.key)) {
      createOrUpdateMarker(state, place);
    } else {
      removeMarker(state, place.key);
    }
  }

  renderList(visible, (place) => {
    state.selectedPlaceKey = place.key;
    state.map.setCenter(new state.kakao.maps.LatLng(place.lat, place.lng));
    state.map.setLevel(4);
    const marker = state.markers.get(place.key);
    if (marker) {
      state.infoWindow.setContent(
        `<div style="padding:12px 14px;min-width:240px;max-width:320px;">${popupHtml(place)}</div>`
      );
      state.infoWindow.open(state.map, marker);
    }
  });

  resolvedCountEl.textContent = String(visible.length);
  refreshMarkerStyles(state, visible);
}

function findNearestPlace(state, places) {
  const ref = getReferenceLatLng(state);
  if (!ref) return null;
  const refPoint = { lat: ref.getLat(), lng: ref.getLng() };

  let nearest = null;
  let nearestDistance = Infinity;
  for (const place of places) {
    if (!place.loaded || !place.lat || !place.lng) continue;
    const distance = distanceMeters(refPoint.lat, refPoint.lng, place.lat, place.lng);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = place;
    }
  }

  return nearest;
}

function clearRoute(state) {
  state.routeTargetKey = null;
  if (state.routeState.polyline) {
    state.routeState.polyline.setMap(null);
    state.routeState.polyline = null;
  }
  if (state.routeState.targetMarker) {
    state.routeState.targetMarker.setMap(null);
    state.routeState.targetMarker = null;
  }
  state.routeState.routeCoords = null;
}

function showTargetOnMap(state, targetPlace) {
  state.selectedPlaceKey = targetPlace.key;
  state.routeTargetKey = targetPlace.key;
  state.map.setCenter(new state.kakao.maps.LatLng(targetPlace.lat, targetPlace.lng));
  state.map.setLevel(4);
}

function getSelectedPlace(state, places) {
  if (!state.selectedPlaceKey) return null;
  return places.find((place) => place.key === state.selectedPlaceKey) || null;
}

async function initializeMap() {
  try {
    const kakao = await loadKakaoSdk();

    kakao.maps.load(async () => {
      const state = createMapState(kakao);
      const groupedPlaces = groupRawRows(trashBins);
      const placesByDistrict = buildDistrictMap(groupedPlaces);
      const districtNames = [...placesByDistrict.keys()].sort((a, b) => a.localeCompare(b, "ko"));

      rawCountEl.textContent = String(trashBins.length);
      placeCountEl.textContent = String(groupedPlaces.length);
      resolvedCountEl.textContent = "0";

      for (const district of districtNames) {
        const option = document.createElement("option");
        option.value = district;
        option.textContent = district;
        districtFilterEl.appendChild(option);
      }

      async function showCurrentLocation() {
        if (!navigator.geolocation) {
          statusTextEl.textContent = "This browser does not support geolocation.";
          state.map.setCenter(new state.kakao.maps.LatLng(37.5665, 126.978));
          return;
        }

        locateBtnEl.disabled = true;
        statusTextEl.textContent = "Finding current location...";

        navigator.geolocation.getCurrentPosition(
          (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            const currentPosition = new state.kakao.maps.LatLng(lat, lng);
            state.currentLocation.latLng = currentPosition;

            if (state.currentLocation.marker) state.currentLocation.marker.setMap(null);
            if (state.currentLocation.circle) state.currentLocation.circle.setMap(null);

            state.currentLocation.marker = new state.kakao.maps.Marker({
              map: state.map,
              position: currentPosition,
            });
            state.currentLocation.circle = new state.kakao.maps.Circle({
              map: state.map,
              center: currentPosition,
              radius: position.coords.accuracy,
              strokeWeight: 2,
              strokeColor: "#38bdf8",
              strokeOpacity: 0.8,
              fillColor: "#38bdf8",
              fillOpacity: 0.2,
            });

            state.map.setCenter(currentPosition);
            state.map.setLevel(4);

            statusTextEl.textContent = "Current location found.";
            emergencyStatusEl.textContent =
              "With current location set, the emergency button can find the nearest trash bin.";
            locateBtnEl.disabled = false;
            void (async () => {
              state.preferredDistrict = await resolvePreferredDistrict(state, districtNames);
              onFilterChange();
            })();
          },
          (error) => {
            statusTextEl.textContent = `Could not get current location: ${error.message}`;
            locateBtnEl.disabled = false;
            state.map.setCenter(new state.kakao.maps.LatLng(37.5665, 126.978));
            state.preferredDistrict = null;
            onFilterChange();
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 30000,
          }
        );
      }

      async function ensureAllPlacesLoaded(onProgress) {
        await loadAllDistricts(state, placesByDistrict, onProgress);
      }

      async function handleEmergency() {
        if (!state.currentLocation.latLng) {
          emergencyStatusEl.textContent = "Please set your current location first.";
          return;
        }

        emergencyBtnEl.disabled = true;
        emergencyStatusEl.textContent = "Searching for the top visible trash bin...";
        statusTextEl.textContent = "Calculating emergency route...";
        try {
          const visiblePlaces = getVisiblePlaces(state, placesByDistrict);
          const loadedPlaces = getAllPlaces(placesByDistrict).filter(
            (place) => place.loaded && place.lat && place.lng
          );
          const targetPlace =
            visiblePlaces[0] ||
            findNearestPlace(state, loadedPlaces) ||
            findNearestPlace(state, getAllPlaces(placesByDistrict));
          if (!targetPlace) {
            emergencyStatusEl.textContent = "Could not find a trash bin to route to.";
            return;
          }

          showTargetOnMap(state, targetPlace);
          updateListAndMarkers(state, placesByDistrict);

          const marker = state.markers.get(targetPlace.key);
          if (marker) {
            state.infoWindow.setContent(
              `<div style="padding:12px 14px;min-width:240px;max-width:320px;">${popupHtml(targetPlace)}</div>`
            );
            state.infoWindow.open(state.map, marker);
          }

          const routeUrl = buildKakaoRouteUrl(targetPlace, state.currentLocation.latLng);
          const routeWindow = window.open(routeUrl, "_blank");
          if (!routeWindow) {
            window.location.href = routeUrl;
          }

          emergencyStatusEl.textContent = `Opened Kakao Maps route to: ${targetPlace.district} ${
            targetPlace.place || targetPlace.address
          }`;
          statusTextEl.textContent = "Kakao Maps route opened.";
        } catch (error) {
          emergencyStatusEl.textContent = `Emergency route failed: ${error.message}`;
        } finally {
          emergencyBtnEl.disabled = false;
        }
      }

      function handleSelectedRoute() {
        if (!state.currentLocation.latLng) {
          routeStatusEl.textContent = "현재위치를 먼저 설정해 주세요.";
          return;
        }

        const allPlaces = getAllPlaces(placesByDistrict);
        const selectedPlace = getSelectedPlace(state, allPlaces);
        if (!selectedPlace) {
          routeStatusEl.textContent = "먼저 아래 목록에서 쓰레기통 하나를 선택해 주세요.";
          return;
        }

        showTargetOnMap(state, selectedPlace);
        updateListAndMarkers(state, placesByDistrict);
        const routeUrl = buildKakaoRouteUrl(selectedPlace, state.currentLocation.latLng);
        const routeWindow = window.open(routeUrl, "_blank");
        if (!routeWindow) {
          window.location.href = routeUrl;
        }
        routeStatusEl.textContent = `카카오맵 길찾기 열기: ${selectedPlace.district} ${
          selectedPlace.place || selectedPlace.address
        }`;
        statusTextEl.textContent = "Selected bin route opened.";
      }

      async function onFilterChange() {
        state.activeDistrict = districtFilterEl.value;
        state.activeType = typeFilterEl.value;
        state.activeLoadToken += 1;
        const token = state.activeLoadToken;

        clearRoute(state);
        clearAllMarkers(state);

        if (state.activeDistrict === "all") {
          statusTextEl.textContent = "Loading nearby bins...";
          locationListEl.innerHTML = '<div class="status">Loading nearby bins...</div>';

          const loadOrder =
            state.preferredDistrict && districtNames.includes(state.preferredDistrict)
              ? [
                  state.preferredDistrict,
                  ...districtNames.filter((district) => district !== state.preferredDistrict),
                ]
              : districtNames;

          await loadAllDistricts(state, placesByDistrict, (loaded, total, place) => {
            if (token !== state.activeLoadToken) return;
            const label = place?.district ? `${place.district} loading` : "Loading all";
            statusTextEl.textContent = `${label}: ${loaded}/${total}`;
            updateListAndMarkers(state, placesByDistrict);
          }, loadOrder);

          if (token !== state.activeLoadToken) return;

          updateListAndMarkers(state, placesByDistrict);
          state.map.setLevel(4);
          statusTextEl.textContent = "Showing the 5 nearest trash bins.";
          return;
        }

        statusTextEl.textContent = `${state.activeDistrict} data is loading...`;
        await loadDistrict(state, placesByDistrict, state.activeDistrict, (loaded, total, place) => {
          if (token !== state.activeLoadToken) return;
          const label = place?.district ? `${place.district} loading` : state.activeDistrict;
          statusTextEl.textContent = `${label}: ${loaded}/${total}`;
          updateListAndMarkers(state, placesByDistrict);
        });

        if (token !== state.activeLoadToken) return;

        statusTextEl.textContent = `${state.activeDistrict} ready`;
        updateListAndMarkers(state, placesByDistrict);
        await centerToDistrict(state, state.activeDistrict);
      }

      districtFilterEl.addEventListener("change", onFilterChange);
      typeFilterEl.addEventListener("change", () => {
        state.activeType = typeFilterEl.value;
        updateListAndMarkers(state, placesByDistrict);
      });
      locateBtnEl.addEventListener("click", showCurrentLocation);
      routeBtnEl.addEventListener("click", handleSelectedRoute);
      emergencyBtnEl.addEventListener("click", handleEmergency);

      statusTextEl.textContent = "Loading nearby bins...";
      emergencyStatusEl.textContent =
        "Set your current location, then use the emergency button to find the nearest bin.";
      routeStatusEl.textContent = "목록에서 쓰레기통을 선택한 뒤 길찾기를 누르세요.";
      locationListEl.innerHTML = '<div class="status">Loading the map...</div>';

      await showCurrentLocation();
    });
  } catch (error) {
    console.error("Kakao map init failed:", error);
    document.getElementById("map").innerHTML = `
      <div style="
        width:100%;
        height:100%;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:24px;
        text-align:center;
        color:#e2e8f0;
        background:
          radial-gradient(circle at top left, rgba(56, 189, 248, 0.18), transparent 28%),
          radial-gradient(circle at bottom right, rgba(34, 197, 94, 0.15), transparent 28%),
          #0f172a;
      ">
        <div style="max-width:520px;">
          <div style="font-size:20px;font-weight:800;margin-bottom:10px;">Failed to load Kakao Maps</div>
          <div style="line-height:1.6;color:#cbd5e1;">
            HTML loaded, but the map SDK is missing or the key is not configured.
            <br />
            Update <strong>config.js</strong> with <code>window.KAKAO_MAP_APP_KEY</code> and register the current site
            in the Kakao developer console's JavaScript SDK domain list.
          </div>
        </div>
      </div>
    `;
    statusTextEl.textContent = "HTML loaded. Please check the Kakao Maps settings.";
  }
}

initializeMap();
