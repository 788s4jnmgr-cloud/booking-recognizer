"""PaddleOCR 服务端到端单元测试。

使用 pytest + httpx,需要服务在 localhost:8866 可用。
CI/CD 场景下可由 docker-compose 启动后执行,或单独跑:
  docker compose up -d paddleocr
  pytest paddle-service/tests -v
"""
from __future__ import annotations

import base64
import io
import time

import pytest
from PIL import Image, ImageDraw, ImageFont


SERVICE_URL = "http://localhost:8866"


def _make_synthetic_png(
    text: str = "MAERSK SYDNEY\nVoyage: 624W\nBL: HLCUSZX2606BNTH9\nContainers: 3 x 20GP",
    size=(800, 400),
) -> bytes:
    """生成一张含英文文字的测试 PNG。"""
    img = Image.new("RGB", size, color="white")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
    except OSError:
        font = ImageFont.load_default()
    for i, line in enumerate(text.split("\n")):
        draw.text((20, 30 + i * 32), line, fill="black", font=font)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_health():
    import httpx
    r = httpx.get(f"{SERVICE_URL}/health", timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "ok"
    assert "version" in body
    assert body["uptime_sec"] >= 0


def test_ready_after_init():
    """PaddleOCR 启动需要时间,重试直到 ready 或超时。"""
    import httpx
    deadline = time.time() + 180  # 镜像 start_period=120s,给 180s 冗余
    last = None
    while time.time() < deadline:
        try:
            r = httpx.get(f"{SERVICE_URL}/ready", timeout=5)
            last = r
            if r.status_code == 200:
                body = r.json()
                assert body["ready"] is True
                assert body["model_loaded"] is True
                return
        except httpx.HTTPError as e:
            last = e
        time.sleep(3)
    pytest.fail(f"PaddleOCR not ready within timeout; last response: {last}")


def test_single_png_ocr():
    import httpx
    png_bytes = _make_synthetic_png()
    payload = {
        "images": [base64.b64encode(png_bytes).decode("ascii")],
        "lang": "ch",
        "merge_lines": True,
    }
    r = httpx.post(f"{SERVICE_URL}/ocr", json=payload, timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["success"] is True, body
    assert len(body["results"]) == 1
    res = body["results"][0]
    assert res["width"] == 800
    assert res["height"] == 400
    full = res["full_text"].upper()
    # 至少识别出部分文字(英文字体简单,期望命中 MAERSK/Voyage 等关键字至少一个)
    assert any(kw in full for kw in ("MAERSK", "VOYAGE", "BL", "HLCU")), (
        f"识别结果不含预期关键字: {full!r}"
    )


def test_invalid_base64_returns_failure():
    import httpx
    payload = {"images": ["this-is-not-valid-base64!!!"]}
    r = httpx.post(f"{SERVICE_URL}/ocr", json=payload, timeout=30)
    # PaddleOCR 端要么 200 + success=false(图像解码失败),要么 500
    # 当前实现是 catch + 返回 OCR 失败 → success=false
    assert r.status_code in (200, 500)
    if r.status_code == 200:
        body = r.json()
        assert body["success"] is False


def test_oversize_rejected_by_pydantic():
    """超过 10 张图的请求应被 Pydantic 422 拒绝。"""
    import httpx
    payload = {"images": ["aGVsbG8="] * 11}
    r = httpx.post(f"{SERVICE_URL}/ocr", json=payload, timeout=10)
    assert r.status_code == 422


def test_empty_images_rejected():
    import httpx
    payload = {"images": []}
    r = httpx.post(f"{SERVICE_URL}/ocr", json=payload, timeout=10)
    assert r.status_code == 422


if __name__ == "__main__":
    # 允许 `python tests/test_ocr.py` 单独跑(不强制 pytest)
    print("Run with: pytest tests/test_ocr.py -v")
