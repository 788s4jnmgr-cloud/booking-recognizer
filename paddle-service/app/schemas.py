"""Pydantic schemas for OCR request/response."""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class OCRRequest(BaseModel):
    """单图/批量 OCR 请求体。

    images: Base64 编码的图片数组(不带 data:image/*;base64, 前缀),长度 1-10。
    lang: PaddleOCR 语言代码,默认 'ch'(简体中文 PP-OCRv4 覆盖中英文)。
    use_det/use_cls/use_rec: 是否启用检测/方向分类/识别。
    merge_lines: 是否将同行文本块合并为单行字符串(便于订舱单解析)。
    """

    images: List[str] = Field(..., min_length=1, max_length=10, description="Base64 encoded images")
    lang: str = Field("ch", description="PaddleOCR language code: ch/en/chinese_cht/japan/korean/fr/de/ru")
    use_det: bool = True
    use_cls: bool = True
    use_rec: bool = True
    merge_lines: bool = True


class OCRLine(BaseModel):
    """单行识别结果。"""

    text: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    bbox: List[List[int]] = Field(..., description="[[x1,y1],[x2,y2],[x3,y3],[x4,y4]]")


class OCRImageResult(BaseModel):
    """单张图片的完整识别结果。"""

    image_index: int
    width: int
    height: int
    lines: List[OCRLine]
    full_text: str
    engine: str
    latency_ms: int


class OCRResponse(BaseModel):
    """OCR 端点统一响应。"""

    success: bool
    results: List[OCRImageResult] = Field(default_factory=list)
    model_version: Optional[str] = None
    elapsed_ms: int = 0
    error: Optional[str] = None


class HealthResponse(BaseModel):
    """健康检查响应。"""

    status: str
    version: str
    uptime_sec: float


class ReadyResponse(BaseModel):
    """就绪检查响应(模型是否加载完成)。"""

    ready: bool
    model_loaded: bool
    model_version: Optional[str] = None
    lang: Optional[str] = None
    error: Optional[str] = None
