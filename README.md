# 햇살농원 주문·출고 관리

농산물 직거래 농가 "햇살농원"(AX Campus 해커톤 고객사 15)을 위한 주문·출고 관리 웹앱.
스마트스토어·카카오톡·전화 주문을 **주문자 전화번호** 기준으로 한곳에 모으고, **남은 수량**과 **발송 규칙(15시 마감·월~목·입금 확인)** 을 서버가 지킨다.

- **배포 주소**: https://frontend-gray-zeta-4mhqfzk9aj.vercel.app (고객 주문서: https://frontend-gray-zeta-4mhqfzk9aj.vercel.app/order)
- **API**: https://haetsal-backend.onrender.com/health (Render 무료 — 처음 접속은 30~50초 걸릴 수 있음)
- **저장소**: https://github.com/raramen98/haetsal-farm
- 문서: [요구사항 정의서](docs/요구사항정의서.md) · [기획서](docs/기획서.md) · [기능 명세서](docs/기능명세서.md) · [테스트 결과표](docs/테스트결과표.md) · [인터뷰 기록](docs/인터뷰기록.md)
- 시험 자료(가상): [스마트스토어 주문 엑셀](docs/시험자료/스마트스토어_주문_샘플.xlsx) · [카톡 주문 예시](docs/시험자료/카톡주문_예시.md)

## 구성

| 부분 | 기술 | 배포 |
|---|---|---|
| `frontend/` | Next.js 14 | Vercel |
| `backend/` | NestJS 10 + TypeORM | Render Web Service |
| DB | PostgreSQL | Render PostgreSQL |
| AI | OpenAI GPT API (카톡 주문 정리, 답장 도우미, 안내 문자 초안) | 키는 백엔드 환경 변수에만 |

역할: `admin`(정우 씨, 전체) · `packer`(어머니, 포장 목록·전화 주문) · `stock`(아버지, 판매 한도·수확량·판매 시작일). 권한은 서버 가드에서 검사한다.

## 로컬 실행

```bash
# 1) 백엔드
cd backend
cp .env.example .env      # DATABASE_URL, JWT_SECRET, OPENAI_API_KEY, SEED_PASSWORD 입력
npm install
npm run seed              # 테이블 생성 + 가상 시험 데이터 (DB를 비우고 다시 채움)
npm run dev               # http://localhost:4000
npm test                  # 규칙 단위 테스트

# 2) 프론트엔드
cd ../frontend
cp .env.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:4000
npm install
npm run dev               # http://localhost:3000
```

시드 계정: `jungwoo`(관리자) / `mom`(포장) / `dad`(재고), 비밀번호는 `SEED_PASSWORD` 값.

## 배포

1. **Render** — 저장소의 `render.yaml`(Blueprint)로 DB와 백엔드를 함께 만든다. 대시보드에서 `OPENAI_API_KEY`, `SEED_PASSWORD`, `CORS_ORIGIN`(Vercel 주소)을 입력.
2. **시드** — Render 무료 플랜은 셸이 없으므로 로컬에서 Render DB의 *External Database URL*로 실행:
   `cd backend && DATABASE_URL='<External URL>' SEED_PASSWORD='<비밀번호>' npm run seed`
3. **Vercel** — Root Directory `frontend`, 환경 변수 `NEXT_PUBLIC_API_URL` = Render 백엔드 주소.
4. 무료 Render 서버는 쉬면 잠든다 → 발표 전에 `/health`를 한 번 열어 깨운다.

> DB 주소·API 키·시드 비밀번호는 저장소와 발표 자료에 넣지 않는다. 모든 데이터는 가상이다.
