#!/usr/bin/env node
/**
 * 订舱识别 CLI 工具
 * 用法: node cli.js <文件路径>
 * 支持 PDF 和 Word (.docx) 文件
 */

const path = require('path');
const { BookingRecognizer } = require('./index');
const { extractTextFromPDF, extractTextFromWord } = require('./pdf-parser');

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.log('用法: node cli.js <文件路径>');
    console.log('示例: node cli.js "./docs/booking-note.pdf"');
    console.log('      node cli.js "./docs/booking-note.docx"');
    process.exit(1);
  }

  const ext = path.extname(filePath).toLowerCase();

  try {
    let text;
    if (ext === '.pdf') {
      console.log('正在解析 PDF...');
      text = await extractTextFromPDF(filePath);
    } else if (ext === '.docx') {
      console.log('正在解析 Word 文件...');
      text = await extractTextFromWord(filePath);
    } else {
      console.error('不支持的文件格式，请使用 PDF 或 Word (.docx) 文件');
      process.exit(1);
    }

    console.log('\n--- 原始文本 ---');
    console.log(text.substring(0, 500) + '...');

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
