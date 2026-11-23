// 直接从文本文件抽 BookingRecognizer 字段(绕过文件格式检查)
const fs = require('fs');
const path = require('path');
const { BookingRecognizer } = require('./index');

const txtPath = process.argv[2] || 'uploads/_paddle_ocr_result.txt';
const text = fs.readFileSync(txtPath, 'utf-8');

console.log('=== OCR 原文 ===');
console.log(text);
console.log('=== 原文结束 ===\n');

const recognizer = new BookingRecognizer();
const result = recognizer.parse(text);
const std = recognizer.toStandardFormat(result);

console.log('=== 解析结果 ===');
console.log(JSON.stringify(result, null, 2));
console.log(`\n标准格式: ${std}`);
console.log(`\nOCR 引擎: PaddleOCR 3.6.0 (本地)`);
