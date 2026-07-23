# Maskit API 명세서 (v0.2 - 간소화)

Maskit은 로그인/회원가입 없이 사용자가 글 또는 문서를 불러와서 개인정보 보호, 블라인드 채용 기준으로 민감 문구를 점검하고 수정본을 로컬에 저장하는 서비스입니다.

## 0. v0.1 대비 변경 요약

기존 8개 엔드포인트(업로드 → 상태 폴링 → 결과조회 → 수정 → 미리보기 → 사본생성 → 다운로드 → 삭제)를 **4개**로 축소했습니다.

- 업로드와 분석을 동기(sync) 처리로 합쳐서 상태 폴링(`queued`/`analyzing`/...) 제거
- 분석 응답에 원문 텍스트(`extractedText`)를 포함시켜, 미리보기는 프론트에서 로컬로 조립 (별도 API 호출 불필요)
- 안전사본 "생성"과 "다운로드"를 하나로 합쳐 파일을 바로 스트리밍 (중간 파일을 서버에 남기지 않아 보안 요구사항에도 유리)

문서가 매우 크거나 OCR 처리가 오래 걸리는 경우에 한해, 추후 비동기 상태 조회 엔드포인트를 다시 추가할 수 있습니다. 지금은 해커톤 범위에 맞춰 최대한 단순하게 유지합니다.

## 1. 기본 정보

- Base URL: `/api/v1`
- Content-Type: `application/json`
- 파일 업로드: `multipart/form-data`
- 인증 방식: 계정 로그인 없음
- 세션 방식: 서버가 발급한 `scanId`로 단일 점검 세션을 추적
- 원본 보관 정책: 기본 24시간 이내 서버 자동 삭제 권장

## 2. 공통 응답

### 성공

```json
{
  "success": true,
  "data": {}
}
```

### 실패

```json
{
  "success": false,
  "error": {
    "code": "INVALID_FILE_TYPE",
    "message": "지원하지 않는 파일 형식입니다."
  }
}
```

## 3. 점검 모드

```ts
type ScanMode = "privacy" | "blind_hiring"
```

- `privacy`: 개인정보 보호
- `blind_hiring`: 블라인드 채용

## 4. Finding 데이터 모델

| Field | Type | Description |
| --- | --- | --- |
| findingId | string | 항목 식별자 |
| type | string | 탐지 유형 (예: `phone`, `email`, `school_name`) |
| label | string | 화면 표시용 한글 라벨 |
| originalText | string | 탐지된 원문 조각 |
| reason | string | 탐지 사유 설명 |
| severity | `low` \| `medium` \| `high` | 위험도 |
| action | `mask` \| `replace` \| `delete` \| `review` | 권장 처리 방식 |
| suggestion | string \| null | 대체 문구 추천 (있는 경우) |
| page | number | 페이지 번호 |
| startOffset / endOffset | number | `extractedText` 기준 위치 |

## 5. API 목록

### 5.1 문서 업로드 및 즉시 분석

파일을 업로드하면 서버가 텍스트를 추출하고 그 자리에서 분석까지 마쳐 결과를 반환합니다.

`POST /api/v1/scans`

Request:

```http
Content-Type: multipart/form-data
```

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| file | File | Yes | PDF, DOCX, HWPX, TXT, PNG, JPG |
| mode | string | Yes | `privacy` 또는 `blind_hiring` |
| consent | boolean | Yes | 민감정보 점검 동의 여부 |

Response:

```json
{
  "success": true,
  "data": {
    "scanId": "scan_01JZ8R7X9H2K",
    "fileName": "resume.pdf",
    "mode": "blind_hiring",
    "createdAt": "2026-07-23T13:30:00+09:00",
    "extractedText": "저는 컴퓨터공학과 관련 전공 지식을 바탕으로 한 프로젝트를 수행했습니다...",
    "summary": {
      "needsFix": 2,
      "autoMasked": 3,
      "passed": 18
    },
    "findings": [
      {
        "findingId": "finding_001",
        "type": "school_name",
        "label": "학교명",
        "originalText": "한국대학교 컴퓨터공학과",
        "reason": "블라인드 채용에서는 학교명이 평가에 영향을 줄 수 있습니다.",
        "severity": "high",
        "action": "replace",
        "suggestion": "컴퓨터공학 관련 전공",
        "page": 1,
        "startOffset": 42,
        "endOffset": 56
      }
    ]
  }
}
```

분석 실패 시 `success: false`와 `ANALYSIS_FAILED` 에러를 반환합니다(별도 상태 조회 불필요).

### 5.2 항목 수정 적용

사용자가 추천안을 승인하거나 직접 수정한 내용을 저장합니다.

`PATCH /api/v1/scans/{scanId}/findings/{findingId}`

Request:

```json
{
  "action": "replace",
  "replacementText": "컴퓨터공학 관련 전공",
  "resolved": true
}
```

Response:

```json
{
  "success": true,
  "data": {
    "findingId": "finding_001",
    "resolved": true,
    "replacementText": "컴퓨터공학 관련 전공"
  }
}
```

> 미리보기는 별도 API 없이, 프론트에서 `extractedText` + 각 finding의 offset/replacementText를 이용해 로컬에서 조립합니다.

### 5.3 안전 사본 생성 및 다운로드

현재까지 반영된 수정 내용을 적용한 파일을 즉시 스트리밍으로 내려줍니다. 서버에 별도 파일로 저장하지 않습니다.

`POST /api/v1/scans/{scanId}/safe-copy`

Request:

```json
{
  "format": "pdf"
}
```

지원 포맷: `pdf`, `docx`, `txt`

Response (성공 시 파일 스트림):

```http
Content-Type: application/pdf
Content-Disposition: attachment; filename="maskit-safe-copy.pdf"
```

실패 시에는 표준 에러 JSON(`SAFE_COPY_FAILED` 등)을 반환합니다.

### 5.4 원본 및 작업본 삭제

사용자가 원본과 분석 결과를 즉시 삭제합니다.

`DELETE /api/v1/scans/{scanId}`

Response:

```json
{
  "success": true,
  "data": {
    "scanId": "scan_01JZ8R7X9H2K",
    "deleted": true
  }
}
```

## 6. 에러 코드

| Code | HTTP | Description |
| --- | --- | --- |
| `INVALID_CONSENT` | 400 | 민감정보 점검 동의가 없음 |
| `INVALID_SCAN_MODE` | 400 | 지원하지 않는 점검 유형 |
| `INVALID_FILE_TYPE` | 400 | 지원하지 않는 파일 형식 |
| `FILE_TOO_LARGE` | 413 | 파일 용량 초과 |
| `SCAN_NOT_FOUND` | 404 | 점검 세션을 찾을 수 없음 |
| `SCAN_EXPIRED` | 410 | 점검 세션이 만료됨 |
| `ANALYSIS_FAILED` | 500 | AI/OCR 분석 실패 |
| `SAFE_COPY_FAILED` | 500 | 안전 사본 생성 실패 |

## 7. 보안 요구사항

- 파일 업로드 최대 크기 제한: 기본 20MB
- 업로드 파일 바이러스/악성 매크로 검사
- 원본 파일은 메모리 상에서만 처리 후 저장하지 않거나, 저장 시 암호화
- 안전 사본은 저장 없이 즉시 스트리밍 (5.3)
- `scanId`는 추측 불가능한 랜덤 ID 사용
- 세션 만료 후 원본, 추출 텍스트, 분석 결과 모두 삭제
- AI 제공사에 전송되는 데이터는 최소화하고 로그 저장 금지 옵션 사용

## 8. 프론트엔드 매핑

| 화면 | API |
| --- | --- |
| 문서 불러오기 + 분석 결과 확인 | `POST /scans` |
| 사전 점검 / 수정 가이드 | `POST /scans` 응답 재사용 (별도 조회 없음) |
| 수정 반영 | `PATCH /scans/{scanId}/findings/{findingId}` |
| 저장 완료 | `POST /scans/{scanId}/safe-copy` |
| 도움말 | 정적 콘텐츠 |
