/**
 * PDF 解析模块 - 使用 pdf-parse 提取文本，支持扫描件 OCR
 */

const fs = require('fs');
const path = require('path');

// 尝试加载 pdf-parse，如果不可用则使用备选方案
let pdfParse;
try {
  pdfParse = require('pdf-parse');
} catch (e) {
  console.warn('pdf-parse not found');
  pdfParse = null;
}

// pdfjs-dist for rendering PDF pages to images
let pdfjsLib;
try {
  pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
} catch (e) {
  console.warn('pdfjs-dist not found');
  pdfjsLib = null;
}

// @omsimos/pdf-raster for PDF to image conversion
let pdfRaster;
try {
  pdfRaster = require('@omsimos/pdf-raster');
} catch (e) {
  console.warn('@omsimos/pdf-raster not found');
  pdfRaster = null;
}

// tesseract.js OCR 引擎
let Tesseract;
try {
  Tesseract = require('tesseract.js');
} catch (e) {
  console.warn('tesseract.js not found');
  Tesseract = null;
}

/**
 * 验证文件路径是否安全（防止路径穿越和命令注入）
 */
function isValidPDFPath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }

  // 只允许字母、数字、下划线、连字符、点、斜杠、反斜杠、空格、中文
  if (!/^[a-zA-Z0-9_\-./\\: 一-龥]+$/.test(filePath)) {
    return false;
  }

  // 禁止路径穿越
  if (filePath.includes('..')) {
    return false;
  }

  // 禁止危险字符
  const dangerous = /[;|`$&\|\(\)\n\r<>'"]/;
  if (dangerous.test(filePath)) {
    return false;
  }

  return true;
}

/**
 * 从 PDF 文件提取文本
 * @param {string} pdfPath - PDF 文件路径
 * @returns {Promise<string>} 提取的文本
 */
async function extractTextFromPDF(pdfPath) {
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF file not found: ${pdfPath}`);
  }

  // 安全验证
  if (!isValidPDFPath(pdfPath)) {
    throw new Error('无效的文件路径');
  }

  // 验证文件大小（最大 50MB）
  const stats = fs.statSync(pdfPath);
  if (stats.size > 50 * 1024 * 1024) {
    throw new Error('PDF 文件过大（最大 50MB）');
  }

  // 合并读取：一次读取整个文件，验证前4字节签名
  const fileBuffer = fs.readFileSync(pdfPath);

  try {
    const header = fileBuffer.slice(0, 4).toString('ascii');
    if (header !== '%PDF') {
      throw new Error('无效的 PDF 文件');
    }
  } catch {
    throw new Error('无法读取 PDF 文件头部');
  }

  if (pdfParse) {
    const data = await pdfParse(fileBuffer);
    const text = data.text;

    // 如果提取的文本为空或只有空白字符，尝试 OCR
    if (!text || !text.trim()) {
      if (Tesseract) {
        console.log('PDF text layer empty, using OCR...');
        return await extractTextByOCR(fileBuffer);
      }
      return text;
    }

    return text;
  }

  // 如果没有 pdf-parse但有 Tesseract，直接用 OCR
  if (Tesseract) {
    return await extractTextByOCR(fileBuffer);
  }

  throw new Error('No PDF parsing method available. Install pdf-parse: npm install pdf-parse');
}

/**
 * 使用 Tesseract OCR 从 PDF 提取文本（扫描件）
 * @param {Buffer} fileBuffer - PDF 文件 buffer
 * @returns {Promise<string>} 提取的文本
 */
async function extractTextByOCR(fileBuffer) {
  if (!Tesseract) {
    throw new Error('OCR engine not available. Install tesseract.js: npm install tesseract.js');
  }

  if (!pdfRaster) {
    throw new Error('PDF raster library not available. Install @omsimos/pdf-raster: npm install @omsimos/pdf-raster');
  }

  const { convert } = pdfRaster;
  const images = await convert(fileBuffer);

  let fullText = '';
  const totalPages = images.length;

  for (let i = 0; i < images.length; i++) {
    try {
      const pageNum = i + 1;
      const imageData = images[i].data;

      const result = await Tesseract.recognize(imageData, 'eng+chi_sim', {
        logger: () => {}
      });

      fullText += `\nPage ${pageNum} of ${totalPages}\n${result.data.text}\n`;
    } catch (e) {
      console.warn('OCR failed for page:', i + 1, e.message);
    }
  }

  return fullText;
}

/**
 * 批量处理 PDF 文件
 * @param {string[]} pdfPaths - PDF 文件路径数组
 * @returns {Promise<Array<{path: string, text: string}>>}
 */
async function batchExtract(pdfPaths) {
  const results = [];

  for (const pdfPath of pdfPaths) {
    try {
      const text = await extractTextFromPDF(pdfPath);
      results.push({ path: pdfPath, text, success: true });
    } catch (error) {
      results.push({ path: pdfPath, error: error.message, success: false });
    }
  }

  return results;
}

/**
 * 从 Word 文件提取文本
 * @param {string} docxPath - Word 文件路径
 * @returns {Promise<string>} 提取的文本
 */
async function extractTextFromWord(docxPath) {
  if (!fs.existsSync(docxPath)) {
    throw new Error(`Word file not found: ${docxPath}`);
  }

  if (!isValidPDFPath(docxPath)) {
    throw new Error('无效的文件路径');
  }

  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ path: docxPath });
  return result.value;
}

module.exports = {
  extractTextFromPDF,
  extractTextFromWord,
  batchExtract
};
