# 슥터디 (sgtudy)

스터디 그룹 목표·일정 관리 웹. 현재는 목업 데이터 기반 프론트엔드.

- 프로덕션: https://sgtudy.vercel.app
- 디자인 스펙: `docs/claude-design-prompt.md`, 화면별 구현 스펙 `docs/specs/*.md`

## 개발

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # 프로덕션 빌드 (배포 전 통과 확인)
npm run lint
```

## 화면 ↔ 라우트

| 화면 | 라우트 | 담당 폴더 |
|---|---|---|
| 방 목록 | `/` | `src/components/main`, `src/data/rooms.ts` |
| 방 상세 (둘러보기) | `/rooms/[id]` | `src/components/room-view`, `src/data/room-view.ts` |
| 내 스터디 | `/my-study/[id]` | `src/components/my-study`, `src/data/my-study.ts` |
| 내 일정 | `/schedule` | `src/components/schedule`, `src/data/schedule.ts` |

공용: `src/components/ui`(헤더·아바타·상태아이콘), `src/lib`(routes·palette·date·types).

## 배포 (Vercel)

- GitHub `picpal/sgtudy` 가 Vercel 프로젝트 `sgtudy` 에 연결돼 있음.
- `main` push → 프로덕션 자동 배포. 다른 브랜치/PR → 프리뷰 URL 자동 생성.
- 수동 배포: `vercel --prod` (로그인 필요).

## 백엔드 연결 준비

- `.env.example` 의 `NEXT_PUBLIC_API_URL` 을 `.env.local` 로 복사해 사용. Vercel 에는 Settings → Environment Variables 에 등록.
- 목업 데이터는 `src/data/*.ts` 에 화면별로 분리돼 있어, API 클라이언트로 교체할 때 이 파일들의 export 시그니처만 유지하면 화면 코드는 그대로 둘 수 있다.
- "오늘" 기준일은 `src/lib/routes.ts` 의 `TODAY` 상수 (목업 기준 2026-10-12). 실데이터 전환 시 현재 날짜로 교체.
