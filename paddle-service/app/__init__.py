"""PaddleOCR microservice for booking-recognizer.

提供 HTTP 接口供 Node 端调用,PaddleOCR 不可用时 Node 端会自动降级到 tesseract.js。
"""
__version__ = "1.0.0"
