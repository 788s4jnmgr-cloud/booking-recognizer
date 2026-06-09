---
name: booking-assistant
description: 订舱识别助手 - 当用户提到海运单据、订舱单、提单、Booking、B/L、货代、柜子、船名航次、箱型箱量等物流/货代场景时触发。用于解析 PDF/图片中的订舱信息、模糊比对识别结果、处理 Hapag-Lloyd 模板、中转多船场景。入货通知、舱单提单号识别、船名纠错、箱量统计等场景也使用此 skill。
---

# Booking Assistant Skill

项目 `booking-recognizer` 是一个 Node.js 订舱单识别模块，用于从海运 PDF/Word/图片中提取结构化信息。

## 项目结构

```
booking-recognizer/
├── index.js              # BookingRecognizer 核心类
├── pdf-parser.js         # PDF/Word 文本提取
├── api.js                # Express API 服务
├── cli.js                # CLI 入口
├── paddle-client.js      # PaddleOCR 客户端
├── paddle-service/       # PaddleOCR Python 微服务
├── tests/fixtures/       # 入货通知 OCR fixture 库
└── uploads/              # 临时文件目录
```

## 核心能力

1. **字段提取**：船名、航次、提单号(B/L)、箱号、箱型、毛重、体积、ETA/ETD、运费方式
2. **标准格式输出**：`船名-航次-提单号-箱量-箱型尺寸`，混箱型如 `2x40HC+1x20GP`
3. **模糊比对**：`fuzzyCompare(result, expectedFormat, threshold)` 提单号/箱量/箱型精确匹配，船名/航次按相似度
4. **Hapag-Lloyd 兼容**：多栏排版、模板标签过滤、欧式数字格式
5. **中转多船**：从第二个 `Voy. No` 锚点提取副船
6. **入货通知格式**：中文空格分隔、斜杠标签、提单号同行箱型 `*` 分隔

## 常用命令

```bash
# CLI 解析 PDF
node cli.js ./test.pdf

# 启动 API
node api.js 3000

# 跑内置自测试
node index.js

# 批量生成 fixture
python generate-ocr-fixtures.py
node generate-golden-fixtures.js
```

## 关键类和方法

### BookingRecognizer (index.js)

```javascript
const { BookingRecognizer } = require('./index');

const recognizer = new BookingRecognizer();
const result = recognizer.parse(text);
console.log(recognizer.toStandardFormat(result));
// 输出: MUNKEBO MAERSK-624W-HLCUTA12605EOHA7-3-2x40HC+1x20GP
```

**核心方法：**
- `parse(text)` → 结构化对象
- `toStandardFormat(result)` → 标准格式字符串
- `format(result)` → 同上（别名）
- `fuzzyCompare(result, 'A.P.MOLLER-622W-HLCUTA12604DJZJ4-2-20GP', 0.7)` → 比对结果
- `compareWithDocument(combinedFormat, pdfExtractor)` → 自动解析文档并比对
- `formatComparisonResult(comparisonResult)` → 格式化输出（便于打印）

**提取字段（parse 返回值）：**
- `documentType` - 文档类型 BOOKING_NOTE / BILL_OF_LADING / MARINE_BL / SEAWAY_BILL / FIXTURE_NOTE / CARGO_RECEIVING_NOTICE
- `bookingNo` - 订舱号
- `blNo` - 提单号（HLCU 开头优先）
- `vessel` / `voyage` - 船名航次
- `portOfLoading` / `portOfDischarge` - 起运港/目的港
- `containers[]` - 集装箱数组，含 `sizeType` / `containerNo` / `sealNo`
- `grossWeight` - 毛重（优先 Σ 各箱明细）
- `volume` - 体积
- `eta` / `etd` / `shipDate` - 日期
- `freight` - PREPAID / COLLECT

### PDF 解析 (pdf-parser.js)

```javascript
const { extractTextFromPDF } = require('./pdf-parser');
const text = await extractTextFromPDF('./test.pdf');
```

## Hapag-Lloyd 模板特殊处理

Hapag-Lloyd 模板有多栏排版导致 PDF 文本流错位的问题，参考以下修复模式：

### 船名误识别（用 Voy. No 锚点反向查找）

```javascript
// 不要直接用 /VESSEL[：:\s]*([A-Z]...)/im（i 标志会让 [A-Z] 匹配正文小写）
// 应该用 Voy. No 锚点，在锚点前 400 字符内找全大写多词行
const voyMatches = [...text.matchAll(/Voy\.?\s*No[：:\s]*(\d{2,4}[A-Z]?)/gi)];
const vessel = findVesselNameByVoyNoAnchor(text, voyMatches[0]);
```

黑名单过滤：`VESSEL / DP VOYAGE / IMO NO / CALL SIGN / FLAG` + 港口名 + 机构名。

### 箱量冲突（摘要 vs 明细列表）

摘要 "1x45GP" 与明细 "145GP/245GP" 冲突时，**优先解析明细列表**：
- HIGH CUBE CONT. → 40HC
- GENERAL PURPOSE CONT. → 40GP
- REEFER CONT. → 40RF

用 `parseLocalizedNumber()` 处理欧式小数（如 `10860,0`）。

### 欧式毛重格式

`parseLocalizedNumber("10860,0")` → `10860.0`（不是 108600）

## 中转多船场景

格式：`主船-主航次-提单号-箱量-箱型+副船-副航次+URL`

```javascript
// 第二个 Voy. No 对应副船
const secondVoy = voyNoMatches[1];
const secondVessel = findVesselNameByVoyNoAnchor(text, secondVoy);
```

## 调试技巧

1. **看 rawText**：新增策略前先用 `result.rawText` 关键字搜索验证字段是否在 PDF 里
2. **锚点 + 反向查找**：多栏排版用"锚点 + 反向查找"模式
3. **训练样本**：新增文档类型先入 CSV 再写正则
4. **诊断工具**：`parse-text.js` 从 OCR 文本手动抽字段并打印标准格式

## 安全注意事项

修改 API 相关代码时不要绕过：
- SSRF 防护（`isValidUrl`）
- 路径穿越防护（禁止 `..`）
- PDF 签名校验（`%PDF`）
- 文件大小限制 50MB
