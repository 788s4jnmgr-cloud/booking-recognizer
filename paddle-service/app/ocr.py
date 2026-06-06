"""PaddleOCR 封装:单例 + 启动预热 + 同步 OCR 调用。

PaddleOCR 内部已经做了图像 resize / 归一化等预处理,本模块不重复实现去噪,
Node 端的 image-preprocessor.js 负责在请求到达 Python 之前完成更激进的增强。
"""
from __future__ import annotations

import logging
import os
import threading
import time
from typing import List, Optional

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)


# 全局 PaddleOCR 单例 + 加载状态
_engine_lock = threading.Lock()
_engine: Optional["PaddleOCR"] = None  # type: ignore[name-defined]
_engine_ready: bool = False
_engine_error: Optional[str] = None
_engine_lang: Optional[str] = None
_model_version: Optional[str] = None


def _get_paddle_ocr_class():
    try:
        from paddleocr import PaddleOCR  # type: ignore
        return PaddleOCR
    except ImportError as e:
        raise RuntimeError(
            "paddleocr 未安装。请先 `pip install paddlepaddle paddleocr`。"
        ) from e


def _resolve_lang_code(lang: str) -> str:
    """将 PaddleOCR 支持的语言代码映射到 PP-OCRv4 兼容代码。"""
    mapping = {
        "ch": "ch",
        "zh": "ch",
        "chinese": "ch",
        "chinese_cht": "chinese_cht",
        "traditional": "chinese_cht",
        "en": "en",
        "english": "en",
        "japan": "japan",
        "ja": "japan",
        "korean": "korean",
        "ko": "korean",
        "fr": "fr",
        "de": "de",
        "ru": "ru",
    }
    return mapping.get(lang.lower(), "ch")


def initialize_engine(lang: str = "ch", use_angle_cls: bool = True) -> None:
    """在应用启动时(或测试夹具)同步加载 PaddleOCR 模型。

    多次调用幂等;并发安全。
    """
    global _engine, _engine_ready, _engine_error, _engine_lang, _model_version

    target_lang = _resolve_lang_code(lang)

    with _engine_lock:
        if _engine_ready and _engine_lang == target_lang:
            return
        try:
            PaddleOCR = _get_paddle_ocr_class()
            logger.info("Initializing PaddleOCR lang=%s ...", target_lang)
            t0 = time.time()
            _engine = PaddleOCR(
                use_angle_cls=use_angle_cls,
                lang=target_lang,
                show_log=False,
                use_gpu=os.environ.get("PADDLE_USE_GPU", "false").lower() == "true",
            )
            _engine_lang = target_lang
            _engine_ready = True
            _engine_error = None
            _model_version = "PP-OCRv4"
            logger.info("PaddleOCR ready in %.2fs", time.time() - t0)
        except Exception as e:  # noqa: BLE001
            _engine_ready = False
            _engine_error = str(e)
            logger.exception("PaddleOCR init failed")
            raise


def is_ready() -> bool:
    return _engine_ready


def get_status() -> dict:
    return {
        "ready": _engine_ready,
        "model_loaded": _engine is not None,
        "model_version": _model_version,
        "lang": _engine_lang,
        "error": _engine_error,
    }


def _b64_to_image(b64: str) -> Image.Image:
    """Base64 字符串 → PIL.Image。

    容忍用户传入 `data:image/png;base64,` 前缀。
    """
    import base64
    import io

    if "," in b64 and b64.lstrip().startswith("data:"):
        b64 = b64.split(",", 1)[1]
    raw = base64.b64decode(b64, validate=False)
    return Image.open(io.BytesIO(raw)).convert("RGB")


def _merge_line_texts(lines: list) -> str:
    """将 OCR 行按 y 坐标聚类(同行合并),便于订舱单这种"字段一行"格式的解析。"""
    if not lines:
        return ""

    def cy(item):
        ys = [p[1] for p in item["bbox"]]
        return sum(ys) / len(ys)

    sorted_lines = sorted(lines, key=cy)
    rows: list = []
    for line in sorted_lines:
        h = max(p[1] for p in line["bbox"]) - min(p[1] for p in line["bbox"])
        threshold = max(h * 0.7, 8)
        placed = False
        for row in rows:
            row_cy = sum(sum(p[1] for p in it["bbox"]) / 4 for it in row) / len(row)
            if abs(row_cy - cy(line)) <= threshold:
                row.append(line)
                placed = True
                break
        if not placed:
            rows.append([line])

    def cx(item):
        xs = [p[0] for p in item["bbox"]]
        return sum(xs) / len(xs)

    out_lines: list = []
    for row in rows:
        row_sorted = sorted(row, key=cx)
        text = " ".join(it["text"] for it in row_sorted).strip()
        if text:
            out_lines.append(text)
    return "\n".join(out_lines)


def recognize(base64_images: List[str], lang: str = "ch", merge_lines: bool = True) -> List[dict]:
    """对一组 Base64 图片执行 OCR,返回与 schema 兼容的 dict 列表。

    抛出 RuntimeError 表示引擎不可用(由调用方决定降级)。
    """
    if not _engine_ready or _engine is None:
        raise RuntimeError(f"PaddleOCR not ready: {_engine_error or 'unknown'}")

    target_lang = _resolve_lang_code(lang)
    if target_lang != _engine_lang:
        initialize_engine(lang=target_lang)

    results: List[dict] = []
    for idx, b64 in enumerate(base64_images):
        t0 = time.time()
        try:
            img = _b64_to_image(b64)
            arr = np.array(img)
            width, height = img.size
            lines: list = []
            if hasattr(_engine, "predict"):
                raw = _engine.predict(arr, cls=True)
                for page in raw:
                    texts = page.get("rec_texts", []) if isinstance(page, dict) else []
                    scores = page.get("rec_scores", []) if isinstance(page, dict) else []
                    polys = page.get("rec_polys", []) if isinstance(page, dict) else []
                    for txt, sc, poly in zip(texts, scores, polys):
                        try:
                            poly_list = poly.tolist() if hasattr(poly, "tolist") else poly
                            bbox = [[int(round(float(x))), int(round(float(y)))] for x, y in poly_list]
                        except Exception:  # noqa: BLE001
                            bbox = [[0, 0], [0, 0], [0, 0], [0, 0]]
                        lines.append({
                            "text": str(txt),
                            "confidence": float(sc),
                            "bbox": bbox,
                        })
            else:
                # 兼容旧 API
                raw = _engine.ocr(arr, cls=True)
                if raw and raw[0]:
                    for det in raw[0]:
                        try:
                            poly, (txt, sc) = det
                            bbox = [[int(round(float(x))), int(round(float(y)))] for x, y in poly]
                        except Exception:  # noqa: BLE001
                            continue
                        lines.append({
                            "text": str(txt),
                            "confidence": float(sc),
                            "bbox": bbox,
                        })

            full_text = _merge_line_texts(lines) if merge_lines else "\n".join(l["text"] for l in lines)
            results.append({
                "image_index": idx,
                "width": width,
                "height": height,
                "lines": lines,
                "full_text": full_text,
                "engine": _model_version or "paddleocr",
                "latency_ms": int((time.time() - t0) * 1000),
            })
        except Exception as e:  # noqa: BLE001
            logger.exception("OCR failed for image_index=%d", idx)
            results.append({
                "image_index": idx,
                "width": 0,
                "height": 0,
                "lines": [],
                "full_text": "",
                "engine": _model_version or "paddleocr",
                "latency_ms": int((time.time() - t0) * 1000),
                "error": str(e),
            })
    return results
