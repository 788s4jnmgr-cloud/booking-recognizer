---
name: booking-recognizer
description: 订舱识别 (booking-recognizer 项目) - 当用户提到海运单据、订舱单、提单、Booking、B/L、货代、柜子、船名航次、箱型箱量、入货通知、Cargo Receiving Notice、PaddleOCR、模糊比对等物流/货代场景时触发。用于解析 PDF/Word/PNG/JPG 中的订舱信息、模糊比对识别结果、处理 Hapag-Lloyd 模板与中转多船场景。
---

# Booking Assistant Skill

项目 `booking-recognizer` 是 Node.js 订舱单识别模块，用于从海运 PDF/Word/图片中提取结构化信息。Skill 与代码同步至 CHANGELOG 最新版（**1.1.6**，2026-06-09；package.json 标记仍为 1.1.5，未及时 bump）。

## 项目结构

```
booking-recognizer/
├── index.js                   # BookingRecognizer 核心类（所有公共方法）
├── pdf-parser.js              # PDF/Word 文本提取（路径安全 + 50MB 限制 + %PDF 签名校验）
├── image-preprocessor.js      # PNG/JPG 预处理（PaddleOCR 前置）
├── api.js                     # Express ^5.2.1 API 服务（SSRF/路径/签名防护）
├── cli.js                     # CLI 入口（PDF / DOCX / PNG / JPG）
├── paddle-client.js           # PaddleOCR Node 客户端
├── paddle-service/            # PaddleOCR Python 微服务（独立部署）
│   ├── app/ocr.py             # 双版本兼容（2.x use_angle_cls / 3.x use_textline_orientation）
│   ├── requirements.txt       # paddlepaddle 3.1.1 + paddleocr 3.6.0
│   ├── Dockerfile             # 已弃用（README 改 venv 部署，文件保留）
│   ├── tests/
│   └── README.md
├── tests/fixtures/            # 入货通知 + booking fixture 库（5 个 case）
│   ├── images/                # 4 张 PNG（28-46KB 中文入货通知）
│   ├── ocr/                   # PaddleOCR 输出文本（notice-1~4.txt + notice-5-mixed-types.txt）
│   ├── pdfs/                  # PDF 原件（notice-5-mixed-types.pdf 自带文本层）
│   ├── golden/                # 期望字段 JSON（去 rawText）
│   └── README.md
├── downloads/                 # CLI 批量下载临时目录
├── uploads/                   # API 运行时临时目录（自动清理）
├── generate-ocr-fixtures.py   # 批量 OCR fixture 生成（~10 分钟）
├── generate-golden-fixtures.js# 批量字段 fixture 生成（秒级）
├── parse-text.js              # OCR 文本诊断工具（手动抽字段 + 打印标准格式）
├── compare-once.js            # 单次标准格式比对
├── test-ocr.js                # PaddleOCR 本地调试（带置信度逐行打印）
├── package.json               # scripts: recognize, test
├── API.md                     # HTTP API 接口文档（中文）
├── README.md                  # 中文使用文档（v1.1.6 起去 Docker 化）
├── CHANGELOG.md               # 1.1.0~1.1.6 版本变更
└── AGENTS.md                  # AI 编程助手阅读指南（中文）
```

## 核心能力

1. **多格式输入**：PDF（pdf-parse / pdfjs-dist）、DOCX（mammoth，依赖装好但代码未调用）、PNG/JPG（pdfjs-dist 渲染 + PaddleOCR 主路径 + tesseract.js 降级）
2. **字段提取**：船名、航次、提单号（B/L）、箱号、箱型、毛重（欧式/美式）、体积、ETA/ETD、运费方式
3. **标准格式输出**：`船名-航次-提单号-箱量-箱型`
   - 单箱型：`MUNKEBO MAERSK-624W-HLCUTA12605EOHA7-1-20GP`
   - 混箱型（1.1.5+，1.1.6 强化）：`MUNKEBO MAERSK-624W-HLCUTA12605EOHA7-3-[2x40HC+1x20GP]`
4. **模糊比对**：`fuzzyCompare(result, expectedFormat, threshold)`，默认 threshold=0.7
   - 1.1.6 起：箱型/箱量子集匹配（识别多算 OK，少算 fail）
   - 错误消息区分「箱量不足」「箱型缺失」两类原因
5. **Hapag-Lloyd 兼容**：多栏排版、模板标签过滤、欧式数字格式
6. **中转多船**：combinedFormat 扩展为 `主船-主航次-提单号-箱量-箱型+副船-副航次+URL`
7. **入货通知格式**：中文空格分隔、斜杠标签、提单号同行箱型 `*` 分隔

## 常用命令

```bash
# 安装依赖
npm install

# CLI 解析（PDF/DOCX/图片）
node cli.js ./test.pdf
node cli.js ./test.docx
node cli.js ./photo.png

# 启动 API（默认端口 3000）
node api.js
node api.js 8080

# 内置自测试（index.js 末尾 require.main === module 块）
node index.js

# OCR 诊断
node parse-text.js ./tests/fixtures/ocr/notice-1.txt
node test-ocr.js

# 批量生成 fixture
python generate-ocr-fixtures.py      # PaddleOCR (~10 分钟)
node generate-golden-fixtures.js     # 字段抽取（秒级）

# npm scripts
npm run recognize -- ./test.pdf
npm test
```

## BookingRecognizer 公共方法（index.js）

```javascript
const { BookingRecognizer } = require('./index');
const recognizer = new BookingRecognizer();
const result = recognizer.parse(text);
```

| 方法 | 用途 |
|------|------|
| `parse(text)` | 主入口，返回结构化对象 |
| `toStandardFormat(result)` / `format(result)` | 输出标准格式字符串 |
| `extractField(text, fieldName)` | 按字段名正则抽取 |
| `extractHLCFields(text, result)` | Hapag-Lloyd 专属（明细列表优先于摘要） |
| `extractCargoReceivingNoticeFields(text, result)` | 中文入货通知（去重避免双重 push） |
| `extractContainers(text)` | 箱型×箱量（`40HC×2` 与 `2×40HC` 双方向） |
| `extractVesselVoyage(text, result)` | 船名航次提取 |
| `extractNumericField(text, fieldName)` | 数值字段（兼容欧式 `10860,0`） |
| `findVesselNameByVoyNoAnchor(text, anchorMatch)` | Voy. No 锚点反向查找船名（去 `[A-Z]/i` 误命中） |
| `sizeTypeFromDetail(length, category)` | HIGH CUBE / GENERAL PURPOSE / REEFER → 箱型 |
| `parseLocalizedNumber(s)` | 欧式 `10860,0` / 美式 `10,860.50` 自动识别 |
| `computeGrossWeight(text, containers)` | 优先 Σ 各箱明细 "Gross Weight: X KGM" |
| `calculateSimilarity(str1, str2)` | Levenshtein 距离相似度（0-1） |
| `formatContainerSummary(containers)` | 单/混箱型判断 + 混箱型加 `[]` 包裹 |
| `parseStandardFormat(standardFormat)` | 解析标准格式（支持 4 种括号） |
| `fuzzyCompare(result, standardFormat, threshold)` | 模糊比对 |
| `parseCombinedFormat(combinedFormat)` | 解析 combinedFormat（含副船 + URL） |
| `compareWithDocument(combinedFormat, pdfExtractor, threshold)` | combinedFormat + `file://` URL 一键比对 |
| `formatComparisonResult(comparisonResult)` | 人类可读比对结果（含「箱量不足」「箱型缺失」分类） |

**parse 返回字段**：
- `documentType` — `BOOKING_NOTE` / `BILL_OF_LADING` / `MARINE_BL` / `SEAWAY_BILL` / `FIXTURE_NOTE` / `CARGO_RECEIVING_NOTICE`
- `bookingNo` / `blNo`（HLCU 开头优先）
- `vessel` / `voyage` / `secondVessel` / `secondVoyage`（中转场景）
- `portOfLoading` / `portOfDischarge`
- `containers[]`（`sizeType` / `containerNo` / `sealNo` / `grossWeight`）
- `grossWeight` / `volume` / `eta` / `etd` / `shipDate` / `freight`（PREPAID / COLLECT）
- `rawText`（调试用：搜索 PDF 关键字验证正则是否命中）

## 标准格式规范

### 单箱型（向后兼容）
```
船名-航次-提单号-箱量-箱型
例：MUNKEBO MAERSK-624W-HLCUTA12605EOHA7-1-20GP
```

### 混箱型（1.1.5+，1.1.6 强化）
```
船名-航次-提单号-箱量-[箱型组合]
例：MUNKEBO MAERSK-624W-HLCUTA12605EOHA7-3-[2x40HC+1x20GP]
```

### 中转多船 combinedFormat（1.1.5+）
```
主船-主航次-提单号-箱量-箱型+副船-副航次+URL
例：SEASPANPRIDE-624W-HLCUTA12605GGMT7-2-40HC+MERKUROCEAN-2630S+file:///path/to/doc.pdf
```

### `parseStandardFormat` 支持的 4 种括号（1.1.6）
正则在 `index.js:787`：`/^[（(\[【]|[）)\]】]$/g`
- 半角 `[]` — 主流：`[2x40HC+1x20GP]`
- 全角 `【】`
- 半角 `()`
- 全角 `（）`

## Hapag-Lloyd 模板 4 大坑（修复模式）

### 1. 船名误识别 — `findVesselNameByVoyNoAnchor`

```javascript
// ❌ 不要用：/VESSEL[：:\s]*([A-Z]...)/im
//    （i 标志让 [A-Z] 匹配正文小写 "vessel"，抓到"schedule you initially requested may have changed..."）
// ✅ 用 Voy. No 锚点反向查找锚点前 400 字符内的"全大写多词行"
const voyMatches = [...text.matchAll(/Voy\.?\s*No[：:\s]*(\d{2,4}[A-Z]?)/gi)];
const vessel = findVesselNameByVoyNoAnchor(text, voyMatches[0]);
```

黑名单：`VESSEL / DP VOYAGE / IMO NO / CALL SIGN / FLAG` + 港口（QINGDAO / ROTTERDAM / APM2）+ 机构（HAPAG-LLOYD / KUEHNE & NAGEL）。

### 2. 箱量冲突 — 明细列表优先

```javascript
// ❌ 旧 boxCountRegex2 备选不含 45GP，命中不全（2x45GP,1x22GP 只命中 1x22GP）
// ✅ 通用箱型 (?:20|22|40|45)(?:GP|HC|RF|OT|FR|HQ) +
//    HIGH CUBE / GENERAL PURPOSE / REEFER 明细展开（按出现顺序）
extractHLCFields(text, result);  // 内置明细优先 + 摘要兜底
```

### 3. 欧式毛重

```javascript
// ❌ parseFloat("10860,0".replace(/,/g, '')) → 108600（错把 , 当 thousands）
// ✅ parseLocalizedNumber("10860,0") → 10860.0
const grossWeight = computeGrossWeight(text, containers);  // 优先 Σ 各箱明细
```

### 4. 中转多船

```javascript
const voyNoMatches = [...text.matchAll(/Voy\.?\s*No[：:\s]*(\d{2,4}[A-Z]?)/gi)];
const secondVessel = voyNoMatches[1]
  ? findVesselNameByVoyNoAnchor(text, voyNoMatches[1])
  : null;
```

## 调试技巧

1. **看 rawText**：正则失效时先 `console.log(result.rawText)` 搜关键字确认字段是否在 PDF 里
2. **锚点 + 反向查找**：多栏排版统一策略（船名/港口/字段定位都可用）
3. **新增文档类型先入 CSV**：`outputs/booking-corrections/<date>.csv`（schema 含 `deviation_type` 列），写正则前先积累样本
4. **诊断工具链**：
   - `node parse-text.js <text>` — 手动抽字段 + 打印标准格式
   - `node test-ocr.js` — 跑 PaddleOCR 看置信度
   - `node compare-once.js` — 单次比对
5. **回归基准**：`tests/fixtures/golden/*.json` 端到端
   - `notice-1~4`：PaddleOCR 3.6.0 路径
   - `notice-5-mixed-types`：pdf-parse 路径（自带文本层）

## 安全注意事项

修改 API 相关代码时不要绕过：
- SSRF 防护（`isValidUrl`，拒绝内网 IP）
- 路径穿越防护（`pdf-parser.js` 禁止 `..`）
- PDF 签名校验（必须 `%PDF` 头）
- 文件大小限制 50MB
- API Key 认证（生产环境 `API_KEY` env）
- Base64 上传大小限制（避免 DoS）

## 关键依赖

- `pdf-parse` ^1.1.4 — PDF 文本层提取
- `mammoth` ^1.12.0 — DOCX（依赖装好，代码暂未调用）
- `tesseract.js` ^7.0.0 — 扫描件 OCR 降级
- `pdfjs-dist` ^3.11.174 — 图片 PDF 渲染
- `pdf2pic` ^3.2.0 — PDF 转图
- `@omsimos/pdf-raster` ^0.1.1 — PDF 光栅化
- `@napi-rs/canvas` ^1.0.0 — Node 原生画布
- `express` ^5.2.1 — API 服务
- `paddle-service`（独立 Python）— paddlepaddle 3.1.1 + paddleocr 3.6.0
  - ⚠️ 不要升 paddlepaddle 3.3+（PIR + onednn 有 `ConvertPirAttribute2RuntimeAttribute` bug）