"""
本地 PaddleOCR 测试脚本(绕开 Docker/FastAPI,直接用 PaddleOCR 3.x 处理图片)

用法:python test-paddle-local.py <image_path>
"""
import sys
import os
import time
import json
from pathlib import Path

# Windows 中文乱码修复
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

def main():
    if len(sys.argv) < 2:
        print("用法:python test-paddle-local.py <image_path>")
        sys.exit(1)

    image_path = sys.argv[1]
    if not os.path.exists(image_path):
        print(f"图片不存在: {image_path}")
        sys.exit(1)

    print(f"[1/3] 加载 PaddleOCR...")
    t0 = time.time()
    # 关闭 MKLDNN 加速 — 3.3.1 + 3.6 组合下 ArrayAttribute 算子未实现
    os.environ['FLAGS_use_mkldnn'] = '0'
    from paddleocr import PaddleOCR
    # PaddleOCR 3.x 推荐参数
    ocr = PaddleOCR(
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        lang='ch',
        enable_mkldnn=False,
    )
    print(f"      引擎初始化耗时: {time.time() - t0:.1f}s")

    print(f"[2/3] 识别图片: {image_path}")
    t1 = time.time()
    results = ocr.predict(image_path)
    elapsed = time.time() - t1
    print(f"      识别耗时: {elapsed:.1f}s,共 {len(results)} 张图")

    if not results:
        print("      [WARN] PaddleOCR 返回空结果")
        return

    # PaddleOCR 3.x:results[i] 是对象,数据在 .json['res']['rec_texts'/'rec_scores'/'rec_polys']
    page = results[0]
    res = page.json['res'] if hasattr(page, 'json') else {}
    rec_texts = res.get('rec_texts', [])
    rec_scores = res.get('rec_scores', [])

    full_text_lines = []
    print(f"[3/3] 提取文本 (共 {len(rec_texts)} 行):")
    for txt, score in zip(rec_texts, rec_scores):
        print(f"      [{score:.2f}] {txt}")
        full_text_lines.append(txt)

    full_text = "\n".join(full_text_lines)
    print(f"\n--- 完整文本 ---")
    print(full_text)
    print(f"--- 文本结束 ---\n")

    # 复用现有 BookingRecognizer(从 .js 同步过来的解析逻辑,这里走 Node 调用)
    print("[BONUS] 调 BookingRecognizer 抽字段 (走 Node 同步):")
    try:
        # 写文本到临时文件,让 cli.js 处理
        import subprocess
        tmp_txt = Path("uploads") / "_paddle_ocr_result.txt"
        tmp_txt.parent.mkdir(exist_ok=True)
        tmp_txt.write_text(full_text, encoding='utf-8')
        print(f"      OCR 文本已写入: {tmp_txt}")
        print(f"      (后续可手动跑: node cli.js {tmp_txt} 或 grep 关键字段)")
    except Exception as e:
        print(f"[ERR] 写入失败: {e}")

if __name__ == "__main__":
    main()
