"""
生成 4 个入货通知图的 OCR 文本 fixture,输出到 tests/fixtures/ocr/<name>.txt

用法:python generate-ocr-fixtures.py
"""
import os
import sys
import time
import json
from pathlib import Path

# UTF-8 输出
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

# 关闭 MKLDNN(PaddlePaddle 3.3 + PaddleX 3.6 兼容性问题)
os.environ['FLAGS_use_mkldnn'] = '0'

FIXTURES = [
    ('notice-1-space-separated.png', '中文空格分隔,船名航次:船名 航次,1*40HQ'),
    ('notice-2-slash-labels.png', '中文斜杠标签,船名/航次:船名/航次,40HC×2,起运港/交货地'),
    ('notice-3-inline-bl.png', '提单号行 + 2*40HC 同行(被空格合并),船名航次连写'),
    ('notice-4-uppercase-x.png', '1X40HC 大写 X 字符,船名航次:船名航次(连写)'),
]

ROOT = Path(__file__).parent
IMAGES = ROOT / 'tests' / 'fixtures' / 'images'
OUT = ROOT / 'tests' / 'fixtures' / 'ocr'
OUT.mkdir(parents=True, exist_ok=True)

def main():
    from paddleocr import PaddleOCR
    ocr = PaddleOCR(
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        lang='ch',
        enable_mkldnn=False,
    )
    print(f"PaddleOCR 初始化完成,共 {len(FIXTURES)} 张图待处理\n")

    for idx, (filename, note) in enumerate(FIXTURES, 1):
        img_path = IMAGES / filename
        if not img_path.exists():
            print(f"[{idx}/4] ✗ 缺失: {filename}")
            continue
        print(f"[{idx}/4] {filename} ({note})")
        t1 = time.time()
        results = ocr.predict(str(img_path))
        elapsed = time.time() - t1
        page = results[0]
        res = page.json['res'] if hasattr(page, 'json') else {}
        rec_texts = res.get('rec_texts', [])

        # 写纯文本(每行一个识别行,无置信度)
        out_path = OUT / filename.replace('.png', '.txt')
        out_path.write_text('\n'.join(rec_texts), encoding='utf-8')
        print(f"         耗时 {elapsed:.1f}s,共 {len(rec_texts)} 行 → {out_path.name}")

    print("\n✓ 全部 OCR fixture 生成完成")

if __name__ == '__main__':
    main()
