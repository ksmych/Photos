// 서비스 워커가 아직 준비되지 않았을 때 공유가 들어오면 올리기 화면으로 안내합니다.
export function onRequestPost() {
  return Response.redirect('/upload.html?shared=fail', 303);
}
