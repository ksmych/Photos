"""저장 공간이 8GB 를 넘으면 관리자에게 메일로 알립니다 (일주일에 한 번까지).

GitHub Secrets 에 GMAIL_USER, GMAIL_APP_PASSWORD, ALERT_EMAIL 이 없으면 메일은 건너뛰고
관리 화면의 빨간 경고만 보입니다. Gmail 앱 비밀번호 방식은 뉴스 자동화와 같습니다.
"""
import json
import os
import smtplib
import urllib.request
from email.message import EmailMessage


def api(method, path):
    req = urllib.request.Request(os.environ['SITE_URL'].rstrip('/') + path, method=method, headers={
        'Authorization': 'Bearer ' + os.environ['QC_TOKEN'], 'User-Agent': 'photo-qc'})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read())


def main():
    u = api('GET', '/api/qc/usage')
    gb = u['bytes'] / 1024 ** 3
    print(f"저장 공간 {gb:.2f}GB / 무료 {u['free_bytes'] / 1024 ** 3:.0f}GB, 사진 {u['photos']}장")
    if not u['send_alert']:
        return
    user, password, to = (os.environ.get(k) for k in ('GMAIL_USER', 'GMAIL_APP_PASSWORD', 'ALERT_EMAIL'))
    if not (user and password and to):
        print('메일 설정이 없어 알림 메일은 건너뜁니다 (관리 화면에는 경고가 보입니다).')
        return
    msg = EmailMessage()
    msg['Subject'] = f'[교회 사진첩] 저장 공간 {gb:.1f}GB — 무료 10GB에 가까워졌습니다'
    msg['From'] = user
    msg['To'] = to
    msg.set_content(
        f"교회 사진첩 저장 공간이 {gb:.1f}GB가 되었습니다 (사진 {u['photos']}장).\n"
        "무료 범위는 10GB이고, 넘으면 1GB당 한 달 약 20원이 청구됩니다.\n\n"
        f"관리 화면: {os.environ['SITE_URL'].rstrip('/')}/admin.html\n"
        "'원본 백업'에서 오래된 원본을 받아 두신 뒤 정리를 검토해 주세요.\n"
        "이 알림은 일주일에 한 번까지만 보냅니다.")
    with smtplib.SMTP_SSL('smtp.gmail.com', 465) as smtp:
        smtp.login(user, password)
        smtp.send_message(msg)
    api('POST', '/api/qc/usage/alerted')
    print('알림 메일을 보냈습니다.')


if __name__ == '__main__':
    main()
