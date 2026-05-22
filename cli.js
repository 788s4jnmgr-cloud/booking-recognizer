#!/usr/bin/env node
/**
 * 订舱识别 CLI 工具
 * 用法: node cli.js <pdf文件路径>
 */

const { BookingRecognizer } = require('./index');
const { extractTextFromPDF } = require('./pdf-parser');

async function main() {
  const pdfPath = process.argv[2];

  if (!pdfPath) {
    console.log('用法: node cli.js <pdf文件路径>');
    console.log('示例: node cli.js "./docs/booking-note.pdf"');
    process.exit(1);
  }

  try {
    console.log('正在解析 PDF...');
    const text = await extractTextFromPDF(pdfPath);

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
