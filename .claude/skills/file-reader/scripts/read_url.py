"""read_url.py — URL에서 웹페이지 텍스트 추출 (내장 모듈만 사용)

사용법:
  python read_url.py <URL>

출력:
  - stdout: 추출된 텍스트 (제목 + 본문)
  - stderr: 오류 메시지 (exit code 1)
"""
import sys
import re
import gzip
import zlib
import urllib.request
import urllib.error
from html.parser import HTMLParser


# 본문 추출 시 무시할 태그
_SKIP_TAGS = {"script", "style", "noscript", "nav", "footer", "header",
               "aside", "advertisement", "iframe", "svg", "button", "select"}

# 블록 단위 개행이 필요한 태그
_BLOCK_TAGS = {"p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6",
               "tr", "td", "th", "section", "article", "br", "hr",
               "dt", "dd", "blockquote", "pre"}


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.texts = []
        self._skip_depth = 0
        self._current_tag = ""
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        tag_lower = tag.lower()
        self._current_tag = tag_lower

        if self._skip_depth > 0:
            self._skip_depth += 1
            return
        if tag_lower in _SKIP_TAGS:
            self._skip_depth = 1
            return
        if tag_lower == "title":
            self._in_title = True
        if tag_lower in _BLOCK_TAGS:
            self.texts.append("\n")

    def handle_endtag(self, tag):
        tag_lower = tag.lower()
        if self._skip_depth > 0:
            self._skip_depth -= 1
            return
        if tag_lower == "title":
            self._in_title = False
        if tag_lower in _BLOCK_TAGS:
            self.texts.append("\n")

    def handle_data(self, data):
        if self._skip_depth > 0:
            return
        text = data.strip()
        if not text:
            return
        if self._in_title:
            self.title = text
        else:
            self.texts.append(text)

    def get_text(self):
        raw = " ".join(self.texts)
        # 연속 공백·개행 정리
        raw = re.sub(r"[ \t]+", " ", raw)
        raw = re.sub(r"\n{3,}", "\n\n", raw)
        lines = [line.strip() for line in raw.splitlines()]
        lines = [l for l in lines if l]
        return "\n".join(lines)


def _detect_charset(http_headers, raw_bytes: bytes) -> str:
    """Content-Type 헤더 → meta charset 순서로 인코딩 감지"""
    # 1. HTTP 헤더
    ct = http_headers.get("Content-Type", "")
    m = re.search(r"charset=([^\s;]+)", ct, re.IGNORECASE)
    if m:
        return m.group(1).strip().lower()

    # 2. HTML meta charset (bytes 앞부분만 검색)
    head_bytes = raw_bytes[:4096].decode("ascii", errors="replace")
    m = re.search(r'charset=["\']?([^"\'\s;>]+)', head_bytes, re.IGNORECASE)
    if m:
        return m.group(1).strip().lower()

    return "utf-8"


def _decompress(raw: bytes, encoding: str) -> bytes:
    """Content-Encoding에 따라 압축 해제"""
    enc = encoding.lower().strip() if encoding else ""
    if enc == "gzip":
        return gzip.decompress(raw)
    if enc in ("deflate", "zlib"):
        try:
            return zlib.decompress(raw)
        except zlib.error:
            return zlib.decompress(raw, -zlib.MAX_WBITS)
    if enc == "br":
        # brotli는 내장 모듈 없음 — 그대로 반환 (파싱 실패 시 오류 처리됨)
        return raw
    return raw


def fetch_url(url: str) -> str:
    # gzip 수락 명시, User-Agent 설정 (bot 차단 우회)
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Encoding": "gzip, deflate",
            "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        }
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read()
            content_encoding = resp.headers.get("Content-Encoding", "")
            raw = _decompress(raw, content_encoding)
            charset = _detect_charset(resp.headers, raw)
    except urllib.error.HTTPError as e:
        print(f"오류: HTTP {e.code} — {url}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"오류: URL에 연결할 수 없습니다 — {url}\n{e.reason}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"오류: 페이지를 가져오는 중 오류 발생 — {e}", file=sys.stderr)
        sys.exit(1)

    # 인코딩 디코드 (실패 시 순서대로 fallback)
    html_text = None
    for enc in [charset, "utf-8", "cp949", "euc-kr"]:
        try:
            html_text = raw.decode(enc)
            break
        except (UnicodeDecodeError, LookupError):
            continue

    if html_text is None:
        html_text = raw.decode("utf-8", errors="replace")

    # 텍스트 추출
    parser = _TextExtractor()
    try:
        parser.feed(html_text)
    except Exception as e:
        print(f"오류: HTML 파싱 중 오류 — {e}", file=sys.stderr)
        sys.exit(1)

    body = parser.get_text()
    title = parser.title

    if not body.strip():
        print(f"오류: 텍스트를 추출할 수 없습니다 — {url}", file=sys.stderr)
        sys.exit(1)

    result_parts = []
    if title:
        result_parts.append(f"[페이지 제목] {title}\n[출처] {url}\n")
    result_parts.append(body)

    return "\n".join(result_parts)


if __name__ == "__main__":
    # Windows 터미널 인코딩 대응 (stdout/stderr 모두)
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    if len(sys.argv) < 2:
        print("사용법: python read_url.py <URL>", file=sys.stderr)
        sys.exit(1)

    text = fetch_url(sys.argv[1])
    print(text)
