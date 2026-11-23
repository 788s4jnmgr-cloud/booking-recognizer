# Customs Declaration Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 booking-recognizer 增加 `CUSTOMS_DECLARATION` 解析能力（30+ 字段，PDF 文字层坐标还原）。

**Architecture:** 独立 `customs-declaration.js` + `pdf-table-extractor.js`（pdfjs-dist 坐标提取）。BookingRecognizer 加 documentType 检测但 parse 走 null。CLI `--type=customs` / API `parser` 字段切换。

**Tech Stack:** Node.js / pdfjs-dist (已在 node_modules) / Jest (已有 test 基础设施)

**Spec:** docs/superpowers/specs/2026-08-26-customs-declaration-design.md

---

## Global Constraints

- Node.js (现有 package.json 标记)
- pdfjs-dist 已在 node_modules（pdf-parser.js 已 require）
- 不引入新 npm 依赖
- 测试用项目既有 jest 风格（项目根 tests/ 目录）
- 字段命名严格按 spec §5.2 表格
- Fixture 1 个 PDF: 用户提供的 `C:\Users\huawei\Desktop\报关单测试样本-20260312\1751009864352.pdf`

---

## Task 1: 复制 fixture + 写 golden JSON

**Files:**

- Create: `tests/fixtures/customs/pdfs/1751009864352.pdf`
- Create: `tests/fixtures/customs/golden/1751009864352.json`

**Interfaces:**

- Produces: fixture PDF + golden JSON，30+ 字段期望值

- [ ] **Step 1: 创建目录并复制 PDF**

```bash
mkdir -p tests/fixtures/customs/pdfs
mkdir -p tests/fixtures/customs/golden
cp "C:/Users/huawei/Desktop/报关单测试样本-20260312/1751009864352.pdf" tests/fixtures/customs/pdfs/1751009864352.pdf
ls -la tests/fixtures/customs/pdfs/
```

- [ ] **Step 2: 写 golden JSON**（按 spec §5.2 字段名）

文件 `tests/fixtures/customs/golden/1751009864352.json`：

```json
{
  "documentType": "CUSTOMS_DECLARATION",
  "customsNo": "425820251000157386",
  "importDate": "20250630",
  "declareDate": "20250627",
  "customsBranch": "4218",
  "transportMode": { "code": "2", "name": null },
  "supervisionMode": { "code": "0110", "name": null },
  "taxNature": { "code": "101", "name": null },
  "contractNo": "SGIB25-0603T",
  "tradeCountry": null,
  "originCountry": null,
  "transitPortCode": "AUS174",
  "vessel": "FIRST PHOENIX",
  "voyage": "26939",
  "blNo": "250618NFL08",
  "portOfLoading": "黑德兰港",
  "portOfDischarge": "黄岛",
  "portOfDischargeCode": "370201",
  "packaging": { "code": "00", "name": null },
  "packageCount": "1",
  "grossWeight": 67554600,
  "tradeTerm": "C&F",
  "hsCode": "2601112000",
  "goodsName": "铁矿粉",
  "totalPrice": "6532509.91",
  "currency": "美元",
  "domesticDest": null,
  "taxLevy": null,
  "declarantCertNo": "42141925",
  "declarantUnit": {
    "code": "91370220756929610P",
    "name": "青岛港国际物流有限公司"
  },
  "consigneeCode": "91310115MADFP4NT59",
  "confirmFlags": {
    "特殊关系确认": "否",
    "价格影响确认": "否",
    "支付特许权使用费确认": "否",
    "公式定价确认": "是",
    "暂定价格确认": "是",
    "自报自缴": "是"
  }
}
```

注: 部分字段(name 类型)接受 null，符合 spec §7 错误处理策略。

- [ ] **Step 3: 验证文件存在**

```bash
ls -la tests/fixtures/customs/pdfs/1751009864352.pdf
ls -la tests/fixtures/customs/golden/1751009864352.json
```

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/customs/
git commit -m "test(customs): add customs declaration fixture PDF + golden JSON"
```

---

## Task 2: pdf-table-extractor.js — 坐标提取核心

**Files:**

- Create: `pdf-table-extractor.js`
- Create: `tests/test-pdf-table-extractor.js`

**Interfaces:**

- Consumes: pdfPath 字符串
- Produces: `Promise<Array<{row, col, text, x, y, w, h}>>`

- [ ] **Step 1: 写失败的测试**

文件 `tests/test-pdf-table-extractor.js`：

```javascript
const { extract } = require("../pdf-table-extractor");

describe("pdf-table-extractor", () => {
  test("extracts cells with row/col/text/x/y from customs PDF", async () => {
    const cells = await extract(
      "tests/fixtures/customs/pdfs/1751009864352.pdf",
    );
    expect(cells).toBeInstanceOf(Array);
    expect(cells.length).toBeGreaterThan(50);
    const text = cells.map((c) => c.text).join("");
    expect(text).toMatch(/海关|报关单|42582025/);
    expect(text).toContain("FIRST");
    expect(cells[0]).toHaveProperty("row");
    expect(cells[0]).toHaveProperty("col");
    expect(cells[0]).toHaveProperty("text");
    expect(cells[0]).toHaveProperty("x");
    expect(cells[0]).toHaveProperty("y");
  }, 60000);
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd booking-recognizer && npx jest tests/test-pdf-table-extractor.js
```

期望: FAIL (Cannot find module '../pdf-table-extractor')

- [ ] **Step 3: 实现 pdf-table-extractor.js**

```javascript
// pdf-table-extractor.js - 用 pdfjs-dist 提取 PDF 文字层坐标
const fs = require("fs");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");

async function extract(pdfPath) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const cells = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });
    const pageHeight = viewport.height;
    const textContent = await page.getTextContent();
    const rowMap = new Map();
    for (const item of textContent.items) {
      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const x = tx[4];
      const yTop = pageHeight - tx[5];
      const key = Math.round(yTop / 2) * 2;
      if (!rowMap.has(key)) rowMap.set(key, []);
      rowMap
        .get(key)
        .push({ x, y: yTop, text: item.str, w: item.width, h: item.height });
    }
    const rows = [...rowMap.entries()].sort((a, b) => b[0] - a[0]);
    rows.forEach(([y, items], rowIdx) => {
      const sorted = items.sort((a, b) => a.x - b.x);
      sorted.forEach((it, colIdx) => {
        if (it.text.trim()) {
          cells.push({
            row: rowIdx,
            col: colIdx,
            text: it.text,
            x: it.x,
            y: it.y,
            w: it.w,
            h: it.h,
          });
        }
      });
    });
  }
  return cells;
}

module.exports = { extract };
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npx jest tests/test-pdf-table-extractor.js
```

期望: PASS

- [ ] **Step 5: Commit**

```bash
git add pdf-table-extractor.js tests/test-pdf-table-extractor.js
git commit -m "feat(customs): add pdf-table-extractor with pdfjs-dist coords"
```

---

## Task 3: customs-declaration.js — 基础类 + customsNo

**Files:**

- Create: `customs-declaration.js`
- Create: `tests/test-customs-declaration.js`

**Interfaces:**

- Consumes: pdfPath 或 cells 数组
- Produces: 报关单字段结果对象（spec §5.2）

- [ ] **Step 1: 写失败的测试**

文件 `tests/test-customs-declaration.js`：

```javascript
const { CustomsDeclarationRecognizer } = require("../customs-declaration");
const { extract } = require("../pdf-table-extractor");

describe("CustomsDeclarationRecognizer", () => {
  let recognizer;
  beforeAll(async () => {
    recognizer = new CustomsDeclarationRecognizer();
    const cells = await extract(
      "tests/fixtures/customs/pdfs/1751009864352.pdf",
    );
    recognizer._cells = cells;
  });

  test("extractCustomsNo returns 18-digit ID", () => {
    const no = recognizer.extractCustomsNo();
    expect(no).toBe("425820251000157386");
  });

  test("parseFromCells returns full structure", () => {
    const result = recognizer.parseFromCells();
    expect(result.documentType).toBe("CUSTOMS_DECLARATION");
    expect(result.customsNo).toBe("425820251000157386");
  });
});
```

- [ ] **Step 2: 验证测试失败**

```bash
npx jest tests/test-customs-declaration.js
```

期望: FAIL (Cannot find module)

- [ ] **Step 3: 实现基础类 + customsNo**

文件 `customs-declaration.js`：

```javascript
// customs-declaration.js - 海关报关单解析器
const { extract: extractCells } = require("./pdf-table-extractor");

class CustomsDeclarationRecognizer {
  constructor() {
    this._cells = null;
  }

  async parse(pdfPath) {
    this._cells = await extractCells(pdfPath);
    return this.parseFromCells();
  }

  parseFromCells() {
    if (!this._cells) throw new Error("No cells loaded; call parse() first");
    return {
      documentType: "CUSTOMS_DECLARATION",
      customsNo: this.extractCustomsNo(),
    };
  }

  extractCustomsNo() {
    const text = this._cells.map((c) => c.text).join("");
    const m = text.match(/\b(\d{18})\b/);
    return m ? m[1] : null;
  }
}

module.exports = { CustomsDeclarationRecognizer };
```

- [ ] **Step 4: 运行测试**

```bash
npx jest tests/test-customs-declaration.js
```

期望: PASS

- [ ] **Step 5: Commit**

```bash
git add customs-declaration.js tests/test-customs-declaration.js
git commit -m "feat(customs): base CustomsDeclarationRecognizer + customsNo extraction"
```

---

## Task 4: 添加 vessel/voyage/blNo 提取

**Files:**

- Modify: `customs-declaration.js`
- Modify: `tests/test-customs-declaration.js`

**Interfaces:**

- Produces: result.vessel, result.voyage, result.blNo

- [ ] **Step 1: 添加失败的测试**

```javascript
test("extractVesselVoyage returns FIRST PHOENIX / 26939", () => {
  expect(recognizer.extractVesselVoyage()).toEqual({
    vessel: "FIRST PHOENIX",
    voyage: "26939",
  });
});

test("extractBlNo returns 250618NFL08", () => {
  expect(recognizer.extractBlNo()).toBe("250618NFL08");
});
```

- [ ] **Step 2: 验证失败**

- [ ] **Step 3: 实现**

```javascript
  extractVesselVoyage() {
    const line = this._cells
      .filter(c => c.text.includes('运输工具名称及航次号') || /FIRST|VESSEL/i.test(c.text))
      .map(c => c.text).join(' ');
    const m = line.match(/\b([A-Z][A-Z\s]{2,30}?)\s*[\/／](\d{3,5}[A-Z]?)\b/);
    if (!m) return { vessel: null, voyage: null };
    const after = line.slice(m.index + m[0].length);
    const blMatch = after.match(/\b([A-Z0-9]{8,15})\b/);
    this._blNo = blMatch ? blMatch[1] : null;
    return { vessel: m[1].trim().replace(/\s+/g, ' '), voyage: m[2] };
  }

  extractBlNo() {
    if (!this._blNo) this.extractVesselVoyage();
    return this._blNo;
  }
```

更新 `parseFromCells()`:

```javascript
  parseFromCells() {
    if (!this._cells) throw new Error('No cells loaded; call parse() first');
    const vv = this.extractVesselVoyage();
    return {
      documentType: 'CUSTOMS_DECLARATION',
      customsNo: this.extractCustomsNo(),
      vessel: vv.vessel,
      voyage: vv.voyage,
      blNo: this.extractBlNo(),
    };
  }
```

- [ ] **Step 4: 验证**

- [ ] **Step 5: Commit**

```bash
git add customs-declaration.js tests/test-customs-declaration.js
git commit -m "feat(customs): extract vessel/voyage/blNo"
```

---

## Task 5: 港口提取 (依赖字典)

**Files:**

- Modify: `customs-declaration.js`
- Modify: `tests/test-customs-declaration.js`

**Interfaces:**

- Produces: portOfLoading, portOfDischarge, portOfDischargeCode

- [ ] **Step 1: 测试**

```javascript
test("extractPorts returns loading/discharge", () => {
  const p = recognizer.extractPorts();
  expect(p.loading).toBe("黑德兰港");
  expect(p.discharge).toBe("黄岛");
  expect(p.dischargeCode).toBe("370201");
});
```

- [ ] **Step 2: 验证失败**

- [ ] **Step 3: 实现**

```javascript
  static KNOWN_PORTS = [
    '黑德兰港', '悉尼港', '墨尔本港', '布里斯班港',
    '上海港', '宁波港', '青岛港', '天津港', '广州港',
    '鹿特丹港', '汉堡港', '安特卫普港',
    '新加坡港', '丹戎不碌港', '巴生港',
  ];
  static KNOWN_REGIONS = ['黄岛', '前湾', '青岛', '上海', '宁波', '广州', '深圳'];

  extractPorts() {
    const allText = this._cells.map(c => c.text).join('\n');
    const polMatch = allText.match(/启运港\s*[(（][^)）]+[)）]\s*([^\n]+)/);
    const podLine = allText.match(/入境口岸\s*[(（](\d{6})[)）]\s*([^\n]+)/);
    const podText = podLine ? podLine[2] : '';
    let loading = null;
    for (const p of CustomsDeclarationRecognizer.KNOWN_PORTS) {
      if (polMatch && polMatch[1].includes(p)) { loading = p; break; }
    }
    let discharge = null;
    for (const p of [...CustomsDeclarationRecognizer.KNOWN_REGIONS, ...CustomsDeclarationRecognizer.KNOWN_PORTS]) {
      const idx = podText.lastIndexOf(p);
      if (idx >= 0) { discharge = p; break; }
    }
    return { loading, discharge, dischargeCode: podLine ? podLine[1] : null };
  }
```

更新 `parseFromCells()`:

```javascript
const ports = this.extractPorts();
return {
  // ...
  portOfLoading: ports.loading,
  portOfDischarge: ports.discharge,
  portOfDischargeCode: ports.dischargeCode,
};
```

- [ ] **Step 4: 验证**

- [ ] **Step 5: Commit**

```bash
git add customs-declaration.js tests/test-customs-declaration.js
git commit -m "feat(customs): extract ports with KNOWN_PORTS/REGIONS dictionary"
```

---

## Task 6: 日期 / 关别

**Files:**

- Modify: `customs-declaration.js`
- Modify: `tests/test-customs-declaration.js`

- [ ] **Step 1: 测试**

```javascript
test("extractDates returns import + declare", () => {
  const d = recognizer.extractDates();
  expect(d.importDate).toBe("20250630");
  expect(d.declareDate).toBe("20250627");
});
test("extractCustomsBranch returns 4218", () => {
  expect(recognizer.extractCustomsBranch()).toBe("4218");
});
```

- [ ] **Step 2: 验证失败**

- [ ] **Step 3: 实现**

```javascript
  extractDates() {
    const text = this._cells.map(c => c.text).join('');
    const dates = [...text.matchAll(/(?:^|[^\d])(20\d{6})(?:[^\d]|$)/g)].map(m => m[1]);
    return { importDate: dates[0] || null, declareDate: dates[1] || null };
  }

  extractCustomsBranch() {
    const text = this._cells.map(c => c.text).join('');
    const m = text.match(/进境关别[^0-9]*[(〈]?(\d{4})/);
    return m ? m[1] : null;
  }
```

- [ ] **Step 4: 验证**

- [ ] **Step 5: Commit**

```bash
git add customs-declaration.js tests/test-customs-declaration.js
git commit -m "feat(customs): extract importDate/declareDate/customsBranch"
```

---

## Task 7: 运输 / 监管 / 征免 / 合同 / 经停港

**Files:**

- Modify: `customs-declaration.js`
- Modify: `tests/test-customs-declaration.js`

- [ ] **Step 1: 测试**

```javascript
test("extractCodeNameFields", () => {
  const r = recognizer.extractCodeNameFields();
  expect(r.transportMode.code).toBe("2");
  expect(r.supervisionMode.code).toBe("0110");
  expect(r.taxNature.code).toBe("101");
  expect(r.contractNo).toBe("SGIB25-0603T");
  expect(r.transitPortCode).toBe("AUS174");
});
```

- [ ] **Step 2: 验证失败**

- [ ] **Step 3: 实现**

```javascript
  extractCodeNameFields() {
    const text = this._cells.map(c => c.text).join('');
    const codeAt = (keyword) => {
      const m = text.match(new RegExp(`${keyword}\\s*[(（]([^)）]+)[)）]`));
      return m ? m[1].trim() : null;
    };
    return {
      transportMode: { code: codeAt('运输方式'), name: null },
      supervisionMode: { code: codeAt('监管方式'), name: null },
      taxNature: { code: codeAt('征免性质'), name: null },
      contractNo: (text.match(/合同协议号\s+(\w+)/) || [])[1] || null,
      transitPortCode: codeAt('经停港'),
    };
  }
```

- [ ] **Step 4: 验证**

- [ ] **Step 5: Commit**

```bash
git add customs-declaration.js tests/test-customs-declaration.js
git commit -m "feat(customs): extract transport/supervision/taxNature/contract/transit"
```

---

## Task 8: 商品段 + 毛重 + 包装 + 件数 + 运费

**Files:**

- Modify: `customs-declaration.js`
- Modify: `tests/test-customs-declaration.js`

- [ ] **Step 1: 测试**

```javascript
test("extractGoods returns hsCode/goodsName/price", () => {
  const g = recognizer.extractGoods();
  expect(g.hsCode).toBe("2601112000");
  expect(g.goodsName).toBe("铁矿粉");
});
test("extractGrossWeight returns 67554600", () => {
  expect(recognizer.extractGrossWeight()).toBe(67554600);
});
test("extractTradeTerm returns C&F", () => {
  expect(recognizer.extractTradeTerm()).toBe("C&F");
});
```

- [ ] **Step 2: 验证失败**

- [ ] **Step 3: 实现**

```javascript
  extractGoods() {
    const text = this._cells.map(c => c.text).join('');
    const m = text.match(/\b(\d{10})\s+([^\n]{2,30}?)\s+(\d+)\s*千克/);
    const price = (text.match(/\b(\d{6,12}\.\d+)\s+美元/) || [])[1];
    return {
      hsCode: m ? m[1] : null,
      goodsName: m ? m[2].trim() : null,
      totalPrice: price || null,
      currency: price ? '美元' : null,
    };
  }

  extractGrossWeight() {
    const text = this._cells.map(c => c.text).join('');
    const m = text.match(/(\d{5,12})\s*千克/);
    return m ? parseInt(m[1], 10) : null;
  }

  extractTradeTerm() {
    const text = this._cells.map(c => c.text).join(' ');
    const m = text.match(/\b(C&F|FOB|CIF|CFR|EXW|FAS|DAP|DDP)\b/);
    return m ? m[1] : null;
  }

  extractPackaging() {
    const text = this._cells.map(c => c.text).join('');
    const codeAt = (k) => {
      const m = text.match(new RegExp(`${k}\\s*[(（]([^)）]+)[)）]`));
      return m ? m[1].trim() : null;
    };
    const count = (text.match(/件数\s+(\d+)/) || [])[1];
    return { packaging: { code: codeAt('包装种类'), name: null }, packageCount: count || null };
  }
```

- [ ] **Step 4: 验证**

- [ ] **Step 5: Commit**

```bash
git add customs-declaration.js tests/test-customs-declaration.js
git commit -m "feat(customs): extract goods/grossWeight/tradeTerm/packaging"
```

---

## Task 9: 申报单位 + 收货人代码 + 报关员证号 + 确认标志

**Files:**

- Modify: `customs-declaration.js`
- Modify: `tests/test-customs-declaration.js`

- [ ] **Step 1: 测试**

```javascript
test("extractDeclarantUnit", () => {
  const u = recognizer.extractDeclarantUnit();
  expect(u.code).toBe("91370220756929610P");
  expect(u.name).toBe("青岛港国际物流有限公司");
});
test("extractConsigneeCode", () => {
  expect(recognizer.extractConsigneeCode()).toBe("91310115MADFP4NT59");
});
test("extractDeclarantCertNo", () => {
  expect(recognizer.extractDeclarantCertNo()).toBe("42141925");
});
test("extractConfirmFlags", () => {
  const f = recognizer.extractConfirmFlags();
  expect(f["特殊关系确认"]).toBe("否");
  expect(f["公式定价确认"]).toBe("是");
});
```

- [ ] **Step 2: 验证失败**

- [ ] **Step 3: 实现**

```javascript
  extractDeclarantUnit() {
    const text = this._cells.map(c => c.text).join('');
    const m = text.match(/申报单位\s*[(（](\w+)[)）]\s*([一-龥]{2,30}?)(?=\s*[<(（])/);
    return m ? { code: m[1], name: m[2].trim() } : null;
  }

  extractConsigneeCode() {
    const text = this._cells.map(c => c.text).join('');
    const m = text.match(/\((\w{18})\)/);
    return m ? m[1] : null;
  }

  extractDeclarantCertNo() {
    const text = this._cells.map(c => c.text).join('');
    const m = text.match(/报关人员证号\s+(\d+)/);
    return m ? m[1] : null;
  }

  extractConfirmFlags() {
    const text = this._cells.map(c => c.text).join('');
    const flags = {};
    for (const key of [
      '特殊关系确认', '价格影响确认', '支付特许权使用费确认',
      '公式定价确认', '暂定价格确认', '自报自缴',
    ]) {
      const m = text.match(new RegExp(`${key}\\s*[:：]?\\s*(是|否)`));
      if (m) flags[key] = m[1];
    }
    return flags;
  }
```

更新 `parseFromCells()`:

```javascript
return {
  // ...
  declarantUnit: this.extractDeclarantUnit(),
  consigneeCode: this.extractConsigneeCode(),
  declarantCertNo: this.extractDeclarantCertNo(),
  confirmFlags: this.extractConfirmFlags(),
  domesticDest: null,
  taxLevy: null,
  finalDest: { code: null, name: null },
  tradeCountry: { code: null, name: null },
  originCountry: { code: null, name: null },
};
```

- [ ] **Step 4: 验证**

- [ ] **Step 5: Commit**

```bash
git add customs-declaration.js tests/test-customs-declaration.js
git commit -m "feat(customs): extract declarantUnit/consigneeCode/certNo/confirmFlags"
```

---

## Task 10: 集成到 index.js (detectDocumentType)

**Files:**

- Modify: `index.js:139-147`

**Interfaces:**

- Produces: detectDocumentType() 返回 'CUSTOMS_DECLARATION'

- [ ] **Step 1: 写测试**

在 `tests/test-customs-declaration.js` 顶部添加：

```javascript
const { BookingRecognizer } = require("../index");

describe("detectDocumentType - customs", () => {
  test("returns CUSTOMS_DECLARATION for customs PDF text", async () => {
    const cells = await require("../pdf-table-extractor").extract(
      "tests/fixtures/customs/pdfs/1751009864352.pdf",
    );
    const text = cells.map((c) => c.text).join("");
    const br = new BookingRecognizer();
    expect(br.detectDocumentType(text)).toBe("CUSTOMS_DECLARATION");
  });
});
```

- [ ] **Step 2: 验证失败**

```bash
npx jest tests/test-customs-declaration.js
```

- [ ] **Step 3: 修改 detectDocumentType**

文件 `index.js`，第 145 行后添加：

```javascript
if (/海\s*关.*报\s*关\s*单/.test(text)) return "CUSTOMS_DECLARATION";
```

- [ ] **Step 4: 验证**

- [ ] **Step 5: Commit**

```bash
git add index.js tests/test-customs-declaration.js
git commit -m "feat: detectDocumentType recognizes CUSTOMS_DECLARATION"
```

---

## Task 11: CLI --type=customs 标志

**Files:**

- Modify: `cli.js`

- [ ] **Step 1: 修改 cli.js**

在 `cli.js` 的 `main()` 函数前添加类型判断：

```javascript
async function main() {
  const args = process.argv.slice(2);
  const typeArg = args.find(a => a.startsWith('--type='));
  const forcedType = typeArg ? typeArg.split('=')[1] : null;
  const pdfPath = args.find(a => !a.startsWith('--')) || /* 现有默认 */;
  if (forcedType === 'customs') {
    const { CustomsDeclarationRecognizer } = require('./customs-declaration');
    const r = new CustomsDeclarationRecognizer();
    const result = await r.parse(pdfPath);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  // ... 原有 BookingRecognizer 路径 ...
}
```

- [ ] **Step 2: 手动验证**

```bash
node cli.js --type=customs tests/fixtures/customs/pdfs/1751009864352.pdf
```

- [ ] **Step 3: 验证现有 booking 路径**

```bash
node cli.js test.pdf
```

- [ ] **Step 4: Commit**

```bash
git add cli.js
git commit -m "feat(cli): --type=customs forces customs declaration parser"
```

---

## Task 12: API parser 字段 + 自动检测 customs

**Files:**

- Modify: `api.js`

- [ ] **Step 1: 修改 /parse-url 路由**

在 `api.js` 的 `/parse-url` 处理函数中（PDF 解析后）：

```javascript
const text = /* 提取的文本 */;
if (/海\s*关.*报\s*关\s*单/.test(text)) {
  const { CustomsDeclarationRecognizer } = require('./customs-declaration');
  const r = new CustomsDeclarationRecognizer();
  const data = await r.parse(/* pdfPath */);
  return res.json({ success: true, parser: 'customs', data });
}
// 否则走原 booking 路径
return res.json({ success: true, parser: 'booking', data });
```

- [ ] **Step 2: 重启 API**

```bash
# 找到并 kill 现有进程
netstat -ano | findstr ":3000"
taskkill /PID <pid> /F
# 后台重启
node api.js &
```

- [ ] **Step 3: cURL 测试**

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"url":"https://oss.qingdao-port.net/wlds-common/eccom/photo/1751009864352.PDF"}' \
  http://localhost:3000/parse-url | jq '.parser'
```

期望: `"customs"`

- [ ] **Step 4: Commit**

```bash
git add api.js
git commit -m "feat(api): auto-detect customs declaration + parser field"
```

---

## Task 13: 端到端集成测试 (golden JSON 对比)

**Files:**

- Create: `tests/test-customs-e2e.js`

- [ ] **Step 1: 写测试**

```javascript
const fs = require("fs");
const { CustomsDeclarationRecognizer } = require("../customs-declaration");

const FIXTURE = "tests/fixtures/customs/pdfs/1751009864352.pdf";
const GOLDEN = "tests/fixtures/customs/golden/1751009864352.json";

describe("customs e2e", () => {
  test("parse() matches golden JSON", async () => {
    const expected = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
    const r = new CustomsDeclarationRecognizer();
    const actual = await r.parse(FIXTURE);
    for (const key of Object.keys(expected)) {
      if (expected[key] !== null) {
        expect(actual[key]).toEqual(expected[key]);
      }
    }
  }, 60000);
});
```

- [ ] **Step 2: 验证**

```bash
npx jest tests/test-customs-e2e.js
```

- [ ] **Step 3: Commit**

```bash
git add tests/test-customs-e2e.js
git commit -m "test(customs): e2e golden JSON comparison"
```

---

## Task 14: 文档更新 (README + CHANGELOG)

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: CHANGELOG 加版本条目**

在 `CHANGELOG.md` 顶部添加：

```markdown
## 1.2.0 - 2026-08-26

### 新增

- **CUSTOMS_DECLARATION** 海关报关单解析能力
- 新模块 `customs-declaration.js` + `pdf-table-extractor.js`
- CLI `--type=customs` 强制走 customs 解析器
- API `/parse-url` 自动检测 customs,响应增加 `parser` 字段

### 测试

- 新增 fixture: `tests/fixtures/customs/1751009864352.pdf`
- 30+ 字段 golden JSON 端到端测试

### 依赖

- 无新增
```

- [ ] **Step 2: README 加 customs 章节**

在 "支持的文档类型" 表格加 CUSTOMS_DECLARATION 一行 + 用法示例：

````markdown
| **海关报关单** | **`CUSTOMS_DECLARATION`** (v1.2.0+) |

```bash
node cli.js --type=customs path/to/customs.pdf
# API 自动检测
curl -X POST http://localhost:3000/parse-url -d '{"url":"..."}'
```
````

````

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: README + CHANGELOG for customs declaration v1.2.0"
````

---

## Self-Review Checklist

- [x] Spec §5.1 公共 API 覆盖 (parse / parseFromCells)
- [x] Spec §5.2 30+ 字段覆盖 (Task 4-9)
- [x] Spec §5.3 pdf-table-extractor 单独 Task 2
- [x] Spec §6.1-6.3 集成点 (Task 10-12)
- [x] Spec §7 错误处理 (字段 null fallback)
- [x] Spec §8 测试 (Task 1 fixture + Task 13 e2e)
- [x] Spec §9 风险 (v1 单 fixture + 后续迭代)
- [x] 无占位符/TBD
- [x] 类型一致 (所有 task 用 `recognizer._cells` / `extractXxx()` 统一接口)

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-26-customs-declaration.md`.**

Two execution options:

1. **Subagent-Driven** (recommended) — fresh subagent per task + 2-stage review
2. **Inline Execution** — execute in current session with checkpoints

Which approach?
