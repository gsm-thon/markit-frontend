# Maskit Front API 정합성 메모

서버 레포 `gsm-thon/markit-server`의 `main` 브랜치(`9b72cce`) 기준으로 현재 프론트에서 사용할 수 있는 API만 남겼습니다.

## 현재 서버와 맞는 API

| 상태 | Method | Endpoint | 프론트 사용 위치 |
| --- | --- | --- | --- |
| 사용 | `POST` | `/api/v1/scans` | 문서 업로드 및 즉시 분석 |
| 사용 | `PATCH` | `/api/v1/scans/{scanId}/findings/{findingId}` | 탐지 항목 수정/삭제 반영 |
| 사용 | `POST` | `/api/v1/scans/{scanId}/safe-copy` | `pdf`, `docx`, `txt` 안전 사본 다운로드 |
| 사용 | `DELETE` | `/api/v1/scans/{scanId}` | 원본 및 분석 세션 삭제 |

## 현재 서버와 맞지 않아 제거한 API 가정

| 상태 | Method | Endpoint | 제거 이유 |
| --- | --- | --- | --- |
| 제거 | `GET` | `/api/v1/scans/{scanId}` | 서버에 결과 조회 라우트가 없음. 분석 결과는 `POST /scans` 응답의 `data`를 사용해야 함 |
| 제거 | `POST` | `/api/v1/scans/{scanId}/preview` | 서버에 미리보기 라우트가 없음. 미리보기는 `extractedText`와 `findings` offset으로 프론트에서 조립 |
| 제거 | 상태 조회 계열 | `/api/v1/scans/{scanId}/status` | 서버가 동기 분석 MVP라 queued/analyzing 상태 API를 제공하지 않음 |

## 프론트 연결 방식

- API 클라이언트는 `src/api.js`에 모았습니다.
- 기본 Base URL은 `/api/v1`입니다.
- 개발 서버에서는 `vite.config.js`가 `/api/v1` 요청을 `http://localhost:3000` 백엔드로 프록시합니다.
- 현재 Vercel 배포(`https://maskit-rho.vercel.app`)에서는 `vercel.json`이 `/api/v1/*` 요청을 AWS ALB 백엔드로 rewrite합니다.
- 다른 서버 주소를 직접 쓰려면 `.env` 또는 배포 환경변수에 `VITE_API_BASE_URL=https://.../api/v1` 형식으로 지정하면 됩니다.
