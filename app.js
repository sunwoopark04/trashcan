const APP_KEY = window.KAKAO_MAP_APP_KEY || "";

const rawCountEl = document.getElementById("rawCount");
const placeCountEl = document.getElementById("placeCount");
const resolvedCountEl = document.getElementById("resolvedCount");
const statusTextEl = document.getElementById("statusText");
const districtFilterEl = document.getElementById("districtFilter");
const typeFilterEl = document.getElementById("typeFilter");
const locationListEl = document.getElementById("locationList");
const locateBtnEl = document.getElementById("locateBtn");
const busStopInputEl = document.getElementById("busStopInput");
const routeSearchBtnEl = document.getElementById("routeSearchBtn");
const routeStatusEl = document.getElementById("routeStatus");
const routeListEl = document.getElementById("routeList");

const typePriority = ["일반쓰레기", "재활용쓰레기", "담배꽁초 수거함"];
const colorByType = {
  일반쓰레기: "#38bdf8",
  재활용쓰레기: "#22c55e",
  "담배꽁초 수거함": "#fb7185",
};

const EARTH_RADIUS_M = 6371000;
const ROUTE_API = "https://router.project-osrm.org/route/v1/walking/";

const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const uniqueTypes = (types) =>
  [...types].sort((a, b) => typePriority.indexOf(a) - typePriority.indexOf(b));

function geocodeCacheKey(query) {
  return `kakao-geocode:${query}`;
}

function districtCacheKey(district) {
  return `district-geocode:${district}`;
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
    place.types.add(row.type);
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
      reject(new Error("카카오 JavaScript 키가 설정되지 않았습니다."));
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
    script.onerror = () => reject(new Error("카카오 SDK 로드에 실패했습니다."));
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

function buildBusStopImage(kakao) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">
      <circle cx="17" cy="17" r="11" fill="#f97316" stroke="#0f172a" stroke-width="2"/>
      <rect x="12" y="10" width="10" height="14" rx="2" fill="white" opacity="0.95"/>
    </svg>
  `;
  return new kakao.maps.MarkerImage(
    `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    new kakao.maps.Size(34, 34),
    { offset: new kakao.maps.Point(17, 17) }
  );
}

function getMarkerColor(place, routeHighlightedKeys) {
  if (routeHighlightedKeys.has(place.key)) return "#fbbf24";
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
    <div class="popup-line">주소: ${place.address}</div>
    <div class="popup-line">상세: ${place.place || "-"}</div>
    <div class="popup-line">ID: ${place.ids.join(", ")}</div>
    <div class="popup-line">유형: ${uniqueTypes(place.types).join(", ")}</div>
    <div>${typeBadges}</div>
  `;
}

function renderList(items, onSelect) {
  locationListEl.innerHTML = "";
  if (!items.length) {
    locationListEl.innerHTML = '<div class="status">조건에 맞는 장소가 없습니다.</div>';
    return;
  }

  for (const item of items) {
    const node = document.createElement("div");
    node.className = "location-item";
    node.innerHTML = `
      <div class="location-title">${item.district} ${item.place || "(상세 위치 없음)"}</div>
      <div class="location-sub">${item.address}</div>
      <div class="location-sub">수거종류: ${uniqueTypes(item.types).join(", ")}</div>
      <div class="location-sub">ID: ${item.ids.join(", ")}</div>
    `;
    node.addEventListener("click", () => onSelect(item));
    locationListEl.appendChild(node);
  }
}

function renderRouteResults(results, onSelect) {
  routeListEl.innerHTML = "";
  if (!results.length) {
    routeListEl.innerHTML = '<div class="route-item">검색 결과가 없습니다.</div>';
    return;
  }

  results.forEach((item, index) => {
    const node = document.createElement("div");
    node.className = "route-item";
    node.innerHTML = `
      <div class="route-item-title">${index + 1}. ${item.place_name}</div>
      <div class="route-item-sub">${item.road_address_name || item.address_name || "-"}</div>
      <div class="route-item-sub">${item.phone || ""}</div>
    `;
    node.addEventListener("click", () => onSelect(item));
    routeListEl.appendChild(node);
  });
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
    placesService: new kakao.maps.services.Places(),
    infoWindow: new kakao.maps.InfoWindow({ zIndex: 10 }),
    markers: new Map(),
    currentLocation: { marker: null, circle: null, latLng: null },
    routeState: { polyline: null, busStopMarker: null, routeCoords: null },
    routeHighlightedKeys: new Set(),
    activeDistrict: "all",
    activeType: "all",
    activeLoadToken: 0,
    districtLoadPromises: new Map(),
    loadedDistricts: new Set(),
    resolvedPlaceCount: 0,
  };
}

function clearRoute(state) {
  state.routeHighlightedKeys = new Set();
  if (state.routeState.polyline) {
    state.routeState.polyline.setMap(null);
    state.routeState.polyline = null;
  }
  if (state.routeState.busStopMarker) {
    state.routeState.busStopMarker.setMap(null);
    state.routeState.busStopMarker = null;
  }
  state.routeState.routeCoords = null;
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

function refreshMarkerStyles(state, places) {
  for (const place of places) {
    const marker = state.markers.get(place.key);
    if (marker) {
      marker.setImage(buildMarkerImage(state.kakao, getMarkerColor(place, state.routeHighlightedKeys)));
    }
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
      image: buildMarkerImage(state.kakao, getMarkerColor(place, state.routeHighlightedKeys)),
    });
    state.kakao.maps.event.addListener(marker, "click", () => {
      state.infoWindow.setContent(
        `<div style="padding:12px 14px;min-width:240px;max-width:320px;">${popupHtml(place)}</div>`
      );
      state.infoWindow.open(state.map, marker);
    });
    state.markers.set(place.key, marker);
  } else {
    marker.setPosition(position);
    marker.setImage(buildMarkerImage(state.kakao, getMarkerColor(place, state.routeHighlightedKeys)));
    marker.setMap(state.map);
  }
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

    await sleep(60);
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

async function loadDistrict(state, placesByDistrict, district, onProgress) {
  if (!district || district === "all") return [];
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
          state.resolvedPlaceCount += 1;
        }
      }
      onProgress?.(loadedCount, places.length, place);
      await sleep(25);
    }

    state.loadedDistricts.add(district);
    return places;
  })();

  state.districtLoadPromises.set(district, promise);
  return promise;
}

function updateListAndMarkers(state, placesByDistrict) {
  const districtPlaces = placesByDistrict.get(state.activeDistrict) || [];
  const visible = districtPlaces.filter(
    (place) => place.loaded && (state.activeType === "all" || place.types.has(state.activeType))
  );

  for (const place of districtPlaces) {
    if (place.loaded && (state.activeType === "all" || place.types.has(state.activeType))) {
      createOrUpdateMarker(state, place);
    } else {
      removeMarker(state, place.key);
    }
  }

  renderList(visible, (place) => {
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

  refreshMarkerStyles(state, districtPlaces);
}

function projectToMeters(lat, lng, originLat) {
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;
  const originLatRad = (originLat * Math.PI) / 180;
  return {
    x: EARTH_RADIUS_M * lngRad * Math.cos(originLatRad),
    y: EARTH_RADIUS_M * latRad,
  };
}

function distancePointToSegmentMeters(point, start, end, originLat) {
  const p = projectToMeters(point.lat, point.lng, originLat);
  const a = projectToMeters(start.lat, start.lng, originLat);
  const b = projectToMeters(end.lat, end.lng, originLat);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  const nearestX = a.x + t * dx;
  const nearestY = a.y + t * dy;
  return Math.hypot(p.x - nearestX, p.y - nearestY);
}

function isPlaceNearRoute(place, routeCoords, thresholdMeters = 120) {
  if (!place.lat || !place.lng || !Array.isArray(routeCoords) || routeCoords.length < 2) {
    return false;
  }

  const originLat = routeCoords[0][1];
  const point = { lat: place.lat, lng: place.lng };

  for (let i = 0; i < routeCoords.length - 1; i += 1) {
    const start = { lng: routeCoords[i][0], lat: routeCoords[i][1] };
    const end = { lng: routeCoords[i + 1][0], lat: routeCoords[i + 1][1] };
    if (distancePointToSegmentMeters(point, start, end, originLat) <= thresholdMeters) {
      return true;
    }
  }

  return false;
}

function highlightRouteBins(state, placesByDistrict, routeCoords) {
  const districtPlaces = placesByDistrict.get(state.activeDistrict) || [];
  state.routeHighlightedKeys = new Set(
    districtPlaces.filter((place) => place.loaded && isPlaceNearRoute(place, routeCoords)).map((place) => place.key)
  );
  refreshMarkerStyles(state, districtPlaces);
}

function drawRouteOnMap(state, routeCoords, stopResult) {
  clearRoute(state);

  const path = routeCoords.map(([lng, lat]) => new state.kakao.maps.LatLng(lat, lng));
  state.routeState.routeCoords = routeCoords;
  state.routeState.polyline = new state.kakao.maps.Polyline({
    map: state.map,
    path,
    strokeWeight: 5,
    strokeColor: "#fbbf24",
    strokeOpacity: 0.9,
    strokeStyle: "solid",
  });

  const stopPosition = new state.kakao.maps.LatLng(Number(stopResult.y), Number(stopResult.x));
  state.routeState.busStopMarker = new state.kakao.maps.Marker({
    map: state.map,
    position: stopPosition,
    image: buildBusStopImage(state.kakao),
    title: stopResult.place_name,
  });

  const bounds = new state.kakao.maps.LatLngBounds();
  path.forEach((latLng) => bounds.extend(latLng));
  if (state.currentLocation.latLng) bounds.extend(state.currentLocation.latLng);
  bounds.extend(stopPosition);
  state.map.setBounds(bounds);
}

async function fetchRoutePath(startLatLng, endLatLng) {
  const url =
    `${ROUTE_API}${startLatLng.getLng()},${startLatLng.getLat()};${endLatLng.getLng()},${endLatLng.getLat()}` +
    "?overview=full&geometries=geojson";
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`route fetch failed: ${response.status}`);
  }

  const json = await response.json();
  const coords = json.routes?.[0]?.geometry?.coordinates;
  if (!coords || !coords.length) {
    throw new Error("route geometry missing");
  }
  return coords;
}

function clearCurrentLocation(state) {
  if (state.currentLocation.marker) {
    state.currentLocation.marker.setMap(null);
    state.currentLocation.marker = null;
  }
  if (state.currentLocation.circle) {
    state.currentLocation.circle.setMap(null);
    state.currentLocation.circle = null;
  }
  state.currentLocation.latLng = null;
}

async function initializeMap() {
  try {
    const kakao = await loadKakaoSdk();

    kakao.maps.load(async () => {
      const state = createMapState(kakao);
      const groupedPlaces = groupRawRows(trashBins);
      const placesByDistrict = buildDistrictMap(groupedPlaces);

      rawCountEl.textContent = String(trashBins.length);
      placeCountEl.textContent = String(groupedPlaces.length);
      resolvedCountEl.textContent = "0";

      for (const district of [...placesByDistrict.keys()].sort((a, b) => a.localeCompare(b, "ko"))) {
        const option = document.createElement("option");
        option.value = district;
        option.textContent = district;
        districtFilterEl.appendChild(option);
      }

      async function showCurrentLocation() {
        if (!navigator.geolocation) {
          statusTextEl.textContent = "이 브라우저는 현재 위치 기능을 지원하지 않습니다.";
          return;
        }

        locateBtnEl.disabled = true;
        statusTextEl.textContent = "현재 위치를 찾는 중...";

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

            statusTextEl.textContent = "현재 위치를 찾았습니다.";
            routeStatusEl.textContent = "현재 위치가 설정되었습니다. 구를 선택한 뒤 버스정류장을 검색해 보세요.";
            locateBtnEl.disabled = false;
          },
          (error) => {
            statusTextEl.textContent = `현재 위치를 가져오지 못했습니다: ${error.message}`;
            locateBtnEl.disabled = false;
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 30000,
          }
        );
      }

      async function routeToBusStop(stopResult) {
        if (!state.currentLocation.latLng) {
          routeStatusEl.textContent = "먼저 현재 위치를 잡아주세요.";
          return;
        }

        if (state.activeDistrict === "all") {
          routeStatusEl.textContent = "구를 선택해야 경로 위 쓰레기통을 계산할 수 있습니다.";
          return;
        }

        routeSearchBtnEl.disabled = true;
        routeStatusEl.textContent = `${stopResult.place_name}까지 경로를 계산하는 중...`;

        try {
          const routeCoords = await fetchRoutePath(
            state.currentLocation.latLng,
            new state.kakao.maps.LatLng(Number(stopResult.y), Number(stopResult.x))
          );
          drawRouteOnMap(state, routeCoords, stopResult);
          highlightRouteBins(state, placesByDistrict, routeCoords);
          routeStatusEl.textContent = `경로 위 쓰레기통 ${state.routeHighlightedKeys.size}개를 표시했습니다.`;
        } catch (error) {
          clearRoute(state);
          const start = state.currentLocation.latLng;
          const end = new state.kakao.maps.LatLng(Number(stopResult.y), Number(stopResult.x));
          const fallbackCoords = [
            [start.getLng(), start.getLat()],
            [end.getLng(), end.getLat()],
          ];

          state.routeState.polyline = new state.kakao.maps.Polyline({
            map: state.map,
            path: [start, end],
            strokeWeight: 5,
            strokeColor: "#fbbf24",
            strokeOpacity: 0.7,
            strokeStyle: "solid",
          });
          state.routeState.busStopMarker = new state.kakao.maps.Marker({
            map: state.map,
            position: end,
            image: buildBusStopImage(state.kakao),
            title: stopResult.place_name,
          });

          highlightRouteBins(state, placesByDistrict, fallbackCoords);
          routeStatusEl.textContent = `경로 API를 불러오지 못해 직선으로 표시했습니다. 경로 위 쓰레기통 ${state.routeHighlightedKeys.size}개를 표시했습니다.`;
        } finally {
          routeSearchBtnEl.disabled = false;
        }
      }

      async function searchBusStops() {
        if (!state.currentLocation.latLng) {
          routeStatusEl.textContent = "먼저 현재 위치를 잡아주세요.";
          return;
        }

        if (state.activeDistrict === "all") {
          routeStatusEl.textContent = "구를 선택해야 버스정류장을 검색하고 경로를 계산할 수 있습니다.";
          return;
        }

        routeSearchBtnEl.disabled = true;
        routeStatusEl.textContent = "버스정류장을 검색하는 중...";

        const keyword = normalize(busStopInputEl.value) || "버스정류장";
        const searchPlaces = (query) =>
          new Promise((resolve) => {
            state.placesService.keywordSearch(
              query,
              (result, status) => {
                if (status === state.kakao.maps.services.Status.OK) {
                  resolve(result);
                } else {
                  resolve([]);
                }
              },
              {
                location: state.currentLocation.latLng,
                radius: 5000,
                sort: state.kakao.maps.services.SortBy.DISTANCE,
                size: 10,
              }
            );
          });

        let results = await searchPlaces(keyword);
        if (!results.length && !/버스|정류/i.test(keyword)) {
          results = await searchPlaces(`${keyword} 버스정류장`);
        }

        renderRouteResults(results, (item) => {
          routeToBusStop(item).catch((error) => {
            routeStatusEl.textContent = `경로 표시 중 오류가 발생했습니다: ${error.message}`;
          });
        });

        if (!results.length) {
          routeStatusEl.textContent = "검색 결과가 없습니다. 다른 이름으로 다시 시도해 주세요.";
          routeSearchBtnEl.disabled = false;
          return;
        }

        routeStatusEl.textContent = `버스정류장 ${results.length}개를 찾았습니다. 첫 번째 결과로 경로를 표시합니다.`;
        await routeToBusStop(results[0]);
      }

      async function onFilterChange() {
        state.activeDistrict = districtFilterEl.value;
        state.activeType = typeFilterEl.value;
        state.activeLoadToken += 1;
        const token = state.activeLoadToken;

        clearRoute(state);
        routeListEl.innerHTML = "";

        if (state.activeDistrict === "all") {
          clearAllMarkers(state);
          locationListEl.innerHTML = '<div class="status">구를 선택하면 해당 구의 쓰레기통이 표시됩니다.</div>';
          statusTextEl.textContent = "구를 선택해 주세요.";
          routeStatusEl.textContent = "현재 위치를 잡은 뒤 구를 선택하면 버스정류장 경로를 찾을 수 있습니다.";
          return;
        }

        clearAllMarkers(state);
        routeStatusEl.textContent = `${state.activeDistrict} 데이터를 불러오는 중...`;
        statusTextEl.textContent = `${state.activeDistrict} 좌표를 불러오는 중...`;

        await loadDistrict(state, placesByDistrict, state.activeDistrict, (loaded, total) => {
          if (token !== state.activeLoadToken) return;
          const percent = total ? Math.round((loaded / total) * 100) : 0;
          statusTextEl.textContent = `${state.activeDistrict} 로딩 중: ${loaded}/${total} (${percent}%)`;
          resolvedCountEl.textContent = String(state.resolvedPlaceCount);
        });

        if (token !== state.activeLoadToken) return;

        statusTextEl.textContent = `${state.activeDistrict} 표시 준비 완료`;
        routeStatusEl.textContent = "버스정류장 검색도 가능합니다.";
        updateListAndMarkers(state, placesByDistrict);
        await centerToDistrict(state, state.activeDistrict);
      }

      districtFilterEl.addEventListener("change", onFilterChange);
      typeFilterEl.addEventListener("change", () => {
        state.activeType = typeFilterEl.value;
        if (state.activeDistrict !== "all") {
          updateListAndMarkers(state, placesByDistrict);
        }
      });
      locateBtnEl.addEventListener("click", showCurrentLocation);
      routeSearchBtnEl.addEventListener("click", searchBusStops);
      busStopInputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          searchBusStops();
        }
      });

      statusTextEl.textContent = "구를 선택하면 해당 구의 쓰레기통이 표시됩니다.";
      routeStatusEl.textContent = "현재 위치를 잡고 구를 선택한 뒤 버스정류장을 검색해 보세요.";
      locationListEl.innerHTML = '<div class="status">구를 선택하면 목록이 표시됩니다.</div>';

      await onFilterChange();
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
          <div style="font-size:20px;font-weight:800;margin-bottom:10px;">카카오맵을 불러오지 못했습니다</div>
          <div style="line-height:1.6;color:#cbd5e1;">
            HTML은 열렸지만 지도 SDK가 없거나 키가 설정되지 않았습니다.
            <br />
            <strong>config.js</strong>의 <code>window.KAKAO_MAP_APP_KEY</code>를 실제 키로 바꾸고,
            카카오 개발자 콘솔의 JavaScript SDK 도메인에 현재 주소를 등록해 주세요.
          </div>
        </div>
      </div>
    `;
    statusTextEl.textContent = "HTML은 열렸습니다. 카카오맵 설정을 확인해 주세요.";
  }
}

initializeMap();
