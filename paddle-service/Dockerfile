FROM python:3.10-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=1 \
    PADDLE_LANG=ch \
    PADDLE_USE_GPU=false

# 1. 系统依赖:OpenCV/GL 运行时 + CJK 字体(便于后续可能的图像渲染)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 libsm6 libxrender1 libxext6 \
        fonts-noto-cjk wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

# 2. 先装依赖,利用 Docker 缓存
COPY requirements.txt .
RUN pip install --upgrade pip \
    && pip install paddlepaddle==2.6.1 \
    && pip install paddleocr==2.7.3 \
    && pip install fastapi==0.115.0 'uvicorn[standard]==0.30.6' gunicorn==23.0.0 \
    && pip install Pillow==10.4.0 opencv-python-headless==4.10.0.84 numpy==1.26.4 \
    && pip install pydantic==2.9.2 python-multipart==0.0.9 \
    && pip install pytest==8.3.3 pytest-asyncio==0.24.0 httpx==0.27.2

# 3. 复制应用
COPY app/ ./app/

# 4. 预下载 PaddleOCR 模型(build 阶段固化进镜像层,避免运行时阻塞)
#    使用 || true 兜底:若网络不通不影响 build(运行时仍会下载到 volume)
RUN python -c "from paddleocr import PaddleOCR; PaddleOCR(use_angle_cls=True, lang='ch', show_log=False)" || true

EXPOSE 8866

# 5. 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8866/health || exit 1

# 6. Gunicorn + UvicornWorker,2 worker,自动回收防内存泄漏
CMD ["gunicorn", "app.main:app", \
     "-k", "uvicorn.workers.UvicornWorker", \
     "-w", "2", \
     "-b", "0.0.0.0:8866", \
     "--timeout", "120", \
     "--graceful-timeout", "30", \
     "--max-requests", "200", \
     "--max-requests-jitter", "50", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]
