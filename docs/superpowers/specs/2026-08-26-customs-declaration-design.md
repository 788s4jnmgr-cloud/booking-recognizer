# Customs Declaration Parser — Design Spec

**Date:** 2026-08-26
**Branch:** `feature/customs-declaration`
**Author:** booking-recognizer team
**Status:** Approved (待用户复核 spec)

## 1. Goal

为 `booking-recognizer` 增加 **CUSTOMS_DECLARATION（中华人民共和国海关进口/出口货物报关单）** 解析能力。当前系统支持 6 种海运单据类型（BOOKING_NOTE / BILL_OF_LADING / MARINE_BL / SEAWAY_BILL / FIXTURE_NOTE / CARGO_RECEIVING_NOTICE），报关单不在范围内。用户提供一次性脚本 `extract-customs.js` 验证了基本可行性，本 spec 把脚本改造成正式模块。

## 2. Background & Motivation

云港通项目需要从海关报关单 PDF 中提取结构化字段以供业务下游使用。当前痛点：

- `BookingRecognizer.detectDocumentType()` 对报关单返回 `UNKNOWN`，所有字段为 null
- 报关单字段数（30+）远多于海运单（10+），格式（中文表格）也不同，混在 BookingRecognizer 内不合适
- 报关单 PDF 文字层有空格错位（OCR/表格化导致），需要专门的归一化与坐标还原

## 3. Scope

**In Scope (v1):**

- 1 个测试 PDF fixture（用户提供的 `1751009864352.pdf`）
- 30+ 字段提取（详见 §5）
- CLI 加 `--type customs` 强制走 customs 解析器
- API `/parse-url` 响应增加 `parser` 字段标识
- README/CHANGELOG 文档更新

**Out of Scope (v1):**

- OCR-only PDF（无文字层）的坐标还原（降级走 tesseract 但不做坐标处理）
- 多页报关单
- 出口报关单（先做进口，出口字段集差异后续）
- 自动表格列识别（依赖已知表头锚点）

## 4. Architecture

```
输入 PDF → customs-declaration.js (主模块)
              ↓
        pdf-table-extractor.js (pdfjs-dist 坐标 → cells)
              ↓
        customs-declaration.js 用表头锚点匹配 cell → 30+ 字段

并行分支 (无侵入):
- BookingRecognizer.detectDocumentType() 检测到 "海关.*报关单" → 返回 CUSTOMS_DECLARATION
- 但 BookingRecognizer.parse() 不处理 customs 字段（走 null fallback）
- CLI/API 用 --type customs / documentType 字段切换走 customs 解析器
```

## 5. Module Design

### 5.1 `customs-declaration.js`

导出 `CustomsDeclarationRecognizer` 类：

```javascript
class CustomsDeclarationRecognizer {
  /**
   * 解析 PDF 路径
   * @param {string} pdfPath - PDF 文件路径
   * @returns {Promise<Object>} 报关单字段结果
   */
  async parse(pdfPath) {
    const cells = await pdfTableExtractor.extract(pdfPath);
    return this.parseFromCells(cells);
  }

  /**
   * 直接从 cell 数组解析（便于测试 / API 集成）
   * @param {Array<{row, col, text, x, y, w, h}>} cells
   * @returns {Object} 报关单字段
   */
  parseFromCells(cells) {
    /* ... */
  }

  // 单字段提取方法（公开，便于单测）
  extractCustomsNo(cells) {
    /* ... */
  }
  extractVesselVoyage(cells) {
    /* ... */
  }
  extractBlNo(cells) {
    /* ... */
  }
  extractPorts(cells) {
    /* ... */
  }
  extractGrossWeight(cells) {
    /* ... */
  }
  // ... etc
}
```

### 5.2 字段清单（v1 30+ 字段）

| 分组       | 字段                                                  | 类型                    |
| ---------- | ----------------------------------------------------- | ----------------------- |
| 标识       | customsNo（海关编号）                                 | string                  |
| 时间       | importDate / declareDate                              | string (YYYYMMDD)       |
| 关务       | customsBranch（进境关别代码）                         | string                  |
| 运输       | transportMode（{code, name}）                         | object                  |
| 关务方式   | supervisionMode / taxNature                           | object                  |
| 合同       | contractNo                                            | string                  |
| 国家       | tradeCountry / originCountry / finalDest              | object                  |
| 中转       | transitPortCode                                       | string                  |
| 船名航次号 | vessel / voyage                                       | string                  |
| 提单       | blNo                                                  | string                  |
| 港口       | portOfLoading / portOfDischarge / portOfDischargeCode | string                  |
| 包装       | packaging（{code, name}）/ packageCount               | mixed                   |
| 重量       | grossWeight                                           | number                  |
| 运费       | tradeTerm                                             | string (C&F/FOB/CIF...) |
| 商品       | hsCode / goodsName / totalPrice / currency            | mixed                   |
| 目的地     | domesticDest / taxLevy                                | string                  |
| 报关员     | declarantCertNo                                       | string                  |
| 单位       | declarantUnit（{code, name}）                         | object                  |
| 收货人     | consigneeCode                                         | string                  |
| 确认       | confirmFlags（6 项 是/否）                            | object                  |
| 调试       | rawCells                                              | array                   |

### 5.3 `pdf-table-extractor.js`

```javascript
/**
 * 用 pdfjs-dist 提取 PDF 文字层坐标 → 二维 cell 数组
 * @param {string} pdfPath - PDF 路径
 * @returns {Promise<Array<{row, col, text, x, y, w, h}>>}
 */
async function extract(pdfPath) {
  /* ... */
}
```

**算法**：

1. pdfjs-dist `page.getTextContent()` 拿 items（每个含 transform 矩阵）
2. transform[5] = y（页底原点 → 翻转为页顶原点）
3. transform[4] = x
4. 按 y 分组（±2 px 容差 → 同一行）
5. 行内按 x 排序
6. 相邻行间距 < 4 px → 合并为同一段（段落块）
7. 输出 cells（不做自动列分割，由 customs 模块按已知表头锚点匹配）

## 6. Integration Points

### 6.1 `index.js`

```javascript
// detectDocumentType() 加一行:
if (/海\s*关.*报\s*关\s*单/.test(text)) return "CUSTOMS_DECLARATION";
// parse() 中 CUSTOMS_DECLARATION 走 null fallback (不污染)
```

### 6.2 `cli.js`

```javascript
// 加 --type 标志:
if (args.includes("--type=customs")) {
  const { CustomsDeclarationRecognizer } = require("./customs-declaration");
  const r = new CustomsDeclarationRecognizer();
  const result = await r.parse(pdfPath);
  // 输出 customs 字段
} else {
  // 默认 auto-detect + BookingRecognizer
}
```

### 6.3 `api.js`

```javascript
// /parse-url 响应增加 parser 字段:
{
  success: true,
  data: { /* ... */ },
  parser: 'booking' | 'customs'  // 新增
}
```

## 7. Error Handling

| 情况                | 行为                                               |
| ------------------- | -------------------------------------------------- |
| 表格 cell 缺某字段  | 字段返回 `null`，不抛                              |
| PDF 文字层完全空    | 降级 OCR（沿用 tesseract），不做坐标还原，仅做正则 |
| 关键字段全 null     | `parse()` 返回成功 + `warnings: string[]`          |
| PDF 文件不存在/损坏 | 抛 `Error`（保持与现有 API 一致）                  |

## 8. Testing

- **Fixture**: `tests/fixtures/customs/pdfs/1751009864352.pdf`（用户提供）
- **Golden JSON**: `tests/fixtures/customs/golden/1751009864352.json`（30+ 字段期望值）
- **单元测试**: `customs-declaration.js` 各 extract* 函数独立测
- **集成测试**: `tests/test-customs.js` 端到端跑 fixture
- **CLI smoke**: `node cli.js --type=customs tests/fixtures/customs/pdfs/1751009864352.pdf`
- **API smoke**: `POST /parse-url` with URL

不引入新依赖，不改现有 fixtures 结构。

## 9. Risks & Trade-offs

| 风险                                        | 缓解                                                      |
| ------------------------------------------- | --------------------------------------------------------- |
| PDF 坐标还原不稳（不同 PDF 生成器布局差异） | v1 仅支持一个 fixture；后续按样本迭代                     |
| 表头锚点漏匹配（OCR 错字如"卉内"）          | 字典 fallback（KNOWN_FIELD_NAMES）含常见 OCR 错误         |
| 中文跨字段污染（cnNorm 把多栏目拼一行）     | 用 cell 级别匹配（同一 row 内按 col 取），不再依赖 cnNorm |
| 占用内存（pdfjs-dist 整页加载）             | 当前 PDF 都是 1 页，可接受                                |

## 10. Out of Scope (Future)

- 多页报关单合并
- 出口报关单（字段集不同）
- OCR-only PDF 的坐标还原
- 自动表格列识别（当前依赖已知表头）
- PaddleOCR 集成（已有但 customs 暂未对接）

---

## Self-Review Checklist

- [x] 无 TBD/TODO/占位符
- [x] 内部一致（架构与字段清单匹配）
- [x] 单一 spec 范围（一个模块 + 一个 fixture）
- [x] 无歧义（每个字段名有明确类型）

请陛下复核 spec，确认无误后我调 `writing-plans` skill 出实施计划。
