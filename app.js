const APP_KEY = window.KAKAO_MAP_APP_KEY || "";

const rawCountEl = document.getElementById("rawCount");
const placeCountEl = document.getElementById("placeCount");
const resolvedCountEl = document.getElementById("resolvedCount");
const statusTextEl = document.getElementById("statusText");
const districtFilterEl = document.getElementById("districtFilter");
const typeFilterEl = document.getElementById("typeFilter");
const locationListEl = document.getElementById("locationList");

const typePriority = ["일반쓰레기", "재활용쓰레기", "담배꽁초 수거함"];
const colorByType = {
  "일반쓰레기": "#38bdf8",
  "재활용쓰레기": "#22c55e",
  "담배꽁초 수거함": "#fb7185",
};

const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();
const uniqueTypes = (types) =>
  [...types].sort((a, b) => typePriority.indexOf(a) - typePriority.indexOf(b));

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

const geocodeCacheKey = (query) => `kakao-geocode:${query}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    script.onerror = () => reject(new Error("카카오 SDK 로드 실패"));
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
      const infoWindow = new kakao.maps.InfoWindow({ zIndex: 10 });
      const markers = new Map();
      let resolvedCount = 0;

      const resolvePlace = async (place) => {
        for (const query of buildQueries(place)) {
          const cacheKey = geocodeCacheKey(query);
          const cached = localStorage.getItem(cacheKey);
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
            localStorage.setItem(cacheKey, JSON.stringify(result));
            return result;
          }
          await sleep(100);
        }
        return null;
      };

      const createMarker = (place) => {
        const position = new kakao.maps.LatLng(place.lat, place.lng);
        const marker = new kakao.maps.Marker({
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
      };

      const removeMarker = (key) => {
        const marker = markers.get(key);
        if (marker) {
          marker.setMap(null);
          markers.delete(key);
        }
      };

      const updateView = () => {
        const visible = grouped.filter((place) => place.status === "resolved" && matchesFilters(place));

        for (const place of grouped) {
          if (place.status === "resolved" && matchesFilters(place)) {
            if (!markers.has(place.key)) {
              createMarker(place);
            }
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
      };

      districtFilterEl.addEventListener("change", updateView);
      typeFilterEl.addEventListener("change", updateView);

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
            <strong>config.js</strong>의 <code>window.KAKAO_MAP_APP_KEY</code>를 실제 키로 바꾸면 지도가 표시됩니다.
          </div>
        </div>
      </div>
    `;
    statusTextEl.textContent = "HTML은 열렸습니다. 카카오맵 키를 넣으면 지도가 표시됩니다.";
  }
}

initializeMap();
