# Changelog

## [1.1.4] - 2026-06-06

### Added
- **入货通知测试 fixture 库**:`tests/fixtures/` 收录 4 张不同变体的入货通知图,覆盖 `BookingRecognizer` 全部支持的中文入货通知格式
  - `images/`: 4 张原图(28~46KB PNG,中文入货通知样本)
  - `ocr/`: PaddleOCR 输出的纯文本 fixture(每行一个识别行)
  - `golden/`: BookingRecognizer 抽出的结构化字段 fixture(去 rawText)
  - `README.md`: 目录结构、4 张图变体说明、字段定义、重新生成步骤
- **fixture 生成脚本**(根目录):
  - `generate-ocr-fixtures.py` — 批量跑 PaddleOCR(~10 分钟,4 张图)
  - `generate-golden-fixtures.js` — 批量跑 BookingRecognizer 抽字段(秒级)
- **诊断工具**:`parse-text.js` — 从任意 OCR 文本手动抽字段并打印(JSON + 标准格式),便于调正则
- **本地 PaddleOCR 调试工具**:`test-paddle-local.py` — 跑 PaddleOCR 识别单图,带置信度逐行打印

### Changed
- `.gitignore` 排除 Claude Code 本地配置(`.claude/settings.local.json` 等) + OCR 临时文件 + 用户测试图(`uploads/test-*.png`)

## [1.1.3] - 2026-06-06

### Fixed
- **入货通知解析器双重 push 容器**:`removeChineseSpaces` 把"提单号:\n2*40HC\n" 合并成"提单号:2*40HC" 字符串,`extractCargoReceivingNoticeFields` (188-225 行) 和 `extractContainers` (425-444 行) 都识别"2*40HC"并 push,导致 `2*40HC` 生成 4 个 40HC 容器
- **修复**:原 188-225 行只抽 BL 号,容器统一交给 `extractContainers` 处理(单一数据源)

### Tested
- **四张入货通知图端到端回归**(PaddleOCR 3.6.0 + 修复后 BookingRecognizer):
  - 第一张:`ZHONGGUYIN CHUAN-25028W-FQDON00309-1-40HC` ✅(空格分隔)
  - 第二张:`NORTHERN MATESTIC-25027W-FQDAB00206-2-40HC` ✅(斜杠标签 + ×箱量)
  - 第三张:`ZHONGGUCHENGDU-25047W-FQDON00489-2-40HC` ✅(船名航次连写 + 同行*号)
  - 第四张:`RACINE-26007W-FQDON00524-1-40HC` ✅(1X40HC 大写 X 兼容)

## [1.1.2] - 2026-06-06

### Fixed
- **`extractContainers` 箱型×箱量正则顺序写反**:`40HC×2`(箱型在前)未匹配,改成两个分支分别匹配 `箱型×数量` / `数量×箱型` 两种顺序
- **POL/POD 正则回溯陷阱**:`(.+?)` 非贪婪配合 `装\s*货\s*港` 边界导致 lookahead 失败,改成精确字符类 `[A-Z][A-Z\s,]+?` + 显式空白边界

### Added
- **入货通知第二种变体支持**(中文短标签体系):
  - 装货港 / 起运港 / 卸货港 / 交货地 / 目的港 中文标签
  - `船名/航次:船名/航次` 斜杠标签格式(`NORTHERN MATESTIC/25027W`)
  - `40HC×2` 箱型在前 + 数量在后的格式
  - `毛重（KGS）:34806` 中英混合格式
  - `件数:1040PACKAGES` 件数提取
- **第二张入货通知图实测**:PaddleOCR 32 行 0.83~1.00 置信度,`extractContainers` 现能正确展开 `40HC×2` 为两个 40HC 容器

## [1.1.1] - 2026-06-06

### Fixed
- **入货通知正则支持中文全角冒号 `：`**:`index.js` 19 处 `[:\s]` 字符类扩展为 `[：:\s]`,中文场景 OCR 输出的"船名航次:船名 航次"等格式不再因全角冒号漏抽(实测 PaddleOCR 输出 `船名航次：ZHONGGUYIN CHUAN 25028W` 现能正确抽 `vessel: ZHONGGUYIN CHUAN` / `voyage: 25028W`)

### Added
- 本地 PaddleOCR 3.x 端到端验证脚本:`test-paddle-local.py`(Windows Python 3.13 + paddlepaddle 3.3.1 + paddleocr 3.6.0 + ModelScope 源,关闭 MKLDNN 绕过 PaddleX 算子 bug)

## [1.1.0] - 2026-06-06

### Added
- **图片 OCR 识别能力**: 新增 `POST /parse-image` 端点,直接接收 PNG/JPG/JPEG 图片(URL / `file://` / Base64 三种方式)
- **PaddleOCR 微服务**: 新增 `paddle-service/` 目录,基于 FastAPI + PP-OCRv4,提供 `/ocr` HTTP 接口
- **Node 端 PaddleOCR 客户端**: 新增 `paddle-client.js`,内置信号量限流(默认并发 4)
- **自动降级链路**: PaddleOCR 不可用时自动降级到 tesseract.js(ECONNREFUSED / ENOTFOUND / EAI_AGAIN / 超时 / success=false 五种失败场景)
- **图片魔数校验**: 新增 `isValidImage()` 工具函数(校验 PNG `\x89PNG\r\n\x1a\n` 和 JPEG `\xFF\xD8\xFF` 魔数)
- **CLI 图片支持**: `node cli.js image.png` 直接走 PaddleOCR + tesseract 降级
- **图像预处理接入**: `image-preprocessor.js` 接入图片识别流程(去噪/二值化/直方图均衡化),`@napi-rs/canvas` 解码后送 PaddleOCR
- **端到端测试**: 新增 `test-paddle.js`,对比 PaddleOCR 与 tesseract.js 在同一张测试图上的识别效果
- **Python 单元测试**: `paddle-service/tests/test_ocr.py` 覆盖 health/ready/single OCR/格式校验/并发等
- **环境变量**: 新增 `PADDLE_OCR_URL` / `PADDLE_TIMEOUT_MS` / `PADDLE_ENABLED` / `PADDLE_MAX_CONCURRENCY` / `OCR_ENGINE_DISABLED` 五个开关

### Changed
- `docker-compose.yml` 新增 `paddleocr` 服务(Python FastAPI 容器,`expose: 8866` 不映射到主机),`booking-recognizer` 通过 `depends_on: service_healthy` 等待 PaddleOCR 就绪
- 新增 `paddle-models` named volume 持久化 PaddleOCR 模型,避免重启重下
- 启动横幅和首页 `endpoints` 字段增加 `/parse-image`

### Security
- 图片端点复用现有 SSRF 防护(`isValidUrl`)、路径穿越防护(`..` / `%00`)、Base64 字符串 70MB 预检、文件 50MB 上限
- 错误响应保持统一 `{ success, error, message }` 格式,生产环境隐藏详细错误

## [1.0.1] - 2026-05-22

### Security
- 修复 `downloadPDF()` 重定向 SSRF 绕过：301/302 重定向前增加 `isValidUrl()` 校验
- 增加下载响应体大小限制（50MB），防止磁盘被撑满
- 修复 `/parse-url` 错误处理时未清理临时文件的泄漏问题
- `pdf-parser.js` 合并两次文件读取为一次，移除裸 `openSync/readSync/closeSync`，避免句柄泄漏

### Fixed
- 修复 `portOfLoading` / `portOfDischarge` 正则中 `POL` / `POD` 匹配到 `"policy"` 等单词的误识别问题（添加单词边界 `\b`）
- `extractField()` 增加对全局标志 `g` 的防御性处理，避免 `match[1]` 为 `undefined`
- `extractContainers()` 移除给数组动态添加 `totalCount` 属性的反模式

### Changed
- CLI 输出中 `null` 字段显示为 `N/A`，重量/体积使用 `!== null` 判断防止误吞有效值 `0`
- `rateLimitMap` 增加 10000 条上限，超限先清理过期记录，仍超则删除最旧 20%，防止 DDoS 内存泄漏
- 移除未使用的正则 pattern：`containerCount`、`blNoHLC`
- 新增 `.gitignore`，排除 `node_modules/` 和运行时临时文件
