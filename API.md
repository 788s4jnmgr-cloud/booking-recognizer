# 订舱识别 API 文档

## 服务地址

```
http://localhost:3000
```

---

## 接口列表

| 接口 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 健康检查 | GET | `/health` | 检查服务是否正常运行 |
| 首页信息 | GET | `/` | 查看接口列表 |
| 解析 PDF | POST | `/parse` | 支持 URL/Base64 两种方式 |
| 解析 URL | POST | `/parse-url` | 直接传入 PDF 下载地址 |
| 批量解析 | POST | `/parse-batch` | 批量解析多个 PDF |
| 模糊比对 | POST | `/compare` | 标准格式与文档比对 |

---

## 1. 健康检查

### 请求

```bash
GET /health
```

### 响应

```json
{
  "status": "ok",
  "service": "booking-recognizer-api"
}
```

---

## 2. 解析 PDF（通用接口）

支持通过 URL 或 Base64 编码传递 PDF。

### 请求

```bash
POST /parse
Content-Type: application/json
X-API-Key: your-api-key  # 可选，如配置了 API_KEY 则必填
```

### 入参

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| url | string | 否 | PDF 的 URL 地址（与 pdfBase64 二选一） |
| pdfBase64 | string | 否 | PDF 的 Base64 编码（与 url 二选一） |

### 出参

| 参数名 | 类型 | 说明 |
|--------|------|------|
| success | boolean | 请求是否成功 |
| data | object | 解析结果数据（成功时） |
| error | string | 错误信息（失败时） |
| message | string | 详细错误信息（失败时） |

### 成功响应

```json
{
  "success": true,
  "data": {
    "documentType": "BILL_OF_LADING",
    "bookingNo": null,
    "fileNo": null,
    "blNo": "HLCUSHA2603BWGA7",
    "vessel": "A.P.MOLLER",
    "voyage": "622W",
    "portOfLoading": "QINGDAO",
    "portOfDischarge": "LOS ANGELES",
    "containers": [
      {
        "sizeType": "40HC",
        "containerNo": "TEMU3716804",
        "sealNo": "WSHC017498"
      }
    ],
    "grossWeight": 120000,
    "volume": 29.46,
    "eta": "2026-06-05",
    "freight": "COLLECT",
    "standardFormat": "A.P.MOLLER-622W-HLCUSHA2603BWGA7-1-40HC"
  }
}
```

### 失败响应

```json
{
  "success": false,
  "error": "解析失败",
  "message": "网络错误: timeout"
}
```

### data 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| documentType | string | 文档类型 |
| bookingNo | string | 订舱号 |
| fileNo | string | 文件号 |
| blNo | string | 提单号 |
| vessel | string | 船名 |
| voyage | string | 航次 |
| portOfLoading | string | 起运港 |
| portOfDischarge | string | 目的港 |
| containers | array | 集装箱列表 |
| containers[].sizeType | string | 箱型尺寸 |
| containers[].containerNo | string | 箱号 |
| containers[].sealNo | string | 封条号 |
| grossWeight | number | 毛重（公斤） |
| volume | number | 体积（立方米） |
| eta | string | 预计到达时间 |
| freight | string | 运费：PREPAID/COLLECT |
| standardFormat | string | 标准格式：船名-航次-提单号-箱量-箱型 |

---

## 3. 解析 URL

专用接口，直接传入 PDF 的 URL 地址。

### 请求

```bash
POST /parse-url
Content-Type: application/json
X-API-Key: your-api-key  # 可选，如配置了 API_KEY 则必填
```

### 入参

```json
{
  "url": "https://oss.qingdao-port.net/wlds-common/eccom/photo/1779153714890.PDF"
}
```

### 出参

同 `/parse` 接口。

---

## 4. 批量解析

最多支持 20 个/批次。

### 请求

```bash
POST /parse-batch
Content-Type: application/json
X-API-Key: your-api-key  # 可选，如配置了 API_KEY 则必填
```

### 入参

```json
{
  "items": [
    {"url": "https://example.com/doc1.pdf"},
    {"pdfBase64": "JVBERi0xLjQK..."}
  ]
}
```

### 出参

```json
{
  "success": true,
  "results": [
    {
      "success": true,
      "data": { "standardFormat": "A.P.MOLLER-622W-HLCU123456-2-20GP" }
    },
    {
      "success": false,
      "error": "文件不存在"
    }
  ],
  "summary": {
    "total": 2,
    "succeeded": 1,
    "failed": 1
  }
}
```

---

## 5. 模糊比对

将标准格式字符串与文档进行比对，返回匹配结果。

### 请求

```bash
POST /compare
Content-Type: application/json
X-API-Key: your-api-key  # 可选，如配置了 API_KEY 则必填
```

### 入参

```json
{
  "combinedFormat": "船名-航次-提单号-箱量-箱型+文档路径"
}
```

### 输入格式说明

```
船名-航次-提单号-箱量-箱型+文档
```

| 字段 | 示例值 | 匹配方式 |
|------|--------|----------|
| 船名 | GUSTAV MAERSK | 模糊匹配（相似度 ≥ 阈值） |
| 航次 | 622E | 模糊匹配（相似度 ≥ 阈值） |
| 提单号 | HLCUTA12502BHSO7 | **精确匹配** |
| 箱量 | 2 | **精确匹配** |
| 箱型 | 20GP | **精确匹配** |

### 文档路径格式

- **URL**: `https://example.com/doc.pdf`
- **本地文件**: `file:///完整路径` (macOS/Linux)
- **本地文件**: `file:///C:/Users/xxx/doc.pdf` (Windows)

**注意**: `file://` 后必须跟完整路径，不能写成 `file://Users/...`，应写成 `file:///Users/...`

### 出参

```json
{
  "success": true,
  "data": {
    "matched": true,
    "similarity": 1,
    "threshold": 0.7,
    "standardFormat": "GUSTAV MAERSK-622E-HLCUTA12502BHSO7-2-20GP",
    "recognizedFormat": "GUSTAV MAERSK-622E-HLCUTA12502BHSO7-2-20GP",
    "formattedOutput": "========================================\n比对结果: ✅ 吻合\n相似度: 100%\n阈值: 70%\n...",
    "details": {
      "expected": {
        "vessel": "GUSTAV MAERSK",
        "voyage": "622E",
        "blNo": "HLCUTA12502BHSO7",
        "containerCount": 2,
        "sizeType": "20GP"
      },
      "recognized": {
        "vessel": "GUSTAV MAERSK",
        "voyage": "622E",
        "blNo": "HLCUTA12502BHSO7",
        "containerCount": 2,
        "sizeType": "20GP"
      },
      "exactMatchFields": {
        "blNo": { "expected": "HLCUTA12502BHSO7", "actual": "HLCUTA12502BHSO7", "matched": true },
        "containerCount": { "expected": 2, "actual": 2, "matched": true },
        "sizeType": { "expected": "20GP", "actual": "20GP", "matched": true }
      }
    }
  }
}
```

### 比对失败响应

```json
{
  "success": true,
  "data": {
    "matched": false,
    "similarity": 0,
    "details": {
      "expected": { "blNo": "HLCUTA12502BHSO7", ... },
      "recognized": { "blNo": "HLCUTA12604FFOB3", ... },
      "exactMatchFields": {
        "blNo": { "expected": "HLCUTA12502BHSO7", "actual": "HLCUTA12604FFOB3", "matched": false }
      }
    }
  }
}
```

### 比对规则

1. **精确匹配字段**（必须完全一致）：提单号、箱量、箱型
2. **模糊匹配字段**（相似度 ≥ 阈值）：船名、航次
3. 精确匹配字段全部通过后，才进行模糊匹配

---

## 调用示例

### cURL

```bash
# 通过 URL 解析
curl -X POST -H "Content-Type: application/json" \
  -d '{"url":"PDF_URL"}' \
  http://localhost:3000/parse-url

# 通过 Base64 解析
curl -X POST -H "Content-Type: application/json" \
  -d '{"pdfBase64":"JVBERi0xLjQK..."}' \
  http://localhost:3000/parse

# 模糊比对（本地文件）
curl -X POST -H "Content-Type: application/json" \
  -d '{"combinedFormat":"GUSTAV MAERSK-622E-HLCUTA123456-2-20GP+file:///tmp/doc.pdf"}' \
  http://localhost:3000/compare

# 带 API Key
curl -X POST -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{"url":"PDF_URL"}' \
  http://localhost:3000/parse-url
```

### JavaScript

```javascript
// 解析 PDF
const response = await fetch('http://localhost:3000/parse-url', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'your-secret-key'  // 如配置了 API_KEY 则必填
  },
  body: JSON.stringify({ url: 'PDF_URL' })
});
const result = await response.json();
console.log(result.data.standardFormat);

// 模糊比对
const compareResponse = await fetch('http://localhost:3000/compare', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    combinedFormat: 'GUSTAV MAERSK-622E-HLCUTA123456-2-20GP+file:///tmp/doc.pdf'
  })
});
const compareResult = await compareResponse.json();
console.log(compareResult.data.matched ? '吻合' : '不吻合');
```

### Python

```python
import requests

headers = {
    'Content-Type': 'application/json',
    'X-API-Key': 'your-secret-key'  # 如配置了 API_KEY 则必填
}

# 解析 PDF
response = requests.post(
    'http://localhost:3000/parse-url',
    json={'url': 'PDF_URL'},
    headers=headers
)
print(response.json()['data']['standardFormat'])

# 模糊比对
compare_response = requests.post(
    'http://localhost:3000/compare',
    json={'combinedFormat': 'GUSTAV MAERSK-622E-HLCUTA123456-2-20GP+file:///tmp/doc.pdf'},
    headers=headers
)
result = compare_response.json()
print('吻合' if result['data']['matched'] else '不吻合')
```

---

## 错误响应

所有接口统一返回格式：

```json
{
  "success": false,
  "error": "错误描述",
  "message": "详细错误信息"
}
```

### 常见错误

| 错误 | 说明 |
|------|------|
| 请提供 URL 或 base64 编码的 PDF | 未提供必要的 PDF 数据 |
| 无效的 URL 格式 | URL 格式不正确 |
| 禁止访问内网地址 | SSRF 防护拦截 |
| 文件不存在 | 指定路径的文件不存在 |
| 文件过大（最大 50MB） | PDF 超过大小限制 |
| 无效的 PDF 文件 | 文件不是有效的 PDF |
| 下载超时（60秒） | URL 下载超时 |
| 请求过于频繁，请稍后再试 | 速率限制触发 |

### 认证错误

```json
{
  "success": false,
  "error": "缺少 API Key"
}
```

```json
{
  "success": false,
  "error": "API Key 无效"
}
```

---

## 安全机制

| 机制 | 说明 |
|------|------|
| SSRF 防护 | 禁止访问内网地址（127.x、10.x、192.168.x、localhost 等） |
| 文件验证 | PDF 文件必须以 `%PDF` 开头，文件大小限制 50MB |
| 速率限制 | 每 15 分钟最多 100 次请求 |
| API Key | 可选认证，通过环境变量 `API_KEY` 配置 |
| 错误隐藏 | 生产环境隐藏详细错误信息 |

### 配置 API Key

```bash
# Windows
set API_KEY=your-secret-key && node api.js

# Linux/Mac
API_KEY=your-secret-key node api.js
```

---

## 服务管理

### 启动服务

```bash
# 进入目录
cd booking-recognizer

# 启动服务（默认端口 3000）
node api.js

# 指定端口
node api.js 8080

# 带 API Key 启动
API_KEY=your-secret-key node api.js

# 后台运行（Linux/Mac）
nohup node api.js &
```

### 停止服务

```bash
# Linux/Mac
pkill -f "node api.js"
# 或
kill $(lsof -t -i:3000)
```

### 检查服务状态

```bash
# 健康检查
curl http://localhost:3000/health
```

### 重启服务

```bash
# Linux/Mac
pkill -f "node api.js" && node api.js
```

---

## 标准格式

`船名-航次-提单号-箱量-箱型尺寸`

示例：`A.P.MOLLER-622W-HLCUSHA2603BWGA7-1-40HC`