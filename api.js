/**
 * 订舱识别 API 服务（安全加固版）
 * 用法: node api.js [端口]
 * 默认端口: 3000
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { BookingRecognizer } = require('./index');
const { extractTextFromPDF } = require('./pdf-parser');

const app = express();
const PORT = process.argv[2] || process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || null; // 可通过环境变量设置 API Key

// 中间件
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 确保上传目录存在
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ============================================
// 安全验证函数
// ============================================

/**
 * 验证 URL 是否安全（防止 SSRF）
 */
function isValidUrl(urlString) {
  try {
    const url = new URL(urlString);

    // 只允许 http/https 协议
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { valid: false, reason: '只允许 HTTP/HTTPS 协议' };
    }

    const hostname = url.hostname.toLowerCase();

    // 禁止本地回环地址
    const blockedPatterns = [
      /^localhost$/i,
      /^127\.\d+\.\d+\.\d+$/,
      /^10\.\d+\.\d+\.\d+$/,
      /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
      /^192\.168\.\d+\.\d+$/,
      /\.local$/i,
      /^0\.0\.0\.0$/i,
      /^::1$/i,
      /^fe80:/i,
    ];

    for (const pattern of blockedPatterns) {
      if (pattern.test(hostname)) {
        return { valid: false, reason: '禁止访问内网地址' };
      }
    }

    // 禁止 IPV6 本地地址
    if (hostname === '::1' || hostname === '[::1]') {
      return { valid: false, reason: '禁止访问本地地址' };
    }

    // 禁止 file 协议
    if (url.protocol === 'file:') {
      return { valid: false, reason: '禁止使用 file 协议' };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: '无效的 URL 格式' };
  }
}

/**
 * 验证文件路径是否安全（防止路径穿越）
 */
function isValidFilePath(filePath) {
  // 只允许字母、数字、下划线、连字符、点、斜杠、反斜杠
  if (!/^[a-zA-Z0-9_\-./\\]+$/.test(filePath)) {
    return false;
  }
  // 禁止路径穿越
  if (filePath.includes('..')) {
    return false;
  }
  return true;
}

/**
 * 验证 PDF 文件签名
 */
function isValidPDF(buffer) {
  // PDF 文件签名：%PDF
  const signature = buffer.slice(0, 4);
  try {
    const header = signature.toString('ascii');
    return header === '%PDF';
  } catch {
    return false;
  }
}

/**
 * 验证图片文件签名(魔数),返回 { valid, format, reason }。
 * 支持: PNG / JPG / JPEG
 */
function isValidImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return { valid: false, reason: '文件太小' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 &&
    buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a &&
    buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return { valid: true, format: 'png' };
  }
  // JPEG: FF D8 FF (后跟 E0/E1/DB/E2 等)
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { valid: true, format: 'jpg' };
  }
  return { valid: false, reason: '无效的图片格式(仅支持 PNG/JPG/JPEG)' };
}

/**
 * 从 Buffer 中提取图片魔数对应的扩展名(若无法识别,默认为 png)
 */
function detectImageExt(buffer) {
  const v = isValidImage(buffer);
  if (v.valid) return v.format === 'jpg' ? 'jpg' : 'png';
  return 'png';
}

// ============================================
// 认证中间件（如果配置了 API_KEY）
// ============================================

function authMiddleware(req, res, next) {
  // 如果没有配置 API_KEY，跳过认证
  if (!API_KEY) {
    return next();
  }

  const key = req.headers['x-api-key'] || req.query.api_key;

  if (!key) {
    return res.status(401).json({ error: '缺少 API Key' });
  }

  if (key !== API_KEY) {
    return res.status(403).json({ error: 'API Key 无效' });
  }

  next();
}

// ============================================
// 速率限制（简单实现）
// ============================================

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15分钟
const RATE_LIMIT_MAX = 100; // 最多100次
const RATE_LIMIT_MAP_MAX = 10000; // Map 条目上限，防止 DDoS 导致内存泄漏

function rateLimitMiddleware(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();

  // 防御内存泄漏：当 Map 过大时清理过期记录
  if (rateLimitMap.size > RATE_LIMIT_MAP_MAX) {
    for (const [key, record] of rateLimitMap.entries()) {
      if (now - record.windowStart > RATE_LIMIT_WINDOW) {
        rateLimitMap.delete(key);
      }
    }
    // 如果仍然过大，删除最旧的 20%
    if (rateLimitMap.size > RATE_LIMIT_MAP_MAX) {
      const sorted = [...rateLimitMap.entries()].sort((a, b) => a[1].windowStart - b[1].windowStart);
      const deleteCount = Math.floor(sorted.length * 0.2);
      for (let i = 0; i < deleteCount; i++) {
        rateLimitMap.delete(sorted[i][0]);
      }
    }
  }

  // 获取或初始化该 IP 的记录
  let record = rateLimitMap.get(ip);
  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW) {
    record = { windowStart: now, count: 0 };
  }

  record.count++;
  rateLimitMap.set(ip, record);

  if (record.count > RATE_LIMIT_MAX) {
    return res.status(429).json({
      error: '请求过于频繁，请稍后再试',
      retryAfter: Math.ceil((RATE_LIMIT_WINDOW - (now - record.windowStart)) / 1000)
    });
  }

  next();
}

// 清理过期的限速记录（每分钟）
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap.entries()) {
    if (now - record.windowStart > RATE_LIMIT_WINDOW) {
      rateLimitMap.delete(ip);
    }
  }
}, 60000);

// ============================================
// 请求处理
// ============================================

/**
 * 解析 PDF 或 Word 并返回结构化结果
 */
async function parseDocument(filePath) {
  let text;
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.docx' || ext === '.doc') {
    const { extractTextFromWord } = require('./pdf-parser');
    text = await extractTextFromWord(filePath);
  } else {
    text = await extractTextFromPDF(filePath);
  }

  const recognizer = new BookingRecognizer();
  const result = recognizer.parse(text);
  result.standardFormat = recognizer.toStandardFormat(result);
  return result;
}

/**
 * 在 parseDocument 结果上附加 combinedFormat（标准格式 + 来源 URL）。
 * 用于追溯 PDF 来源到结构化记录。
 *
 * 单船场景: <vessel>-<voyage>-<blNo>-<count>-<sizeType>+<URL>
 * 中转场景: <vessel>-<voyage>-<blNo>-<count>-<sizeType>+<vessel2>-<voyage2>+<URL>
 * 混箱型场景: <vessel>-<voyage>-<blNo>-<count>-<sizeType1>+<sizeType2>...+<URL>
 */
function attachCombinedFormat(result, sourceUrl) {
  if (!result || !sourceUrl) return result;
  if (!result.standardFormat) return result;

  let middle = result.standardFormat;

  // 副船追加: <标准格式>+<副船>-<副航次>
  if (result.secondVessel && result.secondVoyage) {
    middle = `${middle}+${result.secondVessel}-${result.secondVoyage}`;
  }

  result.combinedFormat = `${middle}+${sourceUrl}`;
  return result;
}

/**
 * 解析图片 Buffer 并返回结构化结果(走 PaddleOCR + tesseract 降级)。
 *
 * @param {Buffer} imageBuffer - PNG/JPG 图片 buffer
 * @param {object} [opts] - { lang, preprocess, tesseractLang }
 */
async function parseImage(imageBuffer, opts = {}) {
  const { recognizeImages } = require('./paddle-client');

  // 1. 可选预处理(@napi-rs/canvas + image-preprocessor)
  let processed = imageBuffer;
  if (opts.preprocess !== false) {
    try {
      // eslint-disable-next-line global-require
      const pre = require('./image-preprocessor');
      if (pre && typeof pre.preprocessImage === 'function' && pre.PREPROCESSING_ENABLED) {
        const { imageBufferToRGBA } = require('./paddle-client');
        const rgba = imageBufferToRGBA(imageBuffer);
        if (rgba) {
          const result = pre.preprocessImage(rgba.data, rgba.width, rgba.height);
          // preprocessImage 返回 { data, width, height } 或直接 buffer
          if (result && result.data) {
            // 重新编码为 PNG buffer
            const { createCanvas } = require('@napi-rs/canvas');
            const canvas = createCanvas(result.width, result.height);
            const ctx = canvas.getContext('2d');
            const imageData = ctx.createImageData(result.width, result.height);
            imageData.data.set(result.data);
            ctx.putImageData(imageData, 0, 0);
            processed = canvas.toBuffer('image/png');
          }
        }
      }
    } catch (e) {
      // 预处理失败 → 静默使用原图
    }
  }

  // 2. OCR(自动降级)
  const base64 = processed.toString('base64');
  const ocrResult = await recognizeImages([base64], {
    lang: opts.lang || 'ch',
    tesseractLang: opts.tesseractLang || 'eng+chi_sim',
    merge_lines: true,
  });

  if (!ocrResult || !ocrResult.success) {
    throw new Error(ocrResult && ocrResult.error ? ocrResult.error : '图片识别失败');
  }

  // 3. 复用现有识别器解析文本
  const text = ocrResult.fullText || '';
  const recognizer = new BookingRecognizer();
  const result = recognizer.parse(text);
  result.standardFormat = recognizer.toStandardFormat(result);
  result.ocrEngine = ocrResult.engine;
  result.ocrFullText = text;
  return result;
}

/**
 * 从 URL 下载 PDF（安全版本，带重试；优先用本机 curl 绕过 CDN 的 Node TLS 指纹检测）
 */
async function downloadPDF(url) {
  const https = require('https');
  const http = require('http');
  const urlModule = require('url');
  const { execFile } = require('child_process');

  // 验证 URL
  const validation = isValidUrl(url);
  if (!validation.valid) {
    throw new Error(`URL 验证失败: ${validation.reason}`);
  }

  const fileName = path.join(uploadsDir, `${Date.now()}_${Math.random().toString(36).substring(7)}.pdf`);

  const MAX_RETRIES = 3;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // 优先用 curl：避免 Node https.get 的 JA3 指纹被反爬
      return await downloadViaCurl(url, fileName, execFile);
    } catch (curlErr) {
      // curl 不在 / 没下载成功时,回退到 Node https
      console.warn(`[downloadPDF] curl attempt ${attempt} failed: ${curlErr.message}; falling back to https`);
      try {
        return await downloadPDFOnce(url, { https, http, urlModule }, fileName);
      } catch (nodeErr) {
        lastErr = nodeErr;
        const transient = /socket hang up|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|aborted/i.test(nodeErr.message);
        if (!transient || attempt === MAX_RETRIES) throw nodeErr;
        const delay = 500 * Math.pow(2, attempt - 1);
        console.warn(`[downloadPDF] attempt ${attempt}/${MAX_RETRIES} failed: ${nodeErr.message}; retrying in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

function downloadViaCurl(url, fileName, execFile) {
  return new Promise((resolve, reject) => {
    const args = [
      '-sSL',                  // silent + follow redirects
      '--max-time', '60',
      '--max-filesize', '52428800', // 50MB
      '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '-H', 'Accept: application/pdf,application/octet-stream;q=0.9,*/*;q=0.8',
      '-o', fileName,
      url,
    ];
    execFile('curl', args, { windowsHide: true }, (err, _stdout, stderr) => {
      if (err) {
        try { fs.unlinkSync(fileName); } catch {}
        return reject(new Error(`curl ${err.code || 'failed'}: ${(stderr || err.message).trim().slice(0, 200)}`));
      }
      // 验证下载到的是 PDF
      if (!fs.existsSync(fileName) || fs.statSync(fileName).size < 100) {
        try { fs.unlinkSync(fileName); } catch {}
        return reject(new Error('curl 下载后文件不存在或过小'));
      }
      const fd = fs.openSync(fileName, 'r');
      const buf = Buffer.alloc(5);
      fs.readSync(fd, buf, 0, 5, 0);
      fs.closeSync(fd);
      if (!(buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)) { // %PDF
        try { fs.unlinkSync(fileName); } catch {}
        return reject(new Error('curl 下载内容不是 PDF (%PDF magic 缺失)'));
      }
      resolve(fileName);
    });
  });
}

function downloadPDFOnce(url, { https, http, urlModule }, fileName) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new urlModule.URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const file = fs.createWriteStream(fileName);
    let downloadedSize = 0;
    const MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024; // 50MB

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'identity',
      'Connection': 'keep-alive',
    };

    const request = protocol.get(url, { headers }, (response) => {
      // 处理重定向
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        file.close();
        try { fs.unlinkSync(fileName); } catch {}
        if (redirectUrl) {
          // 修复 SSRF：校验重定向后的 URL
          const redirectValidation = isValidUrl(redirectUrl);
          if (!redirectValidation.valid) {
            reject(new Error(`重定向 URL 验证失败: ${redirectValidation.reason}`));
            return;
          }
          resolve(downloadPDF(redirectUrl));
        } else {
          reject(new Error('重定向地址无效'));
        }
        return;
      }

      // 检查 HTTP 状态码
      if (response.statusCode < 200 || response.statusCode >= 400) {
        file.close();
        fs.unlinkSync(fileName);
        reject(new Error(`下载失败: HTTP ${response.statusCode}`));
        return;
      }

      // 检查 Content-Type
      const contentType = response.headers['content-type'] || '';
      if (!contentType.includes('pdf') && !contentType.includes('application/octet-stream')) {
        // 允许但警告
        console.warn(`警告: Content-Type 不是 PDF: ${contentType}`);
      }

      // 限制下载文件大小（50MB）
      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        if (downloadedSize > MAX_DOWNLOAD_SIZE) {
          request.destroy();
          file.destroy();
          try { fs.unlinkSync(fileName); } catch {}
          reject(new Error(`下载文件过大（超过 ${MAX_DOWNLOAD_SIZE / 1024 / 1024}MB）`));
        }
      });

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(fileName);
      });
    });

    request.on('error', (err) => {
      if (fs.existsSync(fileName)) {
        try { fs.unlinkSync(fileName); } catch {}
      }
      reject(new Error(`网络错误: ${err.message}`));
    });

    request.setTimeout(60000, () => {
      request.destroy();
      if (fs.existsSync(fileName)) {
        try { fs.unlinkSync(fileName); } catch {}
      }
      reject(new Error('下载超时（60秒）'));
    });
  });
}

/**
 * 安全地清理临时文件
 */
function safeUnlink(filePath) {
  try {
    if (filePath && filePath.startsWith(uploadsDir) && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error('清理临时文件失败:', err.message);
  }
}

// ============================================
// 路由
// ============================================

// 健康检查（无需认证）
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'booking-recognizer-api' });
});

// 首页信息（无需认证）
app.get('/', (req, res) => {
  res.json({
    service: 'Booking Recognizer API',
    version: '1.0.0',
    security: {
      apiKeyEnabled: !!API_KEY,
      rateLimit: RATE_LIMIT_MAX
    },
    endpoints: {
      'POST /parse': '解析 PDF 文件或 URL',
      'GET /health': '健康检查',
      'POST /parse-url': '直接解析 URL',
      'POST /parse-image': '解析 PNG/JPG/JPEG 图片(PaddleOCR + tesseract 降级)',
      'POST /compare': '模糊比对(标准格式 vs 识别结果)'
    }
  });
});

// 解析 PDF（需要认证，有限流）
app.post('/parse', authMiddleware, rateLimitMiddleware, async (req, res) => {
  let pdfPath = null;

  try {
    // 1. 处理 JSON body 中的 URL
    if (req.body.url) {
      const validation = isValidUrl(req.body.url);
      if (!validation.valid) {
        return res.status(200).json({
          success: false,
          error: validation.reason
        });
      }
      pdfPath = await downloadPDF(req.body.url);
    }
    // 2. 处理 base64 编码的 PDF
    else if (req.body.pdfBase64) {
      // Base64 大小预检查（50MB PDF 的 base64 约 70MB）
      const maxBase64Size = 70 * 1024 * 1024;
      if (req.body.pdfBase64.length > maxBase64Size) {
        return res.status(200).json({
          success: false,
          error: '请求数据过大'
        });
      }

      let buffer;
      try {
        buffer = Buffer.from(req.body.pdfBase64, 'base64');
      } catch {
        return res.status(200).json({
          success: false,
          error: '无效的 Base64 编码'
        });
      }

      // 验证 PDF 签名
      if (!isValidPDF(buffer)) {
        return res.status(200).json({
          success: false,
          error: '无效的 PDF 文件'
        });
      }

      // 验证文件大小（不超过 50MB）
      if (buffer.length > 50 * 1024 * 1024) {
        return res.status(200).json({
          success: false,
          error: '文件过大（最大 50MB）'
        });
      }

      const safeName = `${Date.now()}_${Math.random().toString(36).substring(7)}.pdf`;
      pdfPath = path.join(uploadsDir, safeName);
      fs.writeFileSync(pdfPath, buffer);
    }
    else {
      return res.status(200).json({
        success: false,
        error: '请提供 URL 或 base64 编码的 PDF'
      });
    }

    // 解析 PDF
    const result = await parseDocument(pdfPath);

    // 清理临时文件
    safeUnlink(pdfPath);


    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    // 清理临时文件
    safeUnlink(pdfPath);

    console.error('解析错误:', error);

    const errorMessage = process.env.NODE_ENV === 'production'
      ? '解析失败'
      : error.message;

    // 始终返回 200 和统一格式 (Apifox 契约要求)
    res.status(200).json({
      success: false,
      error: '解析失败',
      message: errorMessage
    });
  }
});

// 直接解析 URL（需要认证，有限流）
app.post('/parse-url', authMiddleware, rateLimitMiddleware, async (req, res) => {
  let pdfPath = null;

  try {
    const { url } = req.body;

    if (!url) {
      return res.status(200).json({
        success: false,
        error: '请提供 URL'
      });
    }

    // 处理 file:// 协议（本地文件）
    if (url.startsWith('file://')) {
      pdfPath = url.replace('file://', '');
      // 处理不完整的 file:// URL
      if (!pdfPath.startsWith('/') && !pdfPath.match(/^[A-Za-z]:/)) {
        pdfPath = '/' + pdfPath;
      }
      // 路径穿越防护
      if (pdfPath.includes('..') || pdfPath.includes('%00')) {
        return res.status(200).json({
          success: false,
          error: '无效的文件路径'
        });
      }
      if (!fs.existsSync(pdfPath)) {
        return res.status(200).json({
          success: false,
          error: '文件不存在: ' + pdfPath
        });
      }
    } else {
      // 验证 URL
      const validation = isValidUrl(url);
      if (!validation.valid) {
        return res.status(200).json({
          success: false,
          error: validation.reason
        });
      }
      console.log('正在下载 PDF:', url);
      pdfPath = await downloadPDF(url);
      console.log('PDF 已下载:', pdfPath);
    }

    const result = await parseDocument(pdfPath);

    // 清理临时文件
    safeUnlink(pdfPath);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    // 清理临时文件
    safeUnlink(pdfPath);

    console.error('解析错误:', error);

    const errorMessage = process.env.NODE_ENV === 'production'
      ? '解析失败'
      : error.message;

    // 始终返回 200 和统一格式 (Apifox 契约要求)
    res.status(200).json({
      success: false,
      error: '解析失败',
      message: errorMessage
    });
  }
});

// 模糊比对接口
app.post('/compare', authMiddleware, rateLimitMiddleware, async (req, res) => {
  try {
    const { combinedFormat } = req.body;

    if (!combinedFormat) {
      return res.status(200).json({
        success: false,
        error: '请提供 combinedFormat'
      });
    }

    // 解析组合格式
    const recognizer = new BookingRecognizer();
    const parsed = recognizer.parseCombinedFormat(combinedFormat);

    if (!parsed) {
      return res.status(200).json({
        success: false,
        error: '无效的组合格式字符串，格式: 船名-航次-提单号-箱量-箱型+文档(URL或base64)'
      });
    }

    if (!parsed.isUrl && !parsed.document.startsWith('file://')) {
      return res.status(200).json({
        success: false,
        error: 'compare接口仅支持URL或file://方式解析文档'
      });
    }

    // 下载文档
    let pdfPath;
    if (parsed.document.startsWith('file://')) {
      pdfPath = parsed.document.replace('file://', '');
      // 处理不完整的 file:// URL（如 file://Users/... 缺少 leading slash）
      if (!pdfPath.startsWith('/') && !pdfPath.match(/^[A-Za-z]:/)) {
        // Unix 系统上可能是 file://Users/... 应为 file:///Users/...
        pdfPath = '/' + pdfPath;
      }
      // 路径穿越防护
      if (pdfPath.includes('..') || pdfPath.includes('%00')) {
        return res.status(200).json({
          success: false,
          error: '无效的文件路径'
        });
      }
      if (!fs.existsSync(pdfPath)) {
        return res.status(200).json({
          success: false,
          error: '文件不存在: ' + pdfPath
        });
      }
    } else {
      console.log('正在下载 PDF:', parsed.document);
      pdfPath = await downloadPDF(parsed.document);
      console.log('PDF 已下载:', pdfPath);
    }

    // 提取文本
    const text = await extractTextFromPDF(pdfPath);

    // 识别文档
    const result = recognizer.parse(text);

    // 模糊比对
    const expectedFormat = [
      parsed.expected.vessel,
      parsed.expected.voyage,
      parsed.expected.blNo,
      parsed.expected.containerCount,
      parsed.expected.sizeType
    ].filter(v => v !== null && v !== undefined).join('-');

    const comparison = recognizer.fuzzyCompare(result, expectedFormat, 0.7);

    // 清理临时文件
    safeUnlink(pdfPath);

    const formatted = recognizer.formatComparisonResult(comparison);

    res.json({
      success: true,
      data: {
        matched: comparison.matched,
        similarity: comparison.similarity,
        threshold: comparison.threshold,
        standardFormat: formatted.standardFormat,
        recognizedFormat: formatted.recognizedFormat,
        formattedOutput: formatted.formattedOutput,
        details: {
          expected: parsed.expected,
          recognized: {
            vessel: result.vessel,
            voyage: result.voyage,
            blNo: result.blNo,
            containerCount: result.containers?.length || 0,
            sizeType: result.containers[0]?.sizeType || null
          },
          exactMatchFields: comparison.details?.exactMatchFields
        }
      }
    });

  } catch (error) {
    console.error('比对错误:', error);

    const errorMessage = process.env.NODE_ENV === 'production'
      ? '比对失败'
      : error.message;

    res.status(200).json({
      success: false,
      error: '比对失败',
      message: errorMessage
    });
  }
});

// 解析图片:支持 URL / file:// / imageBase64(需要认证,有限流)
app.post('/parse-image', authMiddleware, rateLimitMiddleware, async (req, res) => {
  let imagePath = null;

  try {
    const { url, imageBase64 } = req.body || {};

    if (!url && !imageBase64) {
      return res.status(200).json({
        success: false,
        error: '请提供 url 或 imageBase64'
      });
    }

    let imageBuffer = null;

    // 方式 1:URL 下载(包括 file://)
    if (url) {
      if (url.startsWith('file://')) {
        // 本地文件(file:// 模式,与 /parse-url 同样的安全处理)
        imagePath = url.replace('file://', '');
        if (!imagePath.startsWith('/') && !imagePath.match(/^[A-Za-z]:/)) {
          imagePath = '/' + imagePath;
        }
        if (imagePath.includes('..') || imagePath.includes('%00')) {
          return res.status(200).json({ success: false, error: '无效的文件路径' });
        }
        if (!fs.existsSync(imagePath)) {
          return res.status(200).json({ success: false, error: '文件不存在: ' + imagePath });
        }
        imageBuffer = fs.readFileSync(imagePath);
      } else {
        // HTTP/HTTPS 下载:复用 downloadPDF 但允许任意扩展名
        const validation = isValidUrl(url);
        if (!validation.valid) {
          return res.status(200).json({ success: false, error: validation.reason });
        }
        // 复用 downloadPDF(限 50MB, 60s 超时,重定向 SSRF 防护)
        imagePath = await downloadPDF(url);
        imageBuffer = fs.readFileSync(imagePath);
      }
    }
    // 方式 2:imageBase64
    else if (imageBase64) {
      // 剥离 data:image/png;base64, 前缀
      let b64 = imageBase64;
      if (b64.startsWith('data:') && b64.includes(',')) {
        b64 = b64.substring(b64.indexOf(',') + 1);
      }
      // 大小预检(50MB 图片的 base64 约 70MB)
      const maxBase64Size = 70 * 1024 * 1024;
      if (b64.length > maxBase64Size) {
        return res.status(200).json({ success: false, error: '请求数据过大' });
      }
      try {
        imageBuffer = Buffer.from(b64, 'base64');
      } catch {
        return res.status(200).json({ success: false, error: '无效的 Base64 编码' });
      }
    }

    if (!imageBuffer) {
      return res.status(200).json({ success: false, error: '未获取到图片内容' });
    }

    // 文件大小校验
    if (imageBuffer.length > 50 * 1024 * 1024) {
      return res.status(200).json({ success: false, error: '文件过大(最大 50MB)' });
    }

    // 魔数校验
    const imgCheck = isValidImage(imageBuffer);
    if (!imgCheck.valid) {
      return res.status(200).json({ success: false, error: imgCheck.reason });
    }

    // 调用 parseImage(PaddleOCR + tesseract 降级 + 预处理)
    const result = await parseImage(imageBuffer, {
      lang: (req.body && req.body.lang) || 'ch',
      preprocess: req.body && req.body.preprocess !== false,
    });

    // 清理临时文件
    safeUnlink(imagePath);



    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    safeUnlink(imagePath);
    console.error('图片解析错误:', error);

    const errorMessage = process.env.NODE_ENV === 'production'
      ? '图片解析失败'
      : error.message;

    res.status(200).json({
      success: false,
      error: '图片解析失败',
      message: errorMessage
    });
  }
});

// 404 处理
app.use((req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);

  const errorMessage = process.env.NODE_ENV === 'production'
    ? '服务器内部错误'
    : err.message;

  // 始终返回 200 和统一格式 (Apifox 契约要求)
  res.status(200).json({
    success: false,
    error: '服务器内部错误',
    message: errorMessage
  });
});

// ============================================
// 启动服务器
// ============================================

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║            订舱识别 API 服务已启动                           ║
╠══════════════════════════════════════════════════════════════╣
║  地址: http://localhost:${PORT}                                ║
║  健康检查: http://localhost:${PORT}/health                    ║
╠══════════════════════════════════════════════════════════════╣
║  安全配置:                                                  ║
║    API Key: ${API_KEY ? '已配置' : '未配置（建议生产环境设置）'}         ║
║    速率限制: ${RATE_LIMIT_MAX} 次/15分钟                           ║
║    SSRF 防护: 已启用                                         ║
║    文件验证: 已启用                                          ║
╠══════════════════════════════════════════════════════════════╣
║  接口说明:                                                  ║
║                                                            ║
║  POST /parse - 解析 PDF                                     ║
║    - URL: { url: "..." }                                    ║
║    - Base64: { pdfBase64: "..." }                           ║
║                                                            ║
║  POST /parse-url - 直接解析 URL                             ║
║    - Body: { url: "PDF_URL" }                               ║
║                                                            ║
║  POST /parse-image - 解析 PNG/JPG/JPEG 图片                 ║
║    - URL:    { url: "https://.../booking.png" }             ║
║    - Base64: { imageBase64: "iVBORw0K..." }                 ║
║    - 引擎:   PaddleOCR(主) + tesseract.js(降级)             ║
║                                                            ║
╚══════════════════════════════════════════════════════════════╝

示例:
  # URL 解析
  curl -X POST -H "Content-Type: application/json" \\
       -d '{"url":"https://oss.qingdao-port.net/xxx.pdf"}' \\
       http://localhost:${PORT}/parse-url

  # 带 API Key
  curl -X POST -H "Content-Type: application/json" \\
       -H "X-API-Key: your-secret-key" \\
       -d '{"url":"https://oss.qingdao-port.net/xxx.pdf"}' \\
       http://localhost:${PORT}/parse-url
`);

  if (!API_KEY) {
    console.log('\n⚠️  警告: 未设置 API_KEY，建议通过环境变量配置:\n');
    console.log('  Windows: set API_KEY=your-secret-key && node api.js');
    console.log('  Linux/Mac: API_KEY=your-secret-key node api.js\n');
  }
});

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n正在关闭服务器...');
  process.exit(0);
});

process.on('exit', () => {
  // 清理所有临时文件
  try {
    const files = fs.readdirSync(uploadsDir);
    for (const file of files) {
      fs.unlinkSync(path.join(uploadsDir, file));
    }
  } catch {}
});