# Changelog

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
