// 批量生成 4 个入货通知 golden JSON fixture
// 从 tests/fixtures/ocr/*.txt 读 OCR 文本,跑 BookingRecognizer,写 tests/fixtures/golden/*.json
const fs = require('fs');
const path = require('path');
const { BookingRecognizer } = require('./index');

const ROOT = path.join(__dirname, 'tests', 'fixtures');
const OCR_DIR = path.join(ROOT, 'ocr');
const GOLDEN_DIR = path.join(ROOT, 'golden');

if (!fs.existsSync(GOLDEN_DIR)) fs.mkdirSync(GOLDEN_DIR, { recursive: true });

const fixtures = fs.readdirSync(OCR_DIR).filter(f => f.endsWith('.txt'));
const recognizer = new BookingRecognizer();

console.log(`生成 ${fixtures.length} 个 golden JSON fixture\n`);

for (const file of fixtures) {
  const ocrPath = path.join(OCR_DIR, file);
  const text = fs.readFileSync(ocrPath, 'utf-8');
  const result = recognizer.parse(text);
  const std = recognizer.toStandardFormat(result);

  // 只保留关键字段(去掉 rawText,太长了)
  const compact = {
    documentType: result.documentType,
    blNo: result.blNo,
    vessel: result.vessel,
    voyage: result.voyage,
    portOfLoading: result.portOfLoading,
    portOfDischarge: result.portOfDischarge,
    containers: result.containers,
    grossWeight: result.grossWeight,
    etd: result.etd,
    standardFormat: std
  };

  const goldenPath = path.join(GOLDEN_DIR, file.replace('.txt', '.json'));
  fs.writeFileSync(goldenPath, JSON.stringify(compact, null, 2) + '\n', 'utf-8');
  console.log(`  ${file} → ${path.basename(goldenPath)}`);
  console.log(`    标准格式: ${std}`);
}

console.log('\n✓ 全部 golden fixture 生成完成');
