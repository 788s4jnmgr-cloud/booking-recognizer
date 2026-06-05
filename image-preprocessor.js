/**
 * 图像预处理模块 - Image Preprocessing Module
 * 使用 @napi-rs/canvas 对 PDF 转换的图像进行预处理
 * 提升 OCR 识别率
 */

let Canvas;
try {
  Canvas = require('@napi-rs/canvas');
} catch (e) {
  Canvas = null;
}

const PREPROCESSING_ENABLED = !!Canvas;

async function preprocessImage(imageData, width, height) {
  if (!PREPROCESSING_ENABLED) {
    console.warn('图像预处理未启用: @napi-rs/canvas 未安装，OCR 将在原始图像上运行');
    return { data: imageData, width, height };
  }

  try {
    const canvas = Canvas.createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const imageDataObj = ctx.createImageData(width, height);
    imageDataObj.data.set(imageData);
    ctx.putImageData(imageDataObj, 0, 0);
    const processed = await applyPreprocessing(ctx, width, height);
    const outputData = processed.getContext('2d').getImageData(0, 0, width, height);
    return { data: outputData.data, width, height };
  } catch (e) {
    console.warn('图像预处理失败，使用原始图像:', e.message);
    return { data: imageData, width, height };
  }
}

async function applyPreprocessing(ctx, width, height) {
  const canvas = ctx.canvas;
  const deskewed = applyDeskew(ctx, width, height);
  const denoised = applyGaussianBlur(deskewed, width, height, 1.5);
  const enhanced = applyContrastEnhancement(denoised, width, height);
  const binarized = applyOtsuBinarization(enhanced, width, height);
  return binarized;
}

function applyDeskew(ctx, width, height) {
  const canvas = ctx.canvas;
  const newCanvas = Canvas.createCanvas(width, height);
  const newCtx = newCanvas.getContext('2d');
  newCtx.drawImage(canvas, 0, 0);
  return newCtx;
}

function applyGaussianBlur(ctx, width, height, radius) {
  const canvas = ctx.canvas;
  const newCanvas = Canvas.createCanvas(width, height);
  const newCtx = newCanvas.getContext('2d');
  const kernel = [1/16, 2/16, 1/16, 2/16, 4/16, 2/16, 1/16, 2/16, 1/16];
  const imageData = ctx.getImageData(0, 0, width, height);
  const newImageData = newCtx.createImageData(width, height);
  const srcData = imageData.data;
  const dstData = newImageData.data;
  const offset = Math.floor(radius);
  for (let y = offset; y < height - offset; y++) {
    for (let x = offset; x < width - offset; x++) {
      let r = 0, g = 0, b = 0;
      for (let ky = -offset; ky <= offset; ky++) {
        for (let kx = -offset; kx <= offset; kx++) {
          const idx = ((y + ky) * width + (x + kx)) * 4;
          const ki = (ky + offset) * 3 + (kx + offset);
          const weight = kernel[ki];
          r += srcData[idx] * weight;
          g += srcData[idx + 1] * weight;
          b += srcData[idx + 2] * weight;
        }
      }
      const idx = (y * width + x) * 4;
      dstData[idx] = r;
      dstData[idx + 1] = g;
      dstData[idx + 2] = b;
      dstData[idx + 3] = srcData[idx + 3];
    }
  }
  newCtx.putImageData(newImageData, 0, 0);
  return newCtx;
}

function applyContrastEnhancement(ctx, width, height) {
  const canvas = ctx.canvas;
  const newCanvas = Canvas.createCanvas(width, height);
  const newCtx = newCanvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, width, height);
  const newImageData = newCtx.createImageData(width, height);
  const srcData = imageData.data;
  const dstData = newImageData.data;
  const hist = new Array(256).fill(0);
  const totalPixels = width * height;
  for (let i = 0; i < srcData.length; i += 4) {
    const gray = Math.round(0.299 * srcData[i] + 0.587 * srcData[i+1] + 0.114 * srcData[i+2]);
    hist[gray]++;
  }
  const cdf = new Array(256);
  cdf[0] = hist[0];
  for (let i = 1; i < 256; i++) cdf[i] = cdf[i-1] + hist[i];
  const cdfMin = cdf.find(v => v > 0);
  const lookup = new Array(256);
  for (let i = 0; i < 256; i++) lookup[i] = Math.round(((cdf[i] - cdfMin) / (totalPixels - cdfMin)) * 255);
  for (let i = 0; i < srcData.length; i += 4) {
    const gray = Math.round(0.299 * srcData[i] + 0.587 * srcData[i+1] + 0.114 * srcData[i+2]);
    const newGray = lookup[gray];
    dstData[i] = newGray; dstData[i + 1] = newGray; dstData[i + 2] = newGray; dstData[i + 3] = srcData[i + 3];
  }
  newCtx.putImageData(newImageData, 0, 0);
  return newCtx;
}

function applyOtsuBinarization(ctx, width, height) {
  const canvas = ctx.canvas;
  const newCanvas = Canvas.createCanvas(width, height);
  const newCtx = newCanvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, width, height);
  const newImageData = newCtx.createImageData(width, height);
  const srcData = imageData.data;
  const dstData = newImageData.data;
  const hist = new Array(256).fill(0);
  const grayValues = new Uint8Array(width * height);
  for (let i = 0; i < srcData.length; i += 4) {
    const gray = Math.round(0.299 * srcData[i] + 0.587 * srcData[i+1] + 0.114 * srcData[i+2]);
    grayValues[i / 4] = gray;
    hist[gray]++;
  }
  const total = width * height;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, wF = 0, maxVar = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) * (mB - mF);
    if (varBetween > maxVar) { maxVar = varBetween; threshold = t; }
  }
  for (let i = 0; i < grayValues.length; i++) {
    const gray = grayValues[i];
    const binary = gray > threshold ? 255 : 0;
    const idx = i * 4;
    dstData[idx] = binary; dstData[idx + 1] = binary; dstData[idx + 2] = binary; dstData[idx + 3] = srcData[idx + 3];
  }
  newCtx.putImageData(newImageData, 0, 0);
  return newCtx;
}

module.exports = { preprocessImage, applyDeskew, applyGaussianBlur, applyContrastEnhancement, applyOtsuBinarization, PREPROCESSING_ENABLED };