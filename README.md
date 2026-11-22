# Photos
경산목양교회 우리들의 이야기

교회 사진첩입니다. 부서 담당자가 사진을 올리면, 관리자(목사님)가 승인한 앨범만 사이트에 보이고,
가장 최근에 승인된 앨범이 첫 화면 슬라이드쇼에 나옵니다.

## 화면

| 주소 | 누가 | 하는 일 |
|---|---|---|
| `/` | 누구나 | 최근 승인 앨범 슬라이드쇼, 부서 버튼, 최근 앨범 |
| `/dept.html?id=부서` | 누구나 (비밀번호 부서는 비밀번호 입력) | 부서 앨범 목록 |
| `/album.html?id=앨범` | 누구나 | 사진 모아보기, 누르면 크게 보기 |
| `/upload.html` | 등록된 올리는 사람 | 앨범 만들기, 사진 올리기 |
| `/admin.html` | 관리자 | 승인/반려, 사진 빼기, 올리는 사람 등록, 부서 비밀번호, 원본 받기 |

## 구조

- **Cloudflare Pages**: `public/` 의 화면과 `functions/` 의 서버 기능을 보여 줍니다. GitHub `main` 에 올리면 자동 반영됩니다.
- **Cloudflare R2** (`PHOTOS`): 사진 보관. 한 장마다 세 가지를 저장합니다.
  - `orig/…` 올린 그대로의 원본 (관리자만 받을 수 있음, 인쇄용)
  - `web/…` 화면용 (긴 변 1920px)
  - `thumb/…` 목록용 (긴 변 480px)
  웹용과 목록용은 올리는 사람의 휴대폰에서 만들어 보내므로 서버에서 따로 압축하지 않습니다.
- **Cloudflare D1** (`DB`): 부서, 앨범, 사진 목록, 올리는 사람. 표 구조는 `schema.sql`.
- **로그인**: Cloudflare Access(이메일 확인 번호)로 `/upload.html`, `/admin.html`, `/api/manage/*`, `/img/orig/*` 를 막고,
  서버가 Access 토큰을 검증합니다. 관리자는 `ADMIN_EMAILS`, 올리는 사람은 관리 화면에서 등록합니다.
- **부서 비밀번호**: 관리 화면에서 정합니다. 맞게 입력하면 180일 동안 그 기기에서 다시 묻지 않습니다.

## 처음 설정 (한 번만)

1. Cloudflare 가입 후 R2 버킷 `gsmy-photos`, D1 데이터베이스 `gsmy-photos` 를 만듭니다.
2. `wrangler.toml` 의 `database_id` 를 채우고 `npx wrangler d1 execute gsmy-photos --remote --file=schema.sql` 로 표를 만듭니다.
3. Pages 프로젝트를 이 GitHub 저장소에 연결합니다 (빌드 명령 없음, 출력 폴더 `public`).
4. Pages 설정의 환경 변수: `ADMIN_EMAILS`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, 비밀 값 `SESSION_SECRET`(긴 임의 문자열).
5. Zero Trust → Access 에서 위 네 경로를 묶은 앱을 만들고, 정책은 "이메일 확인 번호로 로그인한 누구나"로 둡니다
   (실제 권한은 사이트가 등록 명단으로 확인합니다). 앱의 AUD 값을 `ACCESS_AUD` 에 넣습니다.

## 로컬에서 시험하기

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev            # http://localhost:8788
```

로컬에서는 `.dev.vars` 의 `DEV_USER_EMAIL` 로 로그인한 것으로 봅니다 (localhost 에서만).

## 예전 사이트

`index.html`, `dept.html`, `css/`, `js/`, `photos/`, `manifest.json` 은 GitHub Pages 로 돌던 예전 사진첩입니다.
Cloudflare 로 옮기고 사진을 새 사진첩에 다시 올린 뒤 지울 예정입니다.
