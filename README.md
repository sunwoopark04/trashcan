# 서울 공원 쓰레기통 지도

이 프로젝트는 제공된 65개 원본 데이터를 카카오맵 위에 표시하는 정적 웹앱입니다.

## 준비

1. 카카오 디벨로퍼스에서 JavaScript 키를 발급받습니다.
2. [config.js](C:\Users\sunwo\Desktop\공원 쓰레기통\config.js)의 값을 실제 키로 바꿉니다.

```javascript
window.KAKAO_MAP_APP_KEY = "여기에_카카오_JS_키";
```

## 실행

```powershell
python -m http.server 8000
```

브라우저에서 `http://localhost:8000` 을 열면 됩니다.

Windows에서는 [start.bat](C:\Users\sunwo\Desktop\공원 쓰레기통\start.bat)을 더블클릭해도 됩니다.

## 카카오 콘솔 설정

- `키 이름`: 아무 이름이나 가능, 예: `Default JS Key`
- `JavaScript SDK 도메인`: `http://localhost:8000`
- `카카오 로그인 리다이렉트 URI`: 이 프로젝트에서는 사용하지 않으면 비워둬도 됩니다.

현재 코드는 `JavaScript 키`를 `config.js`에서 읽어서 카카오맵 SDK를 불러옵니다.

## 동작

- `data.js`에 65개 원본 데이터를 그대로 보관합니다.
- `app.js`에서 같은 장소를 하나의 마커로 묶습니다.
- 주소를 카카오맵 지오코더로 변환해서 좌표를 구합니다.
- `일반쓰레기`, `재활용쓰레기`, `담배꽁초 수거함`을 색으로 구분합니다.
- 구/수거종류 필터로 장소를 좁힐 수 있습니다.

## 참고

주소가 불완전한 일부 항목은 좌표 변환이 실패할 수 있습니다. 그런 항목은 목록에는 남지만 지도에는 표시되지 않을 수 있습니다.
