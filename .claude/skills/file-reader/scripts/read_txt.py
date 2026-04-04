"""read_txt.py — .txt 파일에서 텍스트 추출 (UTF-8, 실패 시 CP949 시도)"""
import sys
import os

def read_txt(file_path: str) -> str:
    if not os.path.exists(file_path):
        print(f"오류: 파일을 찾을 수 없습니다 — {file_path}", file=sys.stderr)
        sys.exit(1)

    # UTF-8 우선 시도, 실패 시 CP949(EUC-KR) 시도
    for encoding in ("utf-8-sig", "utf-8", "cp949", "euc-kr"):
        try:
            with open(file_path, "r", encoding=encoding) as f:
                text = f.read()
            if text.strip():
                return text
        except (UnicodeDecodeError, LookupError):
            continue

    print(f"오류: 파일 인코딩을 인식할 수 없습니다 — {file_path}", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("사용법: python read_txt.py <파일경로>", file=sys.stderr)
        sys.exit(1)

    text = read_txt(sys.argv[1])
    print(text)
