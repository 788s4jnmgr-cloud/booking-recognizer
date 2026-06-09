# 入货通知 OCR 测试 Fixture

5 个不同变体的入货通知 / booking confirmation 文档,作为 `BookingRecognizer` 的回归测试基准。前 4 张是中文入货通知图(走 PaddleOCR),第 5 张是英文 PDF booking confirmation(自带文本层,走 pdf-parse)。

## 目录结构

```
tests/fixtures/
├── images/                       入货通知图(28~46KB,4 张 PNG)
│   ├── notice-1-space-separated.png    中文空格分隔,船名航次:船名 航次
│   ├── notice-2-slash-labels.png       中文斜杠标签,船名/航次:船名/航次
│   ├── notice-3-inline-bl.png          提单号行 + 2*40HC 同行,船名航次连写
│   └── notice-4-uppercase-x.png        1X40HC 大写 X 字符
├── pdfs/                         源 PDF(自带文本层,走 pdf-parse,不走 PaddleOCR)
│   └── notice-5-mixed-types.pdf        Hapag-Lloyd booking confirmation,混箱型 2x45GP+1x22GP
├── ocr/                          每行一个识别行(PaddleOCR 输出 / pdf-parse 抽文本)
│   ├── notice-1-space-separated.txt
│   ├── notice-2-slash-labels.txt
│   ├── notice-3-inline-bl.txt
│   ├── notice-4-uppercase-x.txt
│   └── notice-5-mixed-types.txt
└── golden/                       BookingRecognizer 抽出的结构化字段(去 rawText)
    ├── notice-1-space-separated.json
    ├── notice-2-slash-labels.json
    ├── notice-3-inline-bl.json
    ├── notice-4-uppercase-x.json
    └── notice-5-mixed-types.json
```

## 4 张图 + 1 张 PDF 覆盖的变体

| # | 来源 | 变体特征 | 关键字段(OCR 置信度) | 标准格式 |
|---|------|---------|---------|---------|
| 1 | PNG(中文入货通知) | 船名航次:船名 空格 航次<br>1*40HQ | 船名 1.00 / 航次 0.94 / 卸货港 0.98 | `ZHONGGUYIN CHUAN-25028W-FQDON00309-1-40HC` |
| 2 | PNG(中文入货通知) | 船名/航次:船名/航次<br>40HC×2 | 船名 0.96 / POL 0.98 / POD 0.95 / 箱 0.95 | `NORTHERN MATESTIC-25027W-FQDAB00206-2-40HC` |
| 3 | PNG(中文入货通知) | 船名航次:船名航次(连写)<br>提单号行+2*40HC 同行 | 船名 0.99 / 提单 0.96 / 箱 0.98 | `ZHONGGUCHENGDU-25047W-FQDON00489-2-40HC` |
| 4 | PNG(中文入货通知) | 1X40HC 大写 X | 船名 0.98 / 提单 0.96 / 卸货港 1.00 | `RACINE-26007W-FQDON00524-1-40HC` |
| 5 | **PDF(Hapag booking confirmation)** | **混箱型 2×45GP + 1×22GP**<br>明细行 40' HC / 20' GP / 40' HC<br>documentType = `BILL_OF_LADING` | 摘要行被归一化<br>(22GP→20GP, 45GP→40HC) | `MUNKEBO MAERSK-624W-HLCUTA12605EOHA7-3-2x40HC+1x20GP` |

## Golden JSON 字段说明

每个 `*.json` 包含:
- `documentType` — 文档类型(中文入货通知为 `CARGO_RECEIVING_NOTICE`;PDF fixture #5 为 `BILL_OF_LADING`)
- `blNo` — 提单号
- `vessel` — 船名
- `voyage` — 航次
- `portOfLoading` — 起运港(中文短标签体系 / UN/LOCODE)
- `portOfDischarge` — 卸货港
- `containers` — 容器数组,每个含 `sizeType`
- `grossWeight` — 毛重(整数,带 KGS 单位)
- `etd` — 开船时间(YYYY-MM-DD)
- `standardFormat` — 标准格式字符串 `船名-航次-提单号-箱量-箱型`
  - 单箱型:`...-1-40HC`
  - **混箱型(fixture #5):`...-3-2x40HC+1x20GP`**(`+` 分隔多个箱型摘要)

## 重新生成 fixture

### 重生成 OCR 文本(需本地装好 PaddleOCR):

```bash
PADDLE_PDX_MODEL_SOURCE=modelscope python generate-ocr-fixtures.py
```

### 重生成 golden JSON(用现有 OCR 文本):

```bash
node generate-golden-fixtures.js
```

### 全量重建(从图到 golden):

```bash
# 第一步(PaddleOCR,~10 分钟跑 4 张图)
PADDLE_PDX_MODEL_SOURCE=modelscope python generate-ocr-fixtures.py
# 第二步(Node 端,秒级)
node generate-golden-fixtures.js
```

## 加新 fixture 流程

### PNG(走 PaddleOCR)

1. 把新图放到 `tests/fixtures/images/`,命名格式 `notice-N-<变体>.png`
2. 改 `generate-ocr-fixtures.py` 的 `FIXTURES` 列表加一行
3. 跑两个生成脚本
4. 提交 PR,新图会被 git track(golden 是确定性输出,跨环境一致)

### PDF(自带文本层,不走 PaddleOCR)

1. 把 PDF 放到 `tests/fixtures/pdfs/`,命名格式 `notice-N-<变体>.pdf`
2. 用 `pdf-parse` 抽文本写到 `tests/fixtures/ocr/notice-N-<变体>.txt`(脚本化时可用 `node -e "const pdf=require('pdf-parse');pdf(require('fs').readFileSync('...')).then(d=>require('fs').writeFileSync('...',d.text))"` 一次完成)
3. 跑 `node generate-golden-fixtures.js` 自动生成对应 `golden/*.json`
4. 人工 review 生成的 JSON(确认 parser 输出符合预期),提交 PR

## 注意事项

- **PaddleOCR 模型升级后**,OCR 文本可能微调(置信度阈值变化、识别字符差异),需要重新生成 OCR fixture;`golden/*.json` 可能不受影响(BookingRecognizer 解析容错性强)
- **BookingRecognizer 修改后**,需要重新跑 `generate-golden-fixtures.js` 看是否还是预期输出
- **图中提到的提单号(`FQDON00309`/`FQDAB00206`/`FQDON00489`/`FQDON00524`/`HLCUTA12605EOHA7`)是真实业务的脱敏示例**,未来加新图请同步脱敏
- **混箱型归一化**(`index.js` `normalizeSizeType`):`22GP→20GP`、`22HC→20HC`、`45GP→40HC`、`40HQ→40HC`。fixture #5 的 PDF 摘要行写 `2x45GP,1x22GP`,但明细行是 `40' HIGH CUBE` / `20' GENERAL PURPOSE` / `40' HIGH CUBE`,parser 明细优先 + 归一化后输出 `2x40HC+1x20GP`