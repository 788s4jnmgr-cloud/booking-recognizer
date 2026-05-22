# booking-recognizer

> 从海运订舱单/海运单据 PDF/Word 中提取结构化信息的 Node.js 服务。

## 功能特性

- **多格式支持**：
  - 文件格式：PDF (含扫描件 OCR)、Word (.docx)
  - 文档类型：订舱单（Booking Note）、提单（Bill of Lading）、海运单（Marine B/L）、Seaway Bill、Fixture Note、入货通知（Cargo Receiving Notice）
- **字段提取**：船名、航次、提单号、箱号、箱型、毛重、体积、ETA/ETD、运费方式等
- **标准输出**：`船名-航次-提单号-箱量-箱型尺寸`
- **三种使用方式**：类库调用、CLI 工具、HTTP API 服务
- **OCR 支持**：内置 tesseract.js，支持扫描件 PDF 识别（中英文）
- **安全加固**：SSRF 防护、路径穿越防护、PDF 签名校验、API Key 认证、速率限制

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
set API_KEY=your-secret-key && node api.js
```

接口：
- `GET /health` — 健康检查
- `POST /parse` — 解析 PDF（支持 URL 或 Base64）
- `POST /parse-url` — 直接解析 URL

详见 [API.md](./API.md)。

## 项目结构

```
booking-recognizer/
├── index.js          # BookingRecognizer 核心类
├── pdf-parser.js     # PDF/Word 文本提取，支持 OCR
├── api.js            # Express API 服务
├── cli.js            # 命令行入口
├── API.md            # API 文档
├── uploads/          # 临时文件目录
└── test*.pdf/docx    # 测试样例
```

## 安全说明

- SSRF 防护：禁止访问内网地址
- 文件校验：路径穿越防护、PDF 签名头校验（`%PDF`）、50MB 大小限制
- 可选 API Key：通过 `API_KEY` 环境变量启用
- 速率限制：每 IP 每 15 分钟最多 100 次请求

## License

MIT
