"""build_biotech_og.py — 학생 결과물 갤러리 공유 카드(OG 이미지) 생성.

카카오톡·페이스북 등에서 링크를 붙여 넣을 때 보이는 1200x630 이미지를 만든다.
OG 태그가 없으면 크롤러가 페이지의 첫 이미지(학교 로고)를 잡아 크게 잘라 보여 준다.

사용법: python scripts/build_biotech_og.py
출력:   output/web/biotech/og-biotech.jpg
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join("output", "web", "biotech", "og-biotech.jpg")
LOGO = os.path.join("output", "web", "logo.png")
W, H = 1200, 630

# 갤러리 헤더와 같은 색 (linear-gradient(135deg,#312e81,#4f46e5 58%,#0f766e))
STOPS = [(0.00, (0x31, 0x2e, 0x81)), (0.58, (0x4f, 0x46, 0xe5)), (1.00, (0x0f, 0x76, 0x6e))]

FONT_DIR = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
def font(name, size):
    for f in (name, "malgun.ttf"):
        p = os.path.join(FONT_DIR, f)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def gradient(w, h):
    """135도 대각선 그라데이션 — (x+y) 위치로 색을 보간한다."""
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(0, w, 2):                       # 2px 단위(속도)
            t = (x / w + y / h) / 2
            for i in range(len(STOPS) - 1):
                p0, c0 = STOPS[i]
                p1, c1 = STOPS[i + 1]
                if p0 <= t <= p1:
                    c = lerp(c0, c1, (t - p0) / (p1 - p0))
                    break
            else:
                c = STOPS[-1][1]
            px[x, y] = c
            if x + 1 < w:
                px[x + 1, y] = c
    return img


def spaced(draw, xy, text, fnt, fill, gap=6):
    """자간을 준 소문자 강조 문구(STUDENT PROJECT GALLERY)."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += draw.textlength(ch, font=fnt) + gap
    return x


def build():
    img = gradient(W, H)
    d = ImageDraw.Draw(img)

    # 오른쪽 아래 은은한 원 — RGB 캔버스에는 알파가 먹지 않으므로 오버레이로 합성한다
    veil = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(veil).ellipse((W - 300, H - 300, W + 240, H + 240),
                                 fill=(255, 255, 255, 20))
    ImageDraw.Draw(veil).ellipse((W - 190, H - 190, W + 150, H + 150),
                                 fill=(255, 255, 255, 18))
    img = Image.alpha_composite(img.convert("RGBA"), veil).convert("RGB")
    d = ImageDraw.Draw(img)

    x = 80
    # 학교 로고 + 사이트명
    if os.path.exists(LOGO):
        logo = Image.open(LOGO).convert("RGBA")
        lh = 62
        logo = logo.resize((int(logo.width * lh / logo.height), lh), Image.LANCZOS)
        img.paste(logo, (x, 62), logo)
        d.text((x + logo.width + 16, 78), "대륜고 사용 설명서",
               font=font("malgunbd.ttf", 30), fill=(255, 255, 255))

    # 라벨
    spaced(d, (x + 3, 196), "STUDENT PROJECT GALLERY", font("malgunbd.ttf", 24),
           (0xa7, 0xf3, 0xd0))

    # 제목 두 줄
    t = font("malgunbd.ttf", 78)
    d.text((x, 248), "AI 기반 생명공학", font=t, fill=(255, 255, 255))
    d.text((x, 344), "문제해결활동", font=t, fill=(255, 255, 255))

    # 설명
    d.text((x, 462), "1·2학년 학생이 직접 만든 11개 문제해결 프로젝트",
           font=font("malgun.ttf", 32), fill=(0xe0, 0xe7, 0xff))
    d.text((x, 516), "프로토타입을 직접 써 보고 의견을 남길 수 있습니다.",
           font=font("malgun.ttf", 27), fill=(0xc7, 0xd2, 0xfe))

    # 주소
    addr = "daeryun.life/biotech"
    f2 = font("malgunbd.ttf", 25)
    d.text((W - 80 - d.textlength(addr, font=f2), 86), addr, font=f2,
           fill=(0xc7, 0xd2, 0xfe))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.save(OUT, "JPEG", quality=88, optimize=True)
    print("생성:", OUT, "%.0f KB" % (os.path.getsize(OUT) / 1024))


if __name__ == "__main__":
    build()
