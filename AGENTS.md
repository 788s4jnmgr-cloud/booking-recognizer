# AGENTS.md — booking-recognizer

> 本文件供 AI 编程助手阅读。项目的主要注释和文档语言为**中文**，新增代码注释也应优先使用中文。

---

## 项目概述

`booking-recognizer`（订舱识别模块）是一个基于 Node.js 的轻量级服务，用于从**海运订舱单/海运单据 PDF**中提取结构化信息。

核心能力：
- 解析 PDF 文本，通过正则表达式匹配提取字段
- 支持多种单据类型：订舱单（Booking Note）、提单（Bill of Lading）、海运单（Marine B/L）、海运单（Seaway Bill）、Fixture Note、入货通知（Cargo Receiving Notice）
- 对 Hapag-Lloyd（HLCU 提单号）和中文入货通知格式做了特殊兼容
- 输出标准格式：`船名-航次-提单号-箱量-箱型尺寸`

项目提供三种使用方式：
1. **类库**（`index.js`）：直接实例化 `BookingRecognizer` 调用 `parse(text)`
2. **CLI 工具**（`cli.js`）：命令行传入 PDF 路径，打印解析结果
3. **HTTP API 服务**（`api.js`）：Express 服务，支持通过 URL 或 Base64 接收 PDF 并返回 JSON

---

## 技术栈

- **运行时**：Node.js（CommonJS 模块）
- **Web 框架**：Express ^5.2.1
- **PDF 解析**：pdf-parse ^1.1.4
- **DOCX 解析**：mammoth ^1.12.0（依赖已安装，当前代码未直接调用）
- **无数据库**：纯内存计算，无持久化存储

---

## 项目结构

```
booking-recognizer/
├── package.json          # npm 配置，依赖定义
├── package-lock.json     # 锁定版本
├── index.js              # 核心识别类 BookingRecognizer（主入口）
├── pdf-parser.js         # PDF 文本提取封装（含路径安全校验）
├── api.js                # Express API 服务（安全加固版）
├── cli.js                # 命令行入口
├── API.md                # API 接口文档（中文）
├── uploads/              # 运行时临时文件目录（API 下载/上传用）
├── test.pdf ~ test4.pdf  # 示例测试 PDF（无自动化测试，靠手工验证）
└── node_modules/         # 依赖目录
```

### 各文件职责

| 文件 | 说明 |
|------|------|
| `index.js` | `BookingRecognizer` 类。定义字段正则模式（bookingNo、blNo、vesselVoyage、containerInfo 等），提供 `parse(text)`、`format(result)`、`toStandardFormat(result)` 方法。文件尾部包含自运行测试代码块（`require.main === module`）。 |
| `pdf-parser.js` | 封装 `pdf-parse`。提供 `extractTextFromPDF(pdfPath)` 和 `batchExtract(pdfPaths)`。包含路径安全检查（禁止 `..`、危险字符、大小限制 50MB）和 PDF 签名头校验（`%PDF`）。 |
| `api.js` | Express 服务。端口默认 3000（可通过参数或 `PORT` 环境变量覆盖）。实现 `/health`、`/parse`、`/parse-url` 路由，集成可选 API Key 认证、速率限制、SSRF 防护、临时文件清理。 |
| `cli.js` | CLI 入口。接收 PDF 文件路径参数，调用 `pdf-parser.js` 和 `BookingRecognizer`，打印结构化结果和标准格式。 |

---

## 常用命令

```bash
# 安装依赖
npm install

# 运行 CLI 解析指定 PDF
npm run recognize -- ./test.pdf
# 或
node cli.js ./test.pdf

# 运行 index.js 内置自测试（打印示例文本的解析结果）
npm test
# 或
node index.js

# 启动 API 服务（默认端口 3000）
node api.js

# 指定端口启动
node api.js 8080

# 带 API Key 启动（推荐生产环境）
# Windows
set API_KEY=your-secret-key && node api.js
# Linux/Mac
API_KEY=your-secret-key node api.js
```

---

## 代码风格与约定

- **语言**：注释和文档优先使用中文。
- **模块系统**：CommonJS（`require` / `module.exports`）。
- **类组织**：核心逻辑集中在 `BookingRecognizer` 类中，字段正则定义在构造函数 `this.patterns` 内。
- **命名**：
  - 方法名使用 camelCase（如 `extractField`、`normalizeSizeType`）。
  - 常量/配置使用全大写下划线（如 `RATE_LIMIT_WINDOW`）。
- **错误处理**：异步函数使用 `try/catch`；API 层在 `NODE_ENV=production` 时隐藏详细错误信息，仅返回通用提示。
- **数值处理**：重量、体积等数值字段提取后通过 `parseFloat` 转换，逗号分隔符会被移除。
- **标准化规则**：
  - 箱型 `22GP` → `20GP`，`45GP` → `40HC`
  - 船名 `A.P. MOLLER` → `A.P.MOLLER`（去掉点号后多余空格）

---

## 测试策略

**本项目目前没有自动化测试框架（如 Jest、Mocha）。**

测试方式：
1. **内置自测试**：`index.js` 文件末尾有 `if (require.main === module)` 代码块，运行 `node index.js` 即可用一段模拟文本验证解析逻辑。
2. **手工 CLI 测试**：使用目录下的 `test.pdf`、`test2.pdf`、`test3.pdf`、`test4.pdf` 运行 `node cli.js test.pdf` 观察输出。
3. **API 手工测试**：启动 `api.js` 后，用 `curl` 或 Postman 调用 `/health`、`/parse`、`/parse-url`，参照 `API.md` 中的示例。

如果你要新增解析规则，建议：
- 准备对应格式的样本 PDF 或文本片段
- 在 `index.js` 的自运行代码块中新增验证用例，运行 `node index.js` 确认无回归
- 使用 `node cli.js` 在真实 PDF 上验证

---

## 安全注意事项

项目已在 `api.js` 和 `pdf-parser.js` 中内置多层安全防护，修改时请勿轻易绕过：

1. **SSRF 防护**（`isValidUrl`）：禁止访问内网地址（`localhost`、`127.x`、`10.x`、`192.168.x`、`172.16-31.x`、`.local`、IPv6 本地地址）。
2. **路径穿越防护**（`isValidFilePath`、`isValidPDFPath`）：禁止路径中的 `..`、危险 shell 字符（`;|``$&` 等）。
3. **PDF 签名校验**（`isValidPDF`）：读取文件前 4 字节，必须为 `%PDF`。
4. **文件大小限制**：单文件上限 **50MB**。
5. **可选 API Key 认证**：通过环境变量 `API_KEY` 启用，请求头 `X-API-Key` 或查询参数 `api_key` 校验。
6. **速率限制**：每 IP 每 15 分钟最多 100 次请求（内存存储，重启失效）。
7. **临时文件安全清理**：`safeUnlink` 只允许删除 `uploads/` 目录下的文件；进程退出时尝试清空 `uploads/`。
8. **生产环境错误隐藏**：`NODE_ENV=production` 时，API 不对外暴露原始错误堆栈或内部信息。

---

## 部署与运行

- **无构建步骤**：Node.js 直接运行源文件，无需打包或转译。
- **环境变量**：
  - `PORT`：服务端口（默认 3000）
  - `API_KEY`：API 认证密钥（可选，但生产环境强烈建议配置）
  - `NODE_ENV`：设为 `production` 可隐藏详细错误
- **生产环境推荐**：使用 PM2 管理进程（`API.md` 中提供了完整 PM2 命令示例）。
- **临时目录**：`uploads/` 用于存放 API 接收的 PDF，已配置进程退出清理，但长期运行建议配合系统定时任务检查残留。

---

## 扩展指引

- **新增字段**：在 `BookingRecognizer.patterns` 中添加正则，在 `parse()` 中调用提取，更新 `API.md` 中的字段说明。
- **新增单据类型**：在 `detectDocumentType()` 中添加识别规则，并在 `parse()` 分支中处理特殊字段（参考 `CARGO_RECEIVING_NOTICE` 的处理方式）。
- **新增输出格式**：在 `BookingRecognizer` 中添加新的格式化方法，保持 `toStandardFormat()` 不变以免影响已有调用方。
- **API 路由**：如需新增端点，注意复用 `authMiddleware` 和 `rateLimitMiddleware`，并在响应中统一使用 `{ success: true, data: ... }` 或 `{ error: ... }` 结构。
