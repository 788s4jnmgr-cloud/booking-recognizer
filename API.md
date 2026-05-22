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
| data | object | 解析结果数据 |
| error | string | 错误信息（失败时返回） |

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

## 调用示例

### cURL

```bash
# 通过 URL 解析
curl -X POST -H "Content-Type: application/json" \
  -d '{"url":"PDF_URL"}' \
  http://localhost:3000/parse-url

# 带 API Key
curl -X POST -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{"url":"PDF_URL"}' \
  http://localhost:3000/parse-url

# 通过 Base64 解析
curl -X POST -H "Content-Type: application/json" \
  -d '{"pdfBase64":"JVBERi0xLjQK..."}' \
  http://localhost:3000/parse
```

### JavaScript

```javascript
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
```

### Python

```python
import requests

headers = {
    'Content-Type': 'application/json',
    'X-API-Key': 'your-secret-key'  # 如配置了 API_KEY 则必填
}

response = requests.post(
    'http://localhost:3000/parse-url',
    json={'url': 'PDF_URL'},
    headers=headers
)
print(response.json()['data']['standardFormat'])
```

---

## 错误响应

### 400 参数错误

```json
{
  "error": "请提供 URL 或 base64 编码的 PDF"
}
```

### 401 未授权（缺少 API Key）

```json
{
  "error": "缺少 API Key"
}
```

### 403 禁止访问（API Key 无效）

```json
{
  "error": "API Key 无效"
}
```

### 429 请求过于频繁

```json
{
  "error": "请求过于频繁，请稍后再试",
  "retryAfter": 540
}
```

### 500 服务器错误

```json
{
  "error": "解析失败",
  "message": "Could not download PDF: 404 Not Found"
}
```

### 安全错误（URL 被拦截）

```json
{
  "error": "URL 验证失败: 禁止访问内网地址"
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
cd C:\Users\huawei\booking-recognizer

# 启动服务（默认端口 3000）
node api.js

# 指定端口
node api.js 8080

# 带 API Key 启动
set API_KEY=your-secret-key && node api.js

# 后台运行（Windows）
start /b node api.js

# 后台运行（Linux/Mac）
nohup node api.js &
```

### 停止服务

```bash
# Windows - 查找并结束进程
netstat -ano | findstr :3000
taskkill /PID <进程ID> /F

# Linux/Mac
pkill -f "node api.js"
# 或
kill $(lsof -t -i:3000)
```

### 检查服务状态

```bash
# 检查端口是否被占用
netstat -ano | findstr :3000

# 健康检查
curl http://localhost:3000/health
```

### 重启服务

```bash
# Windows
taskkill /PID <进程ID> /F
node api.js

# Linux/Mac
pkill -f "node api.js" && node api.js
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| PORT | 服务端口 | 3000 |
| API_KEY | API 认证密钥 | 未配置 |
| NODE_ENV | 运行环境 | - |

### PM2 管理（推荐生产环境）

```bash
# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start C:\Users\huawei\booking-recognizer\api.js --name booking-api

# 查看状态
pm2 status

# 查看日志
pm2 logs booking-api

# 重启
pm2 restart booking-api

# 停止
pm2 stop booking-api

# 删除
pm2 delete booking-api

# 开机自启
pm2 save
pm2 startup
```

---

## 标准格式

`船名-航次-提单号-箱量-箱型尺寸`

示例：`A.P.MOLLER-622W-HLCUSHA2603BWGA7-1-40HC`