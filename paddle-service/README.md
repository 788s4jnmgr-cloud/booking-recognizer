# PaddleOCR Service

PaddleOCR 微服务,为 [booking-recognizer](../) Node 端提供 HTTP OCR 能力。
PaddleOCR 不可用时,Node 端会自动降级到 tesseract.js,不中断服务。

## 快速启动

### 方式一:docker-compose(推荐)

```bash
cd ..
docker compose up -d paddleocr
curl http://localhost:8866/health
```

### 方式二:本地开发

```bash
cd paddle-service
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8866 --reload
```

## API

| Method | Path | 说明 |
|--------|------|------|
| GET | `/health` | 容器探活 |
| GET | `/ready` | 模型是否就绪(503 表示未就绪) |
| POST | `/ocr` | 单/多图 OCR(1-10 张) |
| POST | `/ocr/batch` | 同 `/ocr` |

### 请求示例

```bash
IMG=$(base64 -w 0 test.png)
curl -X POST http://localhost:8866/ocr \
  -H "Content-Type: application/json" \
  -d "{\"images\":[\"$IMG\"]}"
```

### 响应示例

```json
{
  "success": true,
  "results": [
    {
      "image_index": 0,
      "width": 800,
      "height": 400,
      "lines": [
        { "text": "MAERSK SYDNEY", "confidence": 0.98, "bbox": [[20,30],[200,30],[200,55],[20,55]] }
      ],
      "full_text": "MAERSK SYDNEY\nVoyage: 624W\n...",
      "engine": "PP-OCRv4",
      "latency_ms": 312
    }
  ],
  "model_version": "PP-OCRv4",
  "elapsed_ms": 320
}
```

## 测试

```bash
# 先启动服务
docker compose up -d paddleocr

# 跑测试(模型首次加载需 1-2 分钟,test_ready_after_init 会重试)
pytest tests/ -v
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PADDLE_LANG` | `ch` | 默认语言 |
| `PADDLE_USE_GPU` | `false` | 是否启用 GPU(需 host 有 NVIDIA) |
| `PADDLE_CPU_THREADS` | `2` | CPU 推理线程数 |
| `LOG_LEVEL` | `INFO` | 日志级别 |
