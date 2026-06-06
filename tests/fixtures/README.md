# 入货通知 OCR 测试 Fixture

4 张不同变体的入货通知(中文)入货通知图,作为 `BookingRecognizer` 的回归测试基准。

## 目录结构

```
tests/fixtures/
├── images/                       原图(28~46KB,4 张 PNG)
│   ├── notice-1-space-separated.png    中文空格分隔,船名航次:船名 航次
│   ├── notice-2-slash-labels.png       中文斜杠标签,船名/航次:船名/航次
│   ├── notice-3-inline-bl.png          提单号行 + 2*40HC 同行,船名航次连写
│   └── notice-4-uppercase-x.png        1X40HC 大写 X 字符
├── ocr/                          PaddleOCR 输出的纯文本(每行一个识别行,无置信度)
│   ├── notice-1-space-separated.txt
│   ├── notice-2-slash-labels.txt
│   ├── notice-3-inline-bl.txt
│   └── notice-4-uppercase-x.txt
└── golden/                       BookingRecognizer 抽出的结构化字段(去 rawText)
    ├── notice-1-space-separated.json
    ├── notice-2-slash-labels.json
    ├── notice-3-inline-bl.json
    └── notice-4-uppercase-x.json
```

## 4 张图覆盖的变体

| # | 变体特征 | 关键字段(OCR 置信度) | 标准格式 |
|---|---------|---------|---------|
| 1 | 船名航次:船名 空格 航次<br>1*40HQ | 船名 1.00 / 航次 0.94 / 卸货港 0.98 | `ZHONGGUYIN CHUAN-25028W-FQDON00309-1-40HC` |
| 2 | 船名/航次:船名/航次<br>40HC×2 | 船名 0.96 / POL 0.98 / POD 0.95 / 箱 0.95 | `NORTHERN MATESTIC-25027W-FQDAB00206-2-40HC` |
| 3 | 船名航次:船名航次(连写)<br>提单号行+2*40HC 同行 | 船名 0.99 / 提单 0.96 / 箱 0.98 | `ZHONGGUCHENGDU-25047W-FQDON00489-2-40HC` |
| 4 | 1X40HC 大写 X | 船名 0.98 / 提单 0.96 / 卸货港 1.00 | `RACINE-26007W-FQDON00524-1-40HC` |

## Golden JSON 字段说明

每个 `*.json` 包含:
- `documentType` — 文档类型,固定为 `CARGO_RECEIVING_NOTICE`
- `blNo` — 提单号
- `vessel` — 船名
- `voyage` — 航次
- `portOfLoading` — 起运港(中文短标签体系)
- `portOfDischarge` — 卸货港
- `containers` — 容器数组,每个含 `sizeType`
- `grossWeight` — 毛重(整数,带 KGS 单位)
- `etd` — 开船时间(YYYY-MM-DD)
- `standardFormat` — 标准格式字符串 `船名-航次-提单号-箱量-箱型`

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

1. 把新图放到 `tests/fixtures/images/`,命名格式 `notice-N-<变体>.png`
2. 改 `generate-ocr-fixtures.py` 的 `FIXTURES` 列表加一行
3. 跑两个生成脚本
4. 提交 PR,新图会被 git track(golden 是确定性输出,跨环境一致)

## 注意事项

- **PaddleOCR 模型升级后**,OCR 文本可能微调(置信度阈值变化、识别字符差异),需要重新生成 OCR fixture;`golden/*.json` 可能不受影响(BookingRecognizer 解析容错性强)
- **BookingRecognizer 修改后**,需要重新跑 `generate-golden-fixtures.js` 看是否还是预期输出
- **图中提到的提单号(`FQDON00309`/`FQDAB00206`/`FQDON00489`/`FQDON00524`)是真实业务的脱敏示例**,未来加新图请同步脱敏
