/**
 * OCR 端到端测试
 * 1. 用 canvas 生成一张含中英文的测试图
 * 2. 用 tesseract.js 跑识别（eng + chi_sim）
 * 3. 打印识别结果 + 置信度
 */

const fs = require('fs');
const path = require('path');
const Tesseract = require('tesseract.js');

let Canvas;
try {
  Canvas = require('@napi-rs/canvas');
} catch (e) {
  console.error('❌ 缺少 @napi-rs/canvas，请先 npm install @napi-rs/canvas');
  process.exit(1);
}

async function main() {
  // ===== 1. 生成测试图 =====
  const width = 800, height = 400;
  const canvas = Canvas.createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // 白底
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // 英文行
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText('MAERSK SYDNEY', 50, 80);
  ctx.font = '24px sans-serif';
  ctx.fillText('Voyage: 624W   BL: HLCUSZX2606BNTH9', 50, 130);
  ctx.fillText('Containers: 3 x 20GP  Weight: 54000 KGM', 50, 170);

  // 中文行
  ctx.font = 'bold 32px sans-serif';
  ctx.fillText('订舱确认书 - 赫伯罗特船务', 50, 230);
  ctx.font = '24px sans-serif';
  ctx.fillText('起运港：青岛  目的港：黑角（刚果布）', 50, 280);
  ctx.fillText('ETD: 2026-06-14  ETA: 2026-07-21', 50, 320);

  const pngBuffer = canvas.toBuffer('image/png');
  const testImg = path.join(__dirname, 'uploads', 'ocr-test.png');
  fs.writeFileSync(testImg, pngBuffer);
  console.log(`📷 已生成测试图: ${testImg}  (${pngBuffer.length} bytes)`);

  // ===== 2. 跑 OCR (eng) =====
  console.log('\n🔍 正在跑 OCR [eng] ...');
  const t0 = Date.now();
  const engResult = await Tesseract.recognize(pngBuffer, 'eng', {
    logger: m => process.stdout.write(`  eng ${m.status} ${Math.round(m.progress * 100)}%\r`),
  });
  console.log(`\n✅ eng 识别完成 (${Date.now() - t0}ms)，置信度: ${(engResult.data.confidence).toFixed(1)}%`);
  console.log('--- 英文识别结果 ---');
  console.log(engResult.data.text.trim());
  console.log();

  // ===== 3. 跑 OCR (chi_sim) =====
  console.log('🔍 正在跑 OCR [chi_sim] ...');
  const t1 = Date.now();
  const chiResult = await Tesseract.recognize(pngBuffer, 'chi_sim', {
    logger: m => process.stdout.write(`  chi ${m.status} ${Math.round(m.progress * 100)}%\r`),
  });
  console.log(`\n✅ chi_sim 识别完成 (${Date.now() - t1}ms)，置信度: ${(chiResult.data.confidence).toFixed(1)}%`);
  console.log('--- 中文识别结果 ---');
  console.log(chiResult.data.text.trim());
  console.log();

  // ===== 4. 跑 OCR (eng+chi_sim 联合) =====
  console.log('🔍 正在跑 OCR [eng+chi_sim] ...');
  const t2 = Date.now();
  const bothResult = await Tesseract.recognize(pngBuffer, 'eng+chi_sim', {
    logger: m => process.stdout.write(`  both ${m.status} ${Math.round(m.progress * 100)}%\r`),
  });
  console.log(`\n✅ eng+chi_sim 识别完成 (${Date.now() - t2}ms)，置信度: ${(bothResult.data.confidence).toFixed(1)}%`);
  console.log('--- 中英联合识别结果 ---');
  console.log(bothResult.data.text.trim());

  // ===== 5. 清理 =====
  try { fs.unlinkSync(testImg); } catch {}
  console.log('\n🧹 测试图已清理');
}

main().catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
