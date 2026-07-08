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
  "일반쓰레기": "#38bdf8",
  "재활용쓰레기": "#22c55e",
  "담배꽁초 수거함": "#fb7185",
};

const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();
const uniqueTypes = (types) =>
  [...types].sort((a, b) => typePriority.indexOf(a) - typePriority.indexOf(b));

const EARTH_RADIUS_M = 6371000;
const ROUTE_API = "https://router.project-osrm.org/route/v1/walking/";
const DISTRICT_GEOCODE_PREFIX = "district-geocode:";
let routeHighlightedKeys = new Set();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

const grouped = Object.values(
  trashBins.reduce((acc, row) => {
    const key = [row.district, normalize(row.address), normalize(row.place || "-")].join("|");
    if (!acc[key]) {
      acc[key] = {
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
        status: "pending",
      };
    }
    acc[key].ids.push(row.id);
    acc[key].types.add(row.type);
    acc[key].rows.push(row);
    return acc;
  }, {})
).sort((a, b) =>
  `${a.district}${a.address}${a.place}`.localeCompare(`${b.district}${b.address}${b.place}`, "ko")
);

rawCountEl.textContent = String(trashBins.length);
placeCountEl.textContent = String(grouped.length);

for (const district of [...new Set(trashBins.map((row) => row.district))].sort((a, b) =>
  a.localeCompare(b, "ko")
)) {
  const option = document.createElement("option");
  option.value = district;
  option.textContent = district;
  districtFilterEl.appendChild(option);
}

function geocodeCacheKey(query) {
  return `kakao-geocode:${query}`;
}

function districtCacheKey(district) {
  return `${DISTRICT_GEOCODE_PREFIX}${district}`;
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

function getMarkerColor(place) {
  if (routeHighlightedKeys.has(place.key)) return "#fbbf24";
  const types = [...place.types];
  if (types.includes("담배꽁초 수거함")) return colorByType["담배꽁초 수거함"];
  if (types.includes("재활용쓰레기") && types.includes("일반쓰레기")) return "#14b8a6";
  if (types.includes("재활용쓰레기")) return colorByType["재활용쓰레기"];
  return colorByType["일반쓰레기"];
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

function matchesFilters(place) {
  const districtValue = districtFilterEl.value;
  const typeValue = typeFilterEl.value;
  const types = [...place.types];
  return (
    (districtValue === "all" || place.district === districtValue) &&
    (typeValue === "all" || types.includes(typeValue))
  );
}

function loadKakaoSdk() {
  return new Promise((resolve, reject) => {
    if (!APP_KEY || APP_KEY === "YOUR_KAKAO_JS_KEY") {
      reject(new Error("카카오 JavaScript 키가 없습니다."));
      return;
    }

    if (window.kakao && window.kakao.maps) {
      resolve(window.kakao);
      return;
    }

    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(APP_KEY)}&libraries=services&autoload=false`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.kakao);
    script.onerror = () =>
      reject(new Error("카카오 SDK 로드 실패. JavaScript SDK 도메인과 키를 확인하세요."));
    document.head.appendChild(script);
  });
}

async function initializeMap() {
  try {
    const kakao = await loadKakaoSdk();

    kakao.maps.load(async () => {
      const mapContainer = document.getElementById("map");
      const map = new kakao.maps.Map(mapContainer, {
        center: new kakao.maps.LatLng(37.5665, 126.978),
        level: 8,
      });
      const geocoder = new kakao.maps.services.Geocoder();
      const placesService = new kakao.maps.services.Places();
      const infoWindow = new kakao.maps.InfoWindow({ zIndex: 10 });
      const markers = new Map();
      const currentLocation = {
        marker: null,
        circle: null,
        latLng: null,
      };
      const routeState = {
        polyline: null,
        busStopMarker: null,
        routeCoords: null,
      };

      let resolvedCount = 0;
      let busStopResults = [];

      function clearRoute() {
        routeHighlightedKeys = new Set();
        routeState.routeCoords = null;
        if (routeState.polyline) {
          routeState.polyline.setMap(null);
          routeState.polyline = null;
        }
        if (routeState.busStopMarker) {
          routeState.busStopMarker.setMap(null);
          routeState.busStopMarker = null;
        }
      }

      function refreshMarkerStyles() {
        for (const place of grouped) {
          const marker = markers.get(place.key);
          if (marker && place.status === "resolved") {
            marker.setImage(buildMarkerImage(kakao, getMarkerColor(place)));
          }
        }
      }

      function createOrUpdateMarker(place) {
        if (!place.lat || !place.lng || place.status !== "resolved") {
          return;
        }
        const position = new kakao.maps.LatLng(place.lat, place.lng);
        let marker = markers.get(place.key);
        if (!marker) {
          marker = new kakao.maps.Marker({
            map,
            position,
            image: buildMarkerImage(kakao, getMarkerColor(place)),
          });
          kakao.maps.event.addListener(marker, "click", () => {
            infoWindow.setContent(
              `<div style="padding:12px 14px;min-width:240px;max-width:320px;">${popupHtml(place)}</div>`
            );
            infoWindow.open(map, marker);
          });
          markers.set(place.key, marker);
        } else {
          marker.setPosition(position);
          marker.setImage(buildMarkerImage(kakao, getMarkerColor(place)));
          marker.setMap(map);
        }
      }

      function removeMarker(key) {
        const marker = markers.get(key);
        if (marker) {
          marker.setMap(null);
          markers.delete(key);
        }
      }

      async function centerToDistrict(district) {
        if (!district || district === "all") {
          return;
        }
        const cached = localStorage.getItem(districtCacheKey(district));
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed) {
            map.setCenter(new kakao.maps.LatLng(parsed.lat, parsed.lng));
            map.setLevel(6);
            return;
          }
        }
        const result = await new Promise((resolve) => {
          geocoder.addressSearch(`서울특별시 ${district}`, (data, status) => {
            if (status === kakao.maps.services.Status.OK && data && data.length) {
              resolve({
                lat: Number(data[0].y),
                lng: Number(data[0].x),
              });
            } else {
              resolve(null);
            }
          });
        });
        if (result) {
          localStorage.setItem(districtCacheKey(district), JSON.stringify(result));
          map.setCenter(new kakao.maps.LatLng(result.lat, result.lng));
          map.setLevel(6);
        }
      }

      function updateView() {
        const visible = grouped.filter((place) => place.status === "resolved" && matchesFilters(place));

        for (const place of grouped) {
          if (place.status === "resolved" && matchesFilters(place)) {
            createOrUpdateMarker(place);
          } else {
            removeMarker(place.key);
          }
        }

        renderList(visible, (place) => {
          if (!place.lat || !place.lng) return;
          map.setCenter(new kakao.maps.LatLng(place.lat, place.lng));
          map.setLevel(4);
          const marker = markers.get(place.key);
          if (marker) {
            infoWindow.setContent(
              `<div style="padding:12px 14px;min-width:240px;max-width:320px;">${popupHtml(place)}</div>`
            );
            infoWindow.open(map, marker);
          }
        });

        refreshMarkerStyles();

        const selectedDistrict = districtFilterEl.value;
        if (selectedDistrict !== "all") {
          if (visible.length > 0) {
            map.setCenter(new kakao.maps.LatLng(visible[0].lat, visible[0].lng));
            map.setLevel(6);
          } else {
            centerToDistrict(selectedDistrict);
          }
        }
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
            const currentPosition = new kakao.maps.LatLng(lat, lng);
            currentLocation.latLng = currentPosition;

            map.setCenter(currentPosition);
            map.setLevel(4);

            if (currentLocation.marker) currentLocation.marker.setMap(null);
            if (currentLocation.circle) currentLocation.circle.setMap(null);

            currentLocation.marker = new kakao.maps.Marker({
              map,
              position: currentPosition,
            });
            currentLocation.circle = new kakao.maps.Circle({
              map,
              center: currentPosition,
              radius: position.coords.accuracy,
              strokeWeight: 2,
              strokeColor: "#38bdf8",
              strokeOpacity: 0.8,
              fillColor: "#38bdf8",
              fillOpacity: 0.2,
            });

            statusTextEl.textContent = "현재 위치로 이동했습니다.";
            routeStatusEl.textContent = "현재 위치가 잡혔습니다. 버스정류소를 검색해보세요.";
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

      async function resolvePlace(place) {
        for (const query of buildQueries(place)) {
          const cached = localStorage.getItem(geocodeCacheKey(query));
          if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed) return parsed;
          }

          const result = await new Promise((resolve) => {
            geocoder.addressSearch(query, (data, status) => {
              if (status === kakao.maps.services.Status.OK && data && data.length) {
                resolve({
                  lat: Number(data[0].y),
                  lng: Number(data[0].x),
                });
              } else {
                resolve(null);
              }
            });
          });

          if (result) {
            localStorage.setItem(geocodeCacheKey(query), JSON.stringify(result));
            return result;
          }
          await sleep(100);
        }
        return null;
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

      function drawRouteOnMap(routeCoords, stopResult) {
        clearRoute();

        const path = routeCoords.map(([lng, lat]) => new kakao.maps.LatLng(lat, lng));
        routeState.routeCoords = routeCoords;

        routeState.polyline = new kakao.maps.Polyline({
          map,
          path,
          strokeWeight: 5,
          strokeColor: "#fbbf24",
          strokeOpacity: 0.9,
          strokeStyle: "solid",
        });

        const stopPosition = new kakao.maps.LatLng(Number(stopResult.y), Number(stopResult.x));
        routeState.busStopMarker = new kakao.maps.Marker({
          map,
          position: stopPosition,
          image: buildBusStopImage(kakao),
          title: stopResult.place_name,
        });

        const bounds = new kakao.maps.LatLngBounds();
        path.forEach((latLng) => bounds.extend(latLng));
        bounds.extend(currentLocation.latLng);
        bounds.extend(stopPosition);
        map.setBounds(bounds);

        routeHighlightedKeys = new Set(
          grouped.filter((place) => place.status === "resolved" && isPlaceNearRoute(place, routeCoords)).map((place) => place.key)
        );

        routeStatusEl.textContent = `경로 위 쓰레기통 ${routeHighlightedKeys.size}개를 표시했습니다.`;
        refreshMarkerStyles();
        updateView();
      }

      async function routeToBusStop(stopResult) {
        if (!currentLocation.latLng) {
          routeStatusEl.textContent = "먼저 현재 위치를 잡아주세요.";
          return;
        }

        routeSearchBtnEl.disabled = true;
        routeStatusEl.textContent = `${stopResult.place_name}까지 경로를 계산 중...`;

        try {
          const routeCoords = await fetchRoutePath(currentLocation.latLng, new kakao.maps.LatLng(Number(stopResult.y), Number(stopResult.x)));
          drawRouteOnMap(routeCoords, stopResult);
          busStopInputEl.value = stopResult.place_name;
        } catch (error) {
          clearRoute();
          const start = currentLocation.latLng;
          const end = new kakao.maps.LatLng(Number(stopResult.y), Number(stopResult.x));
          const fallbackCoords = [
            [start.getLng(), start.getLat()],
            [end.getLng(), end.getLat()],
          ];
          routeState.polyline = new kakao.maps.Polyline({
            map,
            path: [start, end],
            strokeWeight: 5,
            strokeColor: "#fbbf24",
            strokeOpacity: 0.7,
            strokeStyle: "solid",
          });
          routeState.busStopMarker = new kakao.maps.Marker({
            map,
            position: end,
            image: buildBusStopImage(kakao),
            title: stopResult.place_name,
          });
          routeHighlightedKeys = new Set(
            grouped
              .filter((place) => place.status === "resolved" && isPlaceNearRoute(place, fallbackCoords))
              .map((place) => place.key)
          );
          routeStatusEl.textContent = `경로 API를 불러오지 못해 직선으로 표시했습니다. 경로 위 쓰레기통 ${routeHighlightedKeys.size}개를 표시했습니다.`;
          refreshMarkerStyles();
          updateView();
        } finally {
          routeSearchBtnEl.disabled = false;
        }
      }

      async function searchBusStops() {
        if (!currentLocation.latLng) {
          routeStatusEl.textContent = "현재 위치를 먼저 잡아주세요.";
          return;
        }

        const rawQuery = normalize(busStopInputEl.value);
        const query = rawQuery || "버스정류장";
        routeSearchBtnEl.disabled = true;
        routeStatusEl.textContent = "버스정류소를 검색하는 중...";

        const searchPlaces = (keyword) =>
          new Promise((resolve) => {
            placesService.keywordSearch(
              keyword,
              (result, status) => {
                if (status === kakao.maps.services.Status.OK) {
                  resolve(result);
                } else {
                  resolve([]);
                }
              },
              {
                location: currentLocation.latLng,
                radius: 5000,
                sort: kakao.maps.services.SortBy.DISTANCE,
                size: 10,
              }
            );
          });

        let results = await searchPlaces(query);
        if (!results.length && !/버스|정류/i.test(query)) {
          results = await searchPlaces(`${query} 버스정류장`);
        }

        busStopResults = results;
        renderRouteResults(results, (item) => {
          routeToBusStop(item).catch((error) => {
            routeStatusEl.textContent = `경로 표시 중 오류가 발생했습니다: ${error.message}`;
          });
        });

        if (!results.length) {
          routeStatusEl.textContent = "검색 결과가 없습니다. 다른 이름으로 다시 시도해보세요.";
          routeSearchBtnEl.disabled = false;
          return;
        }

        routeStatusEl.textContent = `버스정류소 ${results.length}개를 찾았습니다. 첫 번째 결과로 경로를 표시합니다.`;
        await routeToBusStop(results[0]);
      }

      districtFilterEl.addEventListener("change", updateView);
      typeFilterEl.addEventListener("change", updateView);
      locateBtnEl.addEventListener("click", showCurrentLocation);
      routeSearchBtnEl.addEventListener("click", searchBusStops);
      busStopInputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          searchBusStops();
        }
      });

      statusTextEl.textContent = "카카오맵 지도를 불러왔습니다. 좌표 변환을 시작합니다.";

      for (const place of grouped) {
        const coords = await resolvePlace(place);
        if (coords) {
          place.lat = coords.lat;
          place.lng = coords.lng;
          place.status = "resolved";
          resolvedCount += 1;
        } else {
          place.status = "failed";
        }
        resolvedCountEl.textContent = String(resolvedCount);
        statusTextEl.textContent = `좌표 변환 진행 중: ${resolvedCount}/${grouped.length}`;
        updateView();
        await sleep(120);
      }

      statusTextEl.textContent = `완료: ${resolvedCount}개 장소를 지도에 표시했습니다.`;
      updateView();
    });
  } catch (error) {
    console.error("Kakao map init failed:", error);
    const mapContainer = document.getElementById("map");
    mapContainer.innerHTML = `
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
            JavaScript SDK 도메인에 <code>https://trashcan-pi.vercel.app</code>를 넣어주세요.
          </div>
        </div>
      </div>
    `;
    statusTextEl.textContent = "HTML은 열렸습니다. 카카오맵 키와 도메인 설정을 확인해 주세요.";
  }
}

initializeMap();
