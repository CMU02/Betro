# native

Expo 앱(iOS·Android). 제품 방향은 `PRODUCT.md`, 화면 시안은 Figma `Betro-App-UI`, 서버 계약은 `apps/server/README.md`가 원본이다.

## 출퇴근 화면 (MVP 2-E)

| 화면 | 경로 | 하는 일 |
|---|---|---|
| 15 내 장소 | `app/(tabs)/commute.tsx` | 장소 카드 목록, 진행 중 세션 띠(`components/commute/session-strip.tsx`), 장소 추가 |
| 16a 장소 설정 | `app/places/new.tsx`, `app/places/[placeId].tsx` | 장소 종류, 기본 경로, 대안 경로(최대 3개), 나가는 시각·요일·공휴일 |
| 16b–16d 구간 고르기 | `app/places/leg.tsx` | 수단 → 노선 → 승차 → 하차. 버스는 `/v1/ref/bus/*`, 지하철은 `/v1/ref/subway/*`(`lib/ref/ref-client.ts`) |
| 17 출퇴근 안내 | `app/commute/[placeId].tsx` | 진행 중 세션 카드, 대안 비교 줄, "안내 종료". 세션이 없으면 다음 안내 시각 |

- 화면 모델은 `lib/places/*-model.ts`, `lib/commute/guide-model.ts`에 있고, 컴포넌트는 그 결과만 그린다.
- 17과 15의 띠는 `GET /v1/commute/sessions/active`를 화면이 보일 때 15초마다 다시 부른다(`lib/commute/use-active-session.ts`).
- 같은 화면을 빠르게 두 번 여는 것을 막는 잠금은 `lib/navigation/open-lock.ts`(800ms)다.

## 저장 구조

- 장소는 기기의 `expo-sqlite/kv-store` 키 `betro.places`에 둔다(`lib/places/places.ts`, 버전 1).
  - `Place`: `id`, `kind`(home·work·school·other), `name`, `plan`(서버 계약 `CommutePlan`), `sync`(synced·pending), `updatedAt`(epoch ms), `busMeta`.
  - `pendingDeletes`: 기기에서 지웠지만 서버에서 아직 지우지 못한 planId.
- 서버에는 `plan`만 올린다. 장소 이름과 종류는 기기에만 있다(스펙 5.2).
- `busMeta`(버스 노선의 `routeType`, `region`)도 기기에만 둔다. 서버에서 가져온 장소에는 없어서 배지가 기본 색이고 "경기"·"인천" 표시가 없다.
- 잠금화면 머리줄(planId → "출근 · 회사까지" 같은 글)은 `CommuteActivity.setPlanHeaders`로 App Group에 넘긴다(`lib/places/plan-headers.ts`).

## 서버와 맞추기

`lib/places/plan-sync.ts`의 `reconcile`이 등록 뒤와 앱이 앞으로 올 때 돈다(겹쳐 돌지 않는다, `sync-flow.ts`).

1. 밀린 삭제를 보낸다.
2. `pending` 장소를 올린다. 오프라인에서 저장한 장소는 카드에 표시가 남고, 올라가면 사라진다.
3. 서버 목록을 받는다.
4. 서버에만 있는 예약을 이름 없는 기타 장소("가져온 경로")로 가져온다. 앱을 지우고 다시 깔아도 설치 식별자가 키체인에 남아 예약을 되찾는다.

## 운영 서버로 띄우기

`.env`의 `EXPO_PUBLIC_SERVER_URL`은 Metro가 번들에 넣는다. 운영 서버를 보려면 Metro를 다시 띄울 때 덮어쓴다.

```sh
EXPO_PUBLIC_SERVER_URL=https://betro.cmu02-studio.com bunx expo start --dev-client --clear
```

서버 주소가 바뀌면 앱이 설치를 그 서버에 다시 등록한다(`lib/server/register-install.ts`).
