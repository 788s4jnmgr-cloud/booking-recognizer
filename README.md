# booking-recognizer

> 从海运订舱单/海运单据 PDF/Word 中提取结构化信息的 Node.js 服务。

## 功能特性

- **多格式支持**：
  - 文件格式：PDF (含扫描件 OCR)、Word (.docx)
  - 文档类型：订舱单（Booking Note）、提单（Bill of Lading）、海运单（Marine B/L）、Seaway Bill、Fixture Note、入货通知（Cargo Receiving Notice）
- **字段提取**：船名、航次、提单号、箱号、箱型、毛重、体积、ETA/ETD、运费方式等
- **入货通知格式支持**：`提单号：FQD0N00490 2*40HC`（BL号与箱量箱型写在同一行，用 `*` 分隔）
- **标准输出**：`船名-航次-提单号-箱量-箱型尺寸`
- **模糊比对**：支持标准格式与识别结果的模糊比对，提单号/箱量/箱型精确匹配，船名/航次按相似度判定
- **三种使用方式**：类库调用、CLI 工具、HTTP API 服务
- **OCR 支持**：内置 tesseract.js，支持扫描件 PDF 识别（中英文）
- **安全加固**：SSRF 防护、路径穿越防护、PDF 签名校验、API Key 认证、速率限制、Base64 大小限制

## 安装

```bash
npm install
```

## 使用方式

### 1. 类库调用

```javascript
const { BookingRecognizer } = require('./index');
const { extractTextFromPDF } = require('./pdf-parser');

const text = await extractTextFromPDF('./test.pdf');
const recognizer = new BookingRecognizer();
const result = recognizer.parse(text);
console.log(recognizer.toStandardFormat(result));
```

#### 模糊比对

```javascript
const { BookingRecognizer } = require('./index');
const { extractTextFromPDF } = require('./pdf-parser');

const recognizer = new BookingRecognizer();

// 方式1: 分步调用
const result = recognizer.parse(text);
const comparison = recognizer.fuzzyCompare(result, 'A.P.MOLLER-622W-HLCUTA12604DJZJ4-2-20GP', 0.7);
console.log(comparison.matched ? '吻合' : '不吻合');

// 方式2: 组合格式比对（自动解析文档）
const combinedResult = await recognizer.compareWithDocument(
  'GUSTV MAER-62E-HLCUTA12604FTHP4-1-20GP+file:///path/to/doc.pdf',
  async (doc) => extractTextFromPDF(doc.replace('file://', '')),
  0.7  // 阈值 70%
);

// 格式化输出
console.log(recognizer.formatComparisonResult(combinedResult).formattedOutput);
```

### 2. CLI 工具

```bash
# 支持 PDF 和 Word 文件
node cli.js ./test.pdf
node cli.js ./test.docx
```

### 3. HTTP API 服务

```bash
# 默认端口 3000
node api.js

# 指定端口
node api.js 8080

# 生产环境（带 API Key）
API_KEY=your-secret-key node api.js
```

**接口列表：**
| 接口 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/parse` | POST | 解析 PDF（支持 URL 或 Base64） |
| `/parse-url` | POST | 直接解析 URL |
| `/parse-batch` | POST | 批量解析（最多 20 个） |
| `/compare` | POST | 模糊比对 |

详见 [API.md](./API.md)。

## 模糊比对说明

### 输入格式

```
船名-航次-提单号-箱量-箱型+文档
```

示例：
```
GUSTAV MAERSK-622E-HLCUTA12604FTHP4-1-20GP+https://oss.example.com/doc.pdf
GUSTAV MAERSK-622E-HLCUTA12604FTHP4-1-20GP+file:///path/to/doc.pdf
```

### 文档路径格式

| 类型 | 格式 | 示例 |
|------|------|------|
| 远程 URL | 直接填写 URL | `https://oss.example.com/doc.pdf` |
| 本地文件 (macOS/Linux) | `file://` + 完整路径 | `file:///Users/xxx/doc.pdf` |
| 本地文件 (Windows) | `file://` + 路径 | `file:///C:/Users/xxx/doc.pdf` |

**注意**：`file://` 后必须跟完整路径，macOS 上 `file://Users/...` 会自动补全为 `file:///Users/...`

### 比对规则

1. **精确匹配字段**（必须完全一致）：提单号、箱量、箱型
2. **模糊匹配字段**（相似度 ≥ 阈值）：船名、航次
3. 精确匹配字段全部通过后，才进行模糊匹配

### 返回结果示例

**吻合：**
```
========================================
比对结果: ✅ 吻合
相似度: 100%
阈值: 70%

标准格式:
  GUSTAV MAERSK-622E-HLCUTA12502BHSO7-2-20GP
识别结果:
  GUSTAV MAERSK-622E-HLCUTA12502BHSO7-2-20GP
```

**不吻合：**
```
========================================
比对结果: ❌ 不吻合
相似度: 0%

不吻合原因:
  - 提单号不一致 (期望: HLCUTA12502BHSO7, 识别: HLCUTA12604FFOB3)

标准格式:
  GUSTAV MAERSK-622E-HLCUTA12502BHSO7-2-20GP
识别结果:
  MUNICH MAERSK-622W-HLCUTA12604FFOB3-2-20GP
```

### API 调用示例

```bash
# 模糊比对（本地文件）
curl -X POST http://localhost:3000/compare \
  -H "Content-Type: application/json" \
  -d '{"combinedFormat": "GUSTAV MAERSK-622E-HLCUTA12502BHSO7-2-20GP+file:///tmp/doc.pdf"}'

# 模糊比对（远程 URL）
curl -X POST http://localhost:3000/compare \
  -H "Content-Type: application/json" \
  -d '{"combinedFormat": "GUSTAV MAERSK-622E-HLCUTA12502BHSO7-2-20GP+https://oss.example.com/doc.pdf"}'
```

## 项目结构

```
booking-recognizer/
├── index.js              # BookingRecognizer 核心类（含模糊比对）
├── pdf-parser.js         # PDF/Word 文本提取，支持 OCR
├── api.js                # Express API 服务
├── cli.js                # 命令行入口
├── validation.js         # 字段校验模块
├── image-preprocessor.js # OCR 图像预处理
├── Dockerfile           # 容器化部署
├── docker-compose.yml    # 服务编排
├── API.md                # API 文档
├── README.md             # 本文档
├── uploads/              # 临时文件目录
└── test*.pdf/docx        # 测试样例
```

## 安全说明

- **SSRF 防护**：禁止访问内网地址（127.x、10.x、192.168.x、localhost 等）
- **路径穿越防护**：禁止 `..` 和 `%00` 字符
- **文件校验**：PDF 签名头校验（`%PDF`）、50MB 大小限制
- **Base64 限制**：请求数据不超过 70MB
- **可选 API Key**：通过 `API_KEY` 环境变量启用
- **速率限制**：每 IP 每 15 分钟最多 100 次请求
- **错误格式统一**：所有接口返回 `{ success: true/false, ... }` 格式

## License

MIT