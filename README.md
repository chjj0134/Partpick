# PartPick

## 실행 방법

`start.bat` 파일을 실행한 뒤 브라우저에서 `http://localhost:3000`을 열면 됩니다.

## 구성

- `index.html`: 화면 구조
- `styles.css`: UI 스타일
- `app.js`: 백엔드 API 호출 및 화면 렌더링
- `server.js`: Node.js 백엔드 서버
- `crawler.js`: 다나와, 컴퓨존, 가이드컴, 바이트몰, 아이코다 가격 수집 모듈
- `data.json`: GPU, RAM 스펙 추론용 카탈로그
- `watchlist.json`: 사용자가 담은 관심상품 및 가격 기록
- `start.bat`: 서버 실행 파일

## 기능

- 다나와, 컴퓨존, 가이드컴, 바이트몰, 아이코다 실시간 가격 후보 수집
- 수집 결과 관심상품 저장
- 관심상품 기반 가격 추이 표시
- 대시보드 관심상품 4개 요약
- 예산, 사용 목적, 메인보드 메모리 규격, 파워 용량, 케이스 길이를 함께 고려한 호환 대체재 추천
- OpenAI Responses API 기반 생성형 AI 분석 리포트


## API

- `GET /api/watchlist`
- `POST /api/watchlist`
- `DELETE /api/watchlist?id=상품ID`
- `GET /api/recommendations?budget=900000&purpose=gaming&memoryType=DDR5&psu=600&caseLength=300`
- `GET /api/report`
- `GET /api/crawl?query=RTX%205070&sources=danawa,compuzone,guidecom,bytemall,icoda`
