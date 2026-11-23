"""사진 자동 선별 (GitHub Actions 에서 실행)

사진첩(Cloudflare)에서 검사할 앨범을 받아와, 앨범마다
  - 흔들림/초점 나감 (선명도)
  - 너무 어두움 / 너무 밝음
  - 거의 같은 사진 (연사) → 가장 좋은 한 장만 남김
  - 눈 감은 사람
을 검사하고 "추천 / 제외 추천" 결과를 사진첩에 적어 둡니다.
사진은 원본이 아니라 화면용(긴 변 1920px, 위치 정보 없음)만 받아서 씁니다.

로컬 시험:  python scripts/photo_qc.py --local 사진폴더
실제 실행:  환경 변수 SITE_URL, QC_TOKEN 이 있어야 합니다.
"""
import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

import cv2
import numpy as np

# 기준값 (실제 사진으로 써 보며 조정)
DARK_MEAN = 45            # 평균 밝기가 이보다 낮으면 어두움
BRIGHT_MEAN = 225         # 이보다 높으면 너무 밝음
CLIP_RATIO = 0.45         # 거의 검정/흰색 픽셀 비율이 이보다 많으면 노출 실패
BLUR_ABS = 60.0           # 선명도가 이보다 낮으면 무조건 흐림
BLUR_REL = 0.35           # 앨범 중간값의 35% 보다 낮으면 흐림
DUP_HAMMING = 10          # 지문(64비트) 차이가 이 이하면 거의 같은 사진
EYE_BLINK = 0.55          # 눈 감음 점수 (0~1)
FACE_MIN_WIDTH = 0.05     # 화면 폭의 5% 보다 작은 얼굴은 눈 검사에서 뺌

MODEL_URL = ('https://storage.googleapis.com/mediapipe-models/face_landmarker/'
             'face_landmarker/float16/1/face_landmarker.task')


def load_bgr(data: bytes):
    arr = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError('사진을 열 수 없습니다')
    return img


def resize_long(img, size):
    h, w = img.shape[:2]
    s = size / max(h, w)
    return cv2.resize(img, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA) if s < 1 else img


def sharpness(gray):
    """사진을 4x4 칸으로 나눠 칸마다 라플라시안 분산을 재고, 상위 칸의 값을 씁니다.
    배경이 흐린 인물 사진도 주인공이 또렷하면 높게 나옵니다."""
    lap = cv2.Laplacian(gray, cv2.CV_64F)
    h, w = gray.shape
    vals = []
    for i in range(4):
        for j in range(4):
            tile = lap[i * h // 4:(i + 1) * h // 4, j * w // 4:(j + 1) * w // 4]
            vals.append(tile.var())
    vals.sort(reverse=True)
    return float(np.mean(vals[:3]))


def exposure(gray):
    mean = float(gray.mean())
    clipped = float(((gray < 12) | (gray > 245)).mean())
    return mean, clipped


def dhash(gray):
    small = cv2.resize(gray, (9, 8), interpolation=cv2.INTER_AREA)
    bits = (small[:, 1:] > small[:, :-1]).flatten()
    return int(''.join('1' if b else '0' for b in bits), 2)


def hamming(a, b):
    return bin(a ^ b).count('1')


class EyeChecker:
    def __init__(self, model_path):
        import mediapipe as mp
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision
        self.mp = mp
        opts = vision.FaceLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(model_path)),
            output_face_blendshapes=True,
            num_faces=12,
            min_face_detection_confidence=0.5,
        )
        self.landmarker = vision.FaceLandmarker.create_from_options(opts)

    def close(self):
        self.landmarker.close()

    def check(self, bgr):
        """(얼굴 수, 눈 감은 얼굴 수) — 일정 크기 이상의 얼굴만 셉니다.
        얼굴 찾기 모델은 가까운 얼굴에 맞춰져 있어서, 사진 전체와 함께
        겹치는 반 크기 조각 9개에서도 찾아 작은 얼굴까지 잡습니다."""
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        H, W = rgb.shape[:2]
        tiles = [(0, 0, W, H)] + [
            (int(W * a), int(H * b), int(W * a + W / 2), int(H * b + H / 2))
            for a in (0, 0.25, 0.5) for b in (0, 0.25, 0.5)
        ]
        found = []  # (중심x, 중심y, 폭, 눈 감음)
        for x0, y0, x1, y1 in tiles:
            crop = np.ascontiguousarray(rgb[y0:y1, x0:x1])
            res = self.landmarker.detect(self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=crop))
            for lms, shapes in zip(res.face_landmarks, res.face_blendshapes or []):
                xs = [x0 + p.x * (x1 - x0) for p in lms]
                ys = [y0 + p.y * (y1 - y0) for p in lms]
                width = (max(xs) - min(xs)) / W
                if width < FACE_MIN_WIDTH:
                    continue
                score = {s.category_name: s.score for s in shapes}
                shut = score.get('eyeBlinkLeft', 0) > EYE_BLINK and score.get('eyeBlinkRight', 0) > EYE_BLINK
                found.append(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, width * W, shut))
        # 여러 조각에서 같은 얼굴이 잡히면 하나로 (눈 감음은 과반일 때만)
        faces = []
        for f in found:
            for g in faces:
                if abs(f[0] - g['x']) < g['w'] / 2 and abs(f[1] - g['y']) < g['w'] / 2:
                    g['votes'].append(f[3])
                    break
            else:
                faces.append({'x': f[0], 'y': f[1], 'w': f[2], 'votes': [f[3]]})
        closed = sum(1 for g in faces if sum(g['votes']) * 2 > len(g['votes']))
        return len(faces), closed


def analyze_album(items, eyes=None):
    """items: [(photo_id, jpeg_bytes)] → {photo_id: {...결과}}"""
    rows = []
    for pid, data in items:
        try:
            img = resize_long(load_bgr(data), 1280)
        except Exception as e:  # noqa: BLE001
            rows.append({'id': pid, 'error': str(e)})
            continue
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        mean, clipped = exposure(gray)
        row = {
            'id': pid,
            'sharp': sharpness(gray),
            'mean': mean,
            'clipped': clipped,
            'hash': dhash(gray),
            'faces': 0,
            'closed': 0,
        }
        if eyes is not None:
            row['faces'], row['closed'] = eyes.check(img)
        rows.append(row)

    ok_rows = [r for r in rows if 'error' not in r]
    median = float(np.median([r['sharp'] for r in ok_rows])) if ok_rows else 0.0

    for r in ok_rows:
        flags = []
        if r['sharp'] < BLUR_ABS or r['sharp'] < median * BLUR_REL:
            flags.append('blurry')
        if r['mean'] < DARK_MEAN or (r['clipped'] > CLIP_RATIO and r['mean'] < 128):
            flags.append('dark')
        if r['mean'] > BRIGHT_MEAN or (r['clipped'] > CLIP_RATIO and r['mean'] >= 128):
            flags.append('bright')
        if r['faces'] and r['closed']:
            flags.append('eyes_closed')
        r['flags'] = flags

    # 거의 같은 사진끼리 묶기 (차례대로 이어 붙이기)
    groups = []
    for r in ok_rows:
        for g in groups:
            if any(hamming(r['hash'], o['hash']) <= DUP_HAMMING for o in g):
                g.append(r)
                break
        else:
            groups.append([r])
    for g in groups:
        if len(g) < 2:
            continue
        # 문제 적은 사진 → 눈 감은 사람 적은 사진 → 더 선명한 사진 순으로 고름
        best = min(g, key=lambda o: (len(o['flags']), o['closed'], -o['sharp']))
        for o in g:
            o['group'] = best['id']
            if o is not best:
                o['flags'].append('duplicate')

    out = {}
    for r in rows:
        if 'error' in r:
            out[r['id']] = {'recommended': True, 'flags': ['error'], 'score': None, 'note': r['error']}
        else:
            out[r['id']] = {
                'recommended': not r['flags'],
                'flags': r['flags'],
                'score': round(r['sharp'], 1),
                'faces': r['faces'],
                'closed': r['closed'],
            }
    return out


def get_model():
    path = Path(os.environ.get('FACE_MODEL', Path.home() / '.cache' / 'face_landmarker.task'))
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(MODEL_URL, path)
    return path


def api(method, path, body=None, raw=False):
    url = os.environ['SITE_URL'].rstrip('/') + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        'Authorization': 'Bearer ' + os.environ['QC_TOKEN'],
        'Content-Type': 'application/json',
        'User-Agent': 'photo-qc',
    })
    with urllib.request.urlopen(req, timeout=60) as res:
        payload = res.read()
    return payload if raw else json.loads(payload)


def run_remote(eyes):
    albums = api('GET', '/api/qc/pending')['albums']
    print(f'검사할 앨범 {len(albums)}개')
    for album_id in albums:
        photos = api('GET', f'/api/qc/albums/{album_id}')['photos']
        items = [(p['id'], api('GET', f"/api/qc/photos/{p['id']}/web", raw=True)) for p in photos]
        results = analyze_album(items, eyes)
        api('POST', f'/api/qc/albums/{album_id}', {'results': results})
        kept = sum(1 for r in results.values() if r['recommended'])
        print(f'앨범 {album_id}: {len(results)}장 중 {kept}장 추천')


def run_local(folder, eyes):
    files = sorted(p for p in Path(folder).iterdir() if p.suffix.lower() in ('.jpg', '.jpeg', '.png'))
    items = []
    for p in files:
        img = resize_long(load_bgr(p.read_bytes()), 1920)  # 사진첩 화면용과 같은 크기로
        ok, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 85])
        items.append((p.name, buf.tobytes()))
    for name, r in analyze_album(items, eyes).items():
        print(name, json.dumps(r, ensure_ascii=False))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--local', help='로컬 폴더의 사진으로 시험')
    ap.add_argument('--no-eyes', action='store_true', help='눈 감음 검사 끄기')
    args = ap.parse_args()
    eyes = None if args.no_eyes else EyeChecker(get_model())
    try:
        if args.local:
            run_local(args.local, eyes)
        else:
            run_remote(eyes)
    finally:
        if eyes is not None:
            eyes.close()


if __name__ == '__main__':
    sys.exit(main())
