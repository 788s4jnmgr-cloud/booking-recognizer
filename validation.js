/**
 * 字段校验模块 - Field Validation Module
 * 提供 ISO 6346 集装箱校验、格式校验等
 */

const VALID_SIZE_TYPES = ['20GP', '20HC', '20RF', '20OT', '20FR', '22GP', '22HC', '22RF', '22OT', '22FR', '40GP', '40HC', '40RF', '40OT', '40FR', '45GP', '45HC', '45RF', '45OT', '45FR', '40HQ', '45HQ'];

function validateContainerNo(containerNo) {
  if (!containerNo || typeof containerNo !== 'string') return { valid: false, error: '箱号不能为空' };
  const upper = containerNo.toUpperCase().replace(/[\s\-]/g, '');
  if (upper.length !== 12 && upper.length !== 11) return { valid: false, error: `箱号长度应为11或12位，实际${upper.length}位` };
  const letters = upper.slice(0, 4);
  if (!/^[A-Z]{4}$/.test(letters)) return { valid: false, error: '箱号前4位应为字母' };
  function letterToNumber(char) {
    const code = char.charCodeAt(0) - 55;
    if (char === 'I' || char === 'O') return null;
    return code;
  }
  if (upper.length === 12) {
    if (!/^[0-9]{7}$/.test(upper.slice(4))) return { valid: false, error: '箱号第5-11位应为7位数字' };
    let sum = 0;
    for (let i = 0; i < 11; i++) {
      let value;
      if (i < 4) {
        value = letterToNumber(upper[i]);
        if (value === null) return { valid: false, error: '箱号包含无效字母(I或O)' };
        value *= Math.pow(2, i);
      } else {
        value = parseInt(upper[i], 10) * Math.pow(2, i);
      }
      sum += value;
    }
    const checkDigit = sum % 11 === 10 ? '0' : String(sum % 11);
    const actualCheckDigit = upper[11];
    if (checkDigit !== actualCheckDigit) return { valid: false, error: `箱号校验位错误，期望${checkDigit}，实际${actualCheckDigit}`, expected: checkDigit };
  } else {
    for (let i = 0; i < 4; i++) if (letterToNumber(upper[i]) === null) return { valid: false, error: '箱号包含无效字母(I或O)' };
  }
  return { valid: true };
}

function validateBookingNo(bookingNo) {
  if (!bookingNo) return { valid: null };
  const cleaned = bookingNo.replace(/[\s]/g, '').toUpperCase();
  if (cleaned.length < 6 || cleaned.length > 20) return { valid: false, error: `订舱号长度应在6-20位之间，实际${cleaned.length}位` };
  if (!/^[A-Z0-9\-]+$/.test(cleaned)) return { valid: false, error: '订舱号只能包含字母、数字和连字符' };
  return { valid: true };
}

function validateBlNo(blNo) {
  if (!blNo) return { valid: null };
  const cleaned = blNo.replace(/[\s]/g, '').toUpperCase();
  if (cleaned.length < 6 || cleaned.length > 20) return { valid: false, error: `B/L号长度应在6-20位之间，实际${cleaned.length}位` };
  if (!/^[A-Z0-9]+$/.test(cleaned)) return { valid: false, error: 'B/L号只能包含字母和数字' };
  return { valid: true };
}

function validateGrossWeight(weight) {
  if (weight === null || weight === undefined) return { valid: null };
  if (typeof weight !== 'number' || isNaN(weight)) return { valid: false, error: '毛重应为数字' };
  if (weight <= 0) return { valid: false, error: '毛重必须大于0' };
  if (weight > 100000) return { valid: false, error: `毛重超过合理范围(100,000 KG)，实际${weight} KG` };
  return { valid: true };
}

function validateVolume(volume) {
  if (volume === null || volume === undefined) return { valid: null };
  if (typeof volume !== 'number' || isNaN(volume)) return { valid: false, error: '体积应为数字' };
  if (volume <= 0) return { valid: false, error: '体积必须大于0' };
  if (volume > 500) return { valid: false, error: `体积超过合理范围(500 CBM)，实际${volume} CBM` };
  return { valid: true };
}

function validateDate(dateStr) {
  if (!dateStr) return { valid: null };
  const cleaned = dateStr.trim();
  const dateRegex = /^\d{4}[-\/]\d{2}[-\/]\d{2}$/;
  if (!dateRegex.test(cleaned)) return { valid: false, error: '日期格式应为 YYYY-MM-DD 或 YYYY/MM/DD' };
  const [year, month, day] = cleaned.split(/[-\/]/).map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return { valid: false, error: '日期无效' };
  if (year < 2000 || year > 2100) return { valid: false, error: '日期应在2000-2100年之间' };
  return { valid: true };
}

function validateSizeType(sizeType) {
  if (!sizeType) return { valid: null };
  const normalized = sizeType.toUpperCase().trim();
  if (!VALID_SIZE_TYPES.includes(normalized)) return { valid: false, error: `无效的箱型尺寸: ${sizeType}，有效值: ${VALID_SIZE_TYPES.join(', ')}` };
  return { valid: true };
}

function validateFreight(freight) {
  if (!freight) return { valid: null };
  const normalized = freight.toUpperCase().trim();
  if (!['PREPAID', 'COLLECT'].includes(normalized)) return { valid: false, error: '运费条款应为 PREPAID 或 COLLECT' };
  return { valid: true };
}

function validateParseResult(parseResult) {
  const validation = {};
  validation.bookingNo = validateBookingNo(parseResult.bookingNo);
  validation.fileNo = validateBookingNo(parseResult.fileNo);
  validation.blNo = validateBlNo(parseResult.blNo);
  validation.grossWeight = validateGrossWeight(parseResult.grossWeight);
  validation.volume = validateVolume(parseResult.volume);
  validation.eta = validateDate(parseResult.eta);
  validation.etd = validateDate(parseResult.etd);
  validation.shipDate = validateDate(parseResult.shipDate);
  validation.freight = validateFreight(parseResult.freight);
  validation.containers = parseResult.containers?.map((c, i) => {
    const result = { index: i, containerNo: validateContainerNo(c.containerNo) };
    if (c.sizeType) result.sizeType = validateSizeType(c.sizeType);
    return result;
  }) || [];
  let hasErrors = false;
  for (const [field, check] of Object.entries(validation)) {
    if (field === 'containers') {
      if (check.some(c => (c.containerNo && c.containerNo.valid === false) || (c.sizeType && c.sizeType.valid === false))) { hasErrors = true; break; }
    } else if (check && check.valid === false) { hasErrors = true; break; }
  }
  validation.hasErrors = hasErrors;
  return validation;
}

module.exports = { validateContainerNo, validateBookingNo, validateBlNo, validateGrossWeight, validateVolume, validateDate, validateSizeType, validateFreight, validateParseResult, VALID_SIZE_TYPES };