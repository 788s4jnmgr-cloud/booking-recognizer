/**
 * PaddleOCR 端到端测试 + tesseract 降级对比。
 *
 * 用法:
 *   # PaddleOCR 容器运行中时
 *   node test-paddle.js
 *
 *   # 强制走 tesseract(降级路径)
 *   PADDLE_ENABLED=false node test-paddle.js
 *
 *   # 模拟 PaddleOCR 不可用
 *   PADDLE_OCR_URL=http://127.0.0.1:1/ocr node test-paddle.js
 *
 * 流程:
 *   1. 用 @napi-rs/canvas 生成一张含中英文订舱信息的 PNG
 *   2. 调 PaddleOCR(若可用)
 *   3. 同时调 tesseract.js 作对比
 *   4. 输出两个引擎的耗时/置信度/识别文本
 *   5. (PaddleOCR 可用时) 断言: 至少一个引擎命中关键字
 */

'use strict';

const fs = require('fs');
const path = require('path');

async function main() {
  let Canvas;
  try {
    // eslint-disable-next-line global-require
    Canvas = require('@napi-rs/canvas');
  } catch (e) {
    console.error('❌ @napi-rs/canvas 未安装,无法生成测试图');
    process.exit(1);
  }

  const { createCanvas } = Canvas;
  const UPLOADS_DIR = path.join(__dirname, 'uploads');
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  // 1. 生成测试图
  const W = 800, H = 400;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'black';
  ctx.font = 'bold 26px sans-serif';
  const lines = [
    'MAERSK SYDNEY',
    'Voyage: 624W',
    'BL: HLCUSZX2606BNTH9',
    'Containers: 3 x 20GP',
    'Weight: 54000 KGM',
  ];
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], 30, 50 + i * 36);
  }
  const testImg = path.join(UPLOADS_DIR, 'paddle-test.png');
  const pngBuf = canvas.toBuffer('image/png');
  fs.writeFileSync(testImg, pngBuf);
  const b64 = pngBuf.toString('base64');
  console.log(`✅ 生成测试图: ${testImg} (${pngBuf.length} bytes)`);

  // 2. PaddleOCR
  // eslint-disable-next-line global-require
  const paddle = require('./paddle-client');
  const paddleAvailable = await paddle.isPaddleAvailable();
  console.log(`\n📡 PaddleOCR 可用: ${paddleAvailable ? '✅' : '❌'}`);
  console.log(`   URL: ${paddle._PADDLE_OCR_URL}`);
  console.log(`   TIMEOUT: ${paddle._PADDLE_TIMEOUT_MS}ms`);

  let paddleResult = null;
  if (paddleAvailable) {
    const t0 = Date.now();
    paddleResult = await paddle.recognizeImages([b64], { lang: 'ch', merge_lines: true });
    const elapsed = Date.now() - t0;
    console.log(
      `\n🔍 PaddleOCR 耗时: ${elapsed}ms, success: ${paddleResult.success}, engine: ${paddleResult.engine}`
    );
    if (paddleResult.success) {
      const full = paddleResult.fullText || '';
      console.log(`   文本: ${JSON.stringify(full).slice(0, 200)}`);
    } else {
      console.log(`   错误: ${paddleResult.error}`);
    }
  }

  // 3. tesseract 对比
  console.log(`\n🔍 调 tesseract.js 作对比 ...`);
  // eslint-disable-next-line global-require
  const Tesseract = require('tesseract.js');
  const t0 = Date.now();
  const { data: tessData } = await Tesseract.recognize(pngBuf, 'eng+chi_sim', { logger: () => {} });
  const tessElapsed = Date.now() - t0;
  const tessText = (tessData.text || '').trim();
  console.log(`   tesseract 耗时: ${tessElapsed}ms, 置信度: ${tessData.confidence?.toFixed(1)}%`);
  console.log(`   文本: ${JSON.stringify(tessText).slice(0, 200)}`);

  // 4. 校验: 至少一个引擎命中关键字
  const keywords = ['MAERSK', 'VOYAGE', 'BL', 'HLCU', 'CONTAINER'];
  const paddleUpper = ((paddleResult && paddleResult.fullText) || '').toUpperCase();
  const tessUpper = tessText.toUpperCase();
  const paddleHit = keywords.some((k) => paddleUpper.includes(k));
  const tessHit = keywords.some((k) => tessUpper.includes(k));
  console.log(`\n📊 关键字命中:`);
  console.log(`   PaddleOCR: ${paddleHit ? '✅' : paddleResult ? '❌' : '⏭ 跳过'}`);
  console.log(`   tesseract: ${tessHit ? '✅' : '❌'}`);

  // 5. 清理
  try {
    fs.unlinkSync(testImg);
  } catch (_) {
    /* ignore */
  }

  if (!paddleHit && !tessHit) {
    console.error('\n❌ 两个引擎都未识别出关键字');
    process.exit(1);
  }
  console.log('\n✅ 测试通过');
}

main().catch((err) => {
  console.error('💥 测试异常:', err);
  process.exit(1);
});
