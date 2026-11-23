#!/usr/bin/env node
/**
 * 订舱识别 CLI 工具
 * 用法: node cli.js <文件路径>
 * 支持 PDF / Word (.docx) / PNG / JPG / JPEG 文件
 */

const path = require('path');
const fs = require('fs');
const { BookingRecognizer } = require('./index');
const { extractTextFromPDF, extractTextFromWord } = require('./pdf-parser');
const { recognizeImages } = require('./paddle-client');

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg']);

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.log('用法: node cli.js <文件路径>');
    console.log('示例:');
    console.log('  node cli.js "./docs/booking-note.pdf"');
    console.log('  node cli.js "./docs/booking-note.docx"');
    console.log('  node cli.js "./photos/booking.png"     (图片走 PaddleOCR + tesseract 降级)');
    process.exit(1);
  }

  const ext = path.extname(filePath).toLowerCase();

  try {
    let text;
    let engine = 'text-extraction';

    if (ext === '.pdf') {
      console.log('正在解析 PDF...');
      text = await extractTextFromPDF(filePath);
    } else if (ext === '.docx' || ext === '.doc') {
      console.log('正在解析 Word 文件...');
      text = await extractTextFromWord(filePath);
    } else if (IMAGE_EXTS.has(ext)) {
      console.log('正在识别图片( PaddleOCR + tesseract 降级)...');
      if (!fs.existsSync(filePath)) {
        console.error('文件不存在:', filePath);
        process.exit(1);
      }
      const buf = fs.readFileSync(filePath);
      if (buf.length > 50 * 1024 * 1024) {
        console.error('文件过大(最大 50MB)');
        process.exit(1);
      }
      // 简单魔数校验
      const isPng = buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50;
      const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
      if (!isPng && !isJpg) {
        console.error('无效的图片格式(仅支持 PNG/JPG/JPEG)');
        process.exit(1);
      }
      const result = await recognizeImages([buf.toString('base64')], {
        lang: 'ch',
        tesseractLang: 'eng+chi_sim',
        merge_lines: true,
      });
      if (!result.success) {
        console.error('图片识别失败:', result.error);
        process.exit(1);
      }
      text = result.fullText || '';
      engine = result.engine;
      console.log(`(引擎: ${engine})`);
    } else {
      console.error('不支持的文件格式,请使用 PDF / Word (.docx/.doc) / PNG / JPG / JPEG');
      process.exit(1);
    }

    console.log('\n--- 原始文本(前 500 字符)---');
    console.log(text.substring(0, 500) + (text.length > 500 ? '...' : ''));

    const recognizer = new BookingRecognizer();
    const result = recognizer.parse(text);

    console.log('\n=== 识别结果 ===');
    console.log(`文档类型: ${result.documentType}`);
    console.log(`订舱号: ${result.bookingNo || 'N/A'}`);
    console.log(`文件号: ${result.fileNo || 'N/A'}`);
    console.log(`B/L号: ${result.blNo || 'N/A'}`);
    console.log(`船名: ${result.vessel || 'N/A'}`);
    console.log(`航次: ${result.voyage || 'N/A'}`);
    console.log(`起运港: ${result.portOfLoading || 'N/A'}`);
    console.log(`目的港: ${result.portOfDischarge || 'N/A'}`);
    console.log(`集装箱: ${JSON.stringify(result.containers)}`);
    console.log(`毛重: ${result.grossWeight !== null ? result.grossWeight + ' KGS' : 'N/A'}`);
    console.log(`体积: ${result.volume !== null ? result.volume + ' M3' : 'N/A'}`);
    console.log(`ETA: ${result.eta || 'N/A'}`);
    console.log(`运费: ${result.freight || 'N/A'}`);

    console.log('\n=== 标准格式 ===');
    console.log(recognizer.toStandardFormat(result));

  } catch (error) {
    console.error('错误:', error.message);
    process.exit(1);
  }
}

main();

