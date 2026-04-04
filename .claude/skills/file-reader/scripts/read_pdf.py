"""read_pdf.py — .pdf 파일에서 텍스트 추출 (pymupdf 사용, 스캔본 OCR 제외)"""
import sys
import os

def read_pdf(file_path: str) -> str:
    try:
        import fitz  # pymupdf
    except ImportError:
        print("오류: pymupdf가 설치되지 않았습니다. pip install pymupdf", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(file_path):
        print(f"오류: 파일을 찾을 수 없습니다 — {file_path}", file=sys.stderr)
        sys.exit(1)

    doc = fitz.open(file_path)
    pages_text = []

    for page_num in range(len(doc)):
        page = doc[page_num]
        text = page.get_text("text")
        if text.strip():
            pages_text.append(f"[페이지 {page_num + 1}]\n{text.strip()}")

    doc.close()

    result = "\n\n".join(pages_text)
    if not result.strip():
        print(f"오류: 텍스트를 추출할 수 없습니다 (스캔본 PDF는 지원하지 않습니다) — {file_path}", file=sys.stderr)
        sys.exit(1)

    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("사용법: python read_pdf.py <파일경로>", file=sys.stderr)
        sys.exit(1)

    text = read_pdf(sys.argv[1])
    print(text)
