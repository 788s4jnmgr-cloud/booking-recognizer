"""FastAPI 入口,提供 /health /ready /ocr /ocr/batch 端点。

- /health: 容器探活(进程级)
- /ready: 模型是否加载完成(区别于 health,用于上游业务判断)
- /ocr: 同步单/多图识别(1-10 张)
- /ocr/batch: 别名,语义同 /ocr
"""
from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

from . import ocr
from .schemas import (
    HealthResponse,
    OCRRequest,
    OCRResponse,
    ReadyResponse,
)

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("paddle-service")

START_TIME = time.time()
DEFAULT_LANG = os.environ.get("PADDLE_LANG", "ch")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan:启动时预热 PaddleOCR(失败不退出,标记未就绪)。"""
    logger.info("PaddleOCR service starting (lang=%s, pid=%d)", DEFAULT_LANG, os.getpid())
    try:
        ocr.initialize_engine(lang=DEFAULT_LANG)
    except Exception as e:  # noqa: BLE001
        logger.error("PaddleOCR prewarm failed: %s", e)
    yield
    logger.info("PaddleOCR service shutting down")


app = FastAPI(
    title="PaddleOCR Service",
    version="1.0.0",
    description="OCR microservice for booking-recognizer (PaddleOCR + FastAPI)",
    lifespan=lifespan,
)


@app.get("/health", response_model=HealthResponse)
async def health():
    """容器探活(进程级)。"""
    return HealthResponse(
        status="ok",
        version="1.0.0",
        uptime_sec=time.time() - START_TIME,
    )


@app.get("/ready", response_model=ReadyResponse)
async def ready():
    """模型是否加载完成。"""
    status = ocr.get_status()
    if not status["ready"]:
        return JSONResponse(
            status_code=503,
            content=ReadyResponse(
                ready=False,
                model_loaded=status["model_loaded"],
                model_version=status["model_version"],
                lang=status["lang"],
                error=status["error"],
            ).model_dump(),
        )
    return ReadyResponse(
        ready=True,
        model_loaded=status["model_loaded"],
        model_version=status["model_version"],
        lang=status["lang"],
        error=None,
    )


@app.post("/ocr", response_model=OCRResponse)
async def do_ocr(req: OCRRequest):
    """单/多图 OCR(同步)。失败时 success=false,HTTP 仍 200,便于 Node 端降级。"""
    t0 = time.time()
    if not ocr.is_ready():
        return JSONResponse(
            status_code=503,
            content=OCRResponse(
                success=False,
                results=[],
                elapsed_ms=int((time.time() - t0) * 1000),
                error=f"PaddleOCR not ready: {ocr.get_status().get('error') or 'engine not initialized'}",
            ).model_dump(),
        )

    try:
        results = ocr.recognize(
            base64_images=req.images,
            lang=req.lang,
            merge_lines=req.merge_lines,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception("OCR handler error")
        return JSONResponse(
            status_code=200,
            content=OCRResponse(
                success=False,
                results=[],
                elapsed_ms=int((time.time() - t0) * 1000),
                error=f"OCR failed: {e}",
            ).model_dump(),
        )

    status = ocr.get_status()
    return OCRResponse(
        success=True,
        results=results,
        model_version=status.get("model_version"),
        elapsed_ms=int((time.time() - t0) * 1000),
    )


# 批量端点(语义同 /ocr,便于客户端语义化调用)
app.post("/ocr/batch", response_model=OCRResponse)(do_ocr)


@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": exc.detail,
        },
    )
