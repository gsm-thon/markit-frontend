# Maskit

Maskit은 문서 안의 개인정보와 블라인드 채용 위험 문구를 탐지하고, 사용자가 확인한 수정 내용을 안전본으로 저장할 수 있는 웹 애플리케이션입니다.

로그인 없이 파일을 업로드하면 백엔드가 텍스트를 추출하고 민감 항목을 분석합니다. 프론트엔드는 분석 결과를 바탕으로 점검 요약, 발견 항목, 수정 미리보기, 로컬 TXT 저장 기능을 제공합니다.

## 주요 기능

- PDF, DOCX, TXT 문서 업로드
- 개인정보 보안 / 블라인드 채용 점검 모드 선택
- 이름, 연락처, 이메일 등 민감정보 탐지 결과 표시
- 발견 항목별 상태 구분
  - 직접 확인
  - 저장 시 가림
  - 수정 필요
  - 수정 반영됨
- 탐지 항목 페이지네이션
- 수정 문구 직접 입력 및 삭제 반영
- 수정본 미리보기
- 브라우저에서 안전본 TXT 파일 로컬 저장

## 기술 스택

- React 19
- Vite 8
- ESLint
- Vercel 배포

## 실행 방법

```bash
npm install
npm run dev
```

기본 개발 서버는 Vite 설정에 따라 실행됩니다.

## 빌드 및 검사

```bash
npm run build
npm run lint
```

## API 연결

프론트엔드는 기본적으로 같은 도메인의 `/api/v1`을 API Base URL로 사용합니다.

```js
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'
```

Vercel 배포 환경에서는 `vercel.json`의 rewrite 설정을 통해 백엔드 ALB로 프록시합니다.

```json
{
  "source": "/api/v1/:path*",
  "destination": "http://gsm-yj-alb-1671676139.us-west-1.elb.amazonaws.com/api/v1/:path*"
}
```

## 사용 API

자세한 명세는 `API_SPEC.md`를 참고합니다.

| 기능 | API |
| --- | --- |
| 문서 업로드 및 분석 | `POST /api/v1/scans` |
| 항목 수정 반영 | `PATCH /api/v1/scans/{scanId}/findings/{findingId}` |
| 작업 삭제 | `DELETE /api/v1/scans/{scanId}` |

현재 안전본 저장은 백엔드 `safe-copy` API를 사용하지 않고, 프론트에서 수정 내용을 조립해 TXT 파일로 즉시 다운로드합니다.

## 저장 방식

분석 응답의 `extractedText`와 `findings`를 프론트 상태에 보관합니다. 사용자가 수정하거나 삭제로 반영하면 해당 finding의 `replacementText`가 업데이트되고, 저장 시 브라우저에서 직접 안전본 TXT를 생성합니다.

파일명은 다음 형식으로 저장됩니다.

```text
원본파일명-safe-copy.txt
```

이 방식은 백엔드 세션 저장 상태와 무관하게 동작합니다. 다만 PDF/DOCX 원본 서식 보존 저장은 지원하지 않습니다.

## 알려진 백엔드 이슈

배포된 백엔드가 여러 인스턴스로 동작하는 상황에서 `scanId` 세션이 인스턴스 로컬 메모리에 저장되는 것으로 보입니다. 같은 `scanId`로 후속 요청을 보내도 ALB가 다른 인스턴스로 라우팅하면 `SCAN_NOT_FOUND`가 발생할 수 있습니다.

권장 해결책:

- Redis, DB, S3 등 공유 저장소에 scan 세션과 findings 저장
- 임시 완화책으로 ALB sticky session 활성화

또한 AI/NER 기반 탐지 항목은 같은 문구가 여러 번 반복되어도 첫 번째 위치만 반환되는 케이스가 확인되었습니다. 백엔드에서 NER 결과의 `originalText`를 원문 전체에 대해 재탐색해 모든 offset을 finding으로 펼치는 후처리가 필요합니다.

## 배포

프로젝트는 Vercel `maskit` 프로젝트에 연결되어 있습니다.

프로덕션 배포:

```bash
npx vercel --prod --yes
```

현재 프로덕션 URL:

```text
https://maskit-rho.vercel.app
```
