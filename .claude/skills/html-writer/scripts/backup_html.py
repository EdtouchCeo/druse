"""backup_html.py — 기존 index.html을 versions/index_v{N}.html로 백업"""
import sys
import os
import shutil
import glob

# 프로젝트 루트 기준 경로
SOURCE = os.path.join("output", "web", "index.html")
VERSIONS_DIR = os.path.join("output", "web", "versions")


def get_next_version(versions_dir: str) -> int:
    existing = glob.glob(os.path.join(versions_dir, "index_v*.html"))
    return len(existing) + 1


def backup():
    if not os.path.exists(SOURCE):
        print("백업 대상 없음: index.html이 존재하지 않습니다.", file=sys.stderr)
        sys.exit(1)

    os.makedirs(VERSIONS_DIR, exist_ok=True)
    n = get_next_version(VERSIONS_DIR)
    dest = os.path.join(VERSIONS_DIR, f"index_v{n}.html")
    shutil.copy2(SOURCE, dest)
    print(f"백업 완료: {dest}")
    return dest


if __name__ == "__main__":
    backup()
