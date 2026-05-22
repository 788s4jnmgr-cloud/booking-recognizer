/**
 * PDF 解析模块 - 使用 pdf-parse 提取文本
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

/**
 * 验证文件路径是否安全（防止路径穿越和命令注入）
 */
function isValidPDFPath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }

  // 只允许字母、数字、下划线、连字符、点、斜杠、反斜杠、空格
  if (!/^[a-zA-Z0-9_\-./\\: ]+$/.test(filePath)) {
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
    return data.text;
  }

  throw new Error('No PDF parsing method available. Install pdf-parse: npm install pdf-parse');
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

module.exports = {
  extractTextFromPDF,
  batchExtract
};
