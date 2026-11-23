# Photos
경산목양교회 우리들의 이야기

교회 사진첩입니다. 부서 담당자가 사진을 올리면 GitHub Actions 가 흔들린 사진 등을 걸러 내고,
좋은 사진만 부서 사진첩에 바로 올라갑니다. 첫 화면 슬라이드쇼에는 전체 공개 부서의 가장 최근 앨범이 자동으로 걸리고,
매주 주일 밤 자정(월요일 0시, 한국 시간)에만 바뀝니다. 관리자(목사님)는 "메인에 걸기"로 언제든 바꿀 수 있고,
그 앨범은 다음 월요일 0시까지 걸립니다. 유초등부·중고등부는 관리자가 허락한 사람만 볼 수 있습니다.

## 화면

| 주소 | 누가 | 하는 일 |
|---|---|---|
| `/` | 누구나 | 최근 승인 앨범 슬라이드쇼, 부서 버튼, 최근 앨범 |
| `/dept.html?id=부서` | 부서 공개 설정에 따라 | 부서 앨범 목록 (비밀번호 입력, 또는 로그인 후 열람 요청) |
| `/album.html?id=앨범` | 누구나 | 사진 모아보기, 누르면 크게 보기 |
| `/upload.html` | 등록된 올리는 사람 | 앨범 만들기(이름 앞에 행사 날짜 `20261115_` 자동), 사진 올리기 |
| `/admin.html` | 관리자 | 메인에 걸기/내리기, 사진 넣고 빼기, 사진 순서·표지 정하기, 열람 요청 허락, 부서 공개 설정, 올리는 사람·관리자 등록, 원본 받기 |
| `/login.html` | 열람 요청할 사람 | 이메일 확인 번호로 로그인한 뒤 원래 화면으로 돌아감 |

## 구조

- **Cloudflare Pages**: `public/` 의 화면과 `functions/` 의 서버 기능을 보여 줍니다. GitHub `main` 에 올리면 자동 반영됩니다.
- **Cloudflare R2** (`PHOTOS`): 사진 보관. 한 장마다 세 가지를 저장합니다.
  - `orig/…` 올린 그대로의 원본 (관리자만 받을 수 있음, 인쇄용)
  - `web/…` 화면용 (긴 변 1920px)
  - `thumb/…` 목록용 (긴 변 480px)
  웹용과 목록용은 올리는 사람의 휴대폰에서 만들어 보내므로 서버에서 따로 압축하지 않습니다.
- **Cloudflare D1** (`DB`): 부서, 앨범, 사진 목록, 올리는 사람. 표 구조는 `schema.sql`.
- **로그인**: Cloudflare Access(이메일 확인 번호)로 `admin*`, `upload*`, `login*`, `api/manage/*`, `img/orig/*` 경로를 막고 (Pages 가 `.html` 을 뺀 주소로 넘기므로 별표까지),
  서버가 Access 토큰을 검증합니다. 최종 관리자는 `ADMIN_EMAILS`, 다른 관리자와 올리는 사람은 관리 화면에서 등록합니다.
- **부서 공개 설정**: 부서마다 전체 공개 / 비밀번호 / 허락받은 사람만 중 하나. 비밀번호는 맞게 입력하면 180일 동안
  그 기기에서 다시 묻지 않습니다. "허락받은 사람만"은 `/login.html` 로 로그인해 열람 요청을 보내고 관리자가 허락합니다.
  기본값은 유초등부·중고등부만 "허락받은 사람만".

## 사진 자동 선별 (GitHub Actions)

담당자가 올리기를 마치면 Cloudflare 가 `photo-qc.yml` 을 깨우고, `scripts/photo_qc.py` 가 앨범마다
흔들림, 어두움/너무 밝음, 비슷한 사진(가장 좋은 한 장만 남김), 눈 감음을 검사합니다.
걸린 사진은 "빠짐"으로 표시되어 사이트에 보이지 않고, 관리 화면에서 사진을 눌러 다시 넣을 수 있습니다.
자동으로 빠진 사진은 7일 동안 되살릴 수 있고 그 뒤 지워집니다(원본 포함). 관리자가 직접 바꾼 사진은 다시 검사해도 바뀌지 않고 지워지지도 않습니다. 검사에는 원본이 아니라 화면용 사진(위치 정보 없음)만 씁니다.

- GitHub Secrets: `SITE_URL` (사진첩 주소), `QC_TOKEN` (Cloudflare 의 `QC_TOKEN` 과 같은 값)
- Cloudflare 환경 변수: `QC_TOKEN`(비밀), `GH_DISPATCH_TOKEN`(비밀, 이 저장소 Actions 쓰기 권한만 있는 fine-grained 토큰), `GH_REPO`=`ksmych/Photos`
- 놓친 경우를 위해 6시간마다 한 번 더 확인하며, 검사할 사진이 없으면 몇 초 만에 끝납니다.
- 로컬 시험: `python scripts/photo_qc.py --local 사진폴더`

## 저장 공간 알림

관리 화면 위쪽에 R2 사용량(원본 + 화면용 + 목록용, 무료 10GB 기준)이 보이고, 8GB를 넘으면 빨간 경고가 나옵니다.
GitHub Secrets 에 `GMAIL_USER`, `GMAIL_APP_PASSWORD`(Gmail 앱 비밀번호), `ALERT_EMAIL` 을 넣으면
6시간마다 확인해서 8GB를 넘었을 때 메일도 보냅니다(일주일에 한 번까지). 없으면 메일은 건너뜁니다.

## 처음 설정 (한 번만)

1. Cloudflare 가입 후 R2 버킷 `gsmy-photos`, D1 데이터베이스 `gsmy-photos` 를 만듭니다.
2. `wrangler.toml` 의 `database_id` 를 채우고 (예전 schema.sql 로 표를 만들었다면 `migrations/` 의 파일들도 차례로 실행) `npx wrangler d1 execute gsmy-photos --remote --file=schema.sql` 로 표를 만듭니다.
3. Pages 프로젝트를 이 GitHub 저장소에 연결합니다 (빌드 명령 없음, 출력 폴더 `public`).
4. Pages 설정의 환경 변수: `ADMIN_EMAILS`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, 비밀 값 `SESSION_SECRET`(긴 임의 문자열).
   - Zero Trust 팀 도메인을 바꾸면 `ACCESS_TEAM_DOMAIN`(예: `gsmych.cloudflareaccess.com`)도 같이 바꾸고 다시 배포해야 로그인이 됩니다.
5. Zero Trust → Access 에서 위 다섯 경로를 묶은 앱을 만들고, 정책은 "이메일 확인 번호로 로그인한 누구나"로 둡니다
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
