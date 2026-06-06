/**
 * Node 端 PaddleOCR 客户端 + 降级逻辑。
 *
 * 职责:
 *   1. 通过 HTTP 调用 PaddleOCR Python 微服务(见 paddle-service/)
 *   2. 失败时自动降级到 tesseract.js
 *   3. 内部信号量限制并发(避免打爆 Paddle 服务)
 *   4. 可选:对 Base64 图片做预处理(去噪/二值化)再发给 Paddle
 *
 * 设计原则:零新增依赖(只用 Node 内置 http/https)。
 *
 * 环境变量:
 *   PADDLE_OCR_URL          默认 http://paddleocr:8866/ocr
 *   PADDLE_TIMEOUT_MS       默认 90000(单请求超时 90s)
 *   PADDLE_ENABLED          默认 true(总开关;false 时直接走 tesseract)
 *   PADDLE_MAX_CONCURRENCY  默认 4(Node→Paddle 最大并发)
 *   OCR_ENGINE_DISABLED     默认 false(紧急熔断,运维用)
 */

'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const PADDLE_OCR_URL = process.env.PADDLE_OCR_URL || 'http://paddleocr:8866/ocr';
const PADDLE_TIMEOUT_MS = parseInt(process.env.PADDLE_TIMEOUT_MS || '90000', 10);
const PADDLE_ENABLED = (process.env.PADDLE_ENABLED || 'true').toLowerCase() !== 'false';
const PADDLE_MAX_CONCURRENCY = Math.max(1, parseInt(process.env.PADDLE_MAX_CONCURRENCY || '4', 10));
const OCR_ENGINE_DISABLED = (process.env.OCR_ENGINE_DISABLED || 'false').toLowerCase() === 'true';

// 简易信号量:限制 Paddle 并发
class Semaphore {
  constructor(max) {
    this.max = max;
    this.active = 0;
    this.queue = [];
  }
  async acquire() {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise((resolve) => this.queue.push(resolve));
    this.active++;
  }
  release() {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

const paddleSem = new Semaphore(PADDLE_MAX_CONCURRENCY);

// tesseract.js 延迟加载(避免在没装的环境下报错)
let _tesseract = null;
function getTesseract() {
  if (_tesseract !== null) return _tesseract;
  try {
    // eslint-disable-next-line global-require
    _tesseract = require('tesseract.js');
  } catch (e) {
    _tesseract = false;
  }
  return _tesseract;
}

/**
 * 内部:用 Node 内置 http/https 调用 PaddleOCR。
 * @param {string[]} imagesBase64 - Base64 编码图片数组
 * @param {object} opts - 透传 PaddleOCR 的字段 (lang/use_det/use_cls/use_rec/merge_lines)
 * @returns {Promise<object>} PaddleOCR 的 JSON 响应
 */
function callPaddleOCR(imagesBase64, opts = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(PADDLE_OCR_URL);
    } catch (e) {
      reject(new Error(`PADDLE_OCR_URL 格式无效: ${PADDLE_OCR_URL}`));
      return;
    }
    const transport = url.protocol === 'https:' ? https : http;
    const payload = JSON.stringify({
      images: imagesBase64,
      lang: opts.lang || 'ch',
      use_det: opts.use_det !== false,
      use_cls: opts.use_cls !== false,
      use_rec: opts.use_rec !== false,
      merge_lines: opts.merge_lines !== false,
    });
    const req = transport.request(
      {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + (url.search || ''),
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 50 * 1024 * 1024) {
            req.destroy(new Error('PaddleOCR 响应体过大'));
          }
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`PaddleOCR 返回非 JSON (HTTP ${res.statusCode}): ${body.slice(0, 200)}`));
          }
        });
      }
    );
    req.setTimeout(PADDLE_TIMEOUT_MS, () => {
      req.destroy(new Error(`PaddleOCR 请求超时 (${PADDLE_TIMEOUT_MS}ms)`));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * 探活:检查 PaddleOCR 服务是否在线。
 * @returns {Promise<boolean>}
 */
async function isPaddleAvailable() {
  if (!PADDLE_ENABLED || OCR_ENGINE_DISABLED) return false;
  try {
    const url = new URL(PADDLE_OCR_URL);
    return await new Promise((resolve) => {
      const transport = url.protocol === 'https:' ? https : http;
      const req = transport.request(
        {
          method: 'GET',
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: '/health',
          timeout: 3000,
        },
        (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  } catch (e) {
    return false;
  }
}

/**
 * 内部:tesseract.js 兜底识别(单图,Buffer 输入)。
 * @param {string} base64Image
 * @param {string} lang
 * @returns {Promise<object>} 与 PaddleOCR 兼容的结果结构
 */
async function runTesseract(base64Image, lang = 'eng+chi_sim') {
  const Tesseract = getTesseract();
  if (!Tesseract) {
    return {
      success: false,
      results: [],
      engine: 'tesseract',
      error: 'tesseract.js 未安装,无法降级',
    };
  }
  try {
    const buffer = Buffer.from(base64Image, 'base64');
    const { data } = await Tesseract.recognize(buffer, lang, {
      // 静默进度
      logger: () => {},
    });
    const fullText = (data.text || '').trim();
    return {
      success: true,
      results: [
        {
          image_index: 0,
          width: 0,
          height: 0,
          lines: [],
          full_text: fullText,
          engine: 'tesseract.js',
          latency_ms: 0,
          confidence: typeof data.confidence === 'number' ? data.confidence / 100 : null,
        },
      ],
      model_version: 'tesseract.js',
      elapsed_ms: 0,
      engine: 'tesseract',
    };
  } catch (e) {
    return {
      success: false,
      results: [],
      engine: 'tesseract',
      error: `tesseract.js 识别失败: ${e.message}`,
    };
  }
}

/**
 * 内部:多图批量调用 PaddleOCR(信号量限流)。
 */
async function callPaddleBatch(imagesBase64, opts) {
  await paddleSem.acquire();
  try {
    return await callPaddleOCR(imagesBase64, opts);
  } finally {
    paddleSem.release();
  }
}

/**
 * 主入口:识别一组图片(同步)。
 *
 * @param {string[]} imagesBase64 - Base64 编码图片数组(不带 data:image/*;base64, 前缀)
 * @param {object} [opts] - { lang, preprocess: bool, usePaddle: bool, ... }
 * @returns {Promise<{success: boolean, results: object[], engine: string, error?: string, fullText?: string}>}
 */
async function recognizeImages(imagesBase64, opts = {}) {
  if (!Array.isArray(imagesBase64) || imagesBase64.length === 0) {
    return { success: false, results: [], engine: 'none', error: 'images 数组为空' };
  }
  // 剥离 data:image/*;base64, 前缀
  const clean = imagesBase64.map((s) => {
    if (typeof s !== 'string') return s;
    const idx = s.indexOf(',');
    if (s.startsWith('data:') && idx > 0) return s.slice(idx + 1);
    return s;
  });

  // 1. 预处理开关(具体 RGBA 转换在 api.js 阶段完成,本函数只标记启用状态)
  let processed = clean;
  if (opts.preprocess !== false) {
    try {
      // eslint-disable-next-line global-require
      const pre = require('./image-preprocessor');
      if (pre && typeof pre.preprocessImage === 'function' && pre.PREPROCESSING_ENABLED) {
        // preprocessImage 接受 (imageData, width, height) RGBA 字节
        // RGBA 转换由 api.js 阶段通过 imageBufferToRGBA() 完成
        processed = clean;
      }
    } catch (e) {
      // 预处理模块加载失败 → 静默跳过
    }
  }

  // 2. 决定是否走 Paddle
  const usePaddle = PADDLE_ENABLED && !OCR_ENGINE_DISABLED && opts.usePaddle !== false;

  if (usePaddle) {
    try {
      const resp = await callPaddleBatch(processed, {
        lang: opts.lang || 'ch',
        merge_lines: opts.merge_lines !== false,
      });
      if (resp && resp.success && Array.isArray(resp.results) && resp.results.length > 0) {
        return {
          ...resp,
          engine: 'paddleocr',
          fullText: resp.results.map((r) => r.full_text || '').join('\n'),
        };
      }
      console.warn(
        '[paddle-client] PaddleOCR returned success=false, falling back to tesseract.js:',
        resp && resp.error
      );
    } catch (e) {
      if (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') {
        console.warn(
          `[paddle-client] PaddleOCR service unavailable (${e.code}), falling back to tesseract.js`
        );
      } else {
        console.error(
          '[paddle-client] PaddleOCR unexpected error, falling back to tesseract.js:',
          e.message
        );
      }
    }
  }

  // 3. 降级到 tesseract.js(逐图)
  const tessResults = [];
  let tessAllOk = true;
  let lastErr = null;
  for (let i = 0; i < processed.length; i++) {
    const r = await runTesseract(processed[i], opts.tesseractLang || 'eng+chi_sim');
    if (!r.success) {
      tessAllOk = false;
      lastErr = r.error;
    } else {
      tessResults.push({
        ...r.results[0],
        image_index: i,
      });
    }
  }
  if (tessAllOk && tessResults.length > 0) {
    return {
      success: true,
      results: tessResults,
      engine: 'tesseract.js',
      fullText: tessResults.map((r) => r.full_text || '').join('\n'),
    };
  }
  return {
    success: false,
    results: tessResults,
    engine: 'tesseract.js',
    error: lastErr || 'tesseract.js 识别失败',
  };
}

/**
 * 辅助:把图片 Buffer 转成 RGBA 字节(给 image-preprocessor 用)。
 * @param {Buffer} imageBuffer - PNG/JPG buffer
 * @returns {{data: Uint8Array, width: number, height: number} | null}
 */
function imageBufferToRGBA(imageBuffer) {
  try {
    // eslint-disable-next-line global-require
    const { createCanvas, Image } = require('@napi-rs/canvas');
    const img = new Image();
    img.src = imageBuffer;
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, img.width, img.height);
    return {
      data: new Uint8Array(imageData.data),
      width: img.width,
      height: img.height,
    };
  } catch (e) {
    return null;
  }
}

module.exports = {
  recognizeImages,
  isPaddleAvailable,
  imageBufferToRGBA,
  // 内部方法(测试用)
  _callPaddleOCR: callPaddleOCR,
  _PADDLE_OCR_URL: PADDLE_OCR_URL,
  _PADDLE_TIMEOUT_MS: PADDLE_TIMEOUT_MS,
  _PADDLE_ENABLED: PADDLE_ENABLED,
  _PADDLE_MAX_CONCURRENCY: PADDLE_MAX_CONCURRENCY,
};
