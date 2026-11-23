/**
 * 订舱识别模块 - Booking Recognition Module
 * 从订舱单/海运单据中提取结构化信息
 */

class BookingRecognizer {
  constructor() {
    // 字段模式定义
    this.patterns = {
      bookingNo: /BOOKING\s*(?:NO|Number|No\.?|No)(?:\s+[：:\s]|[^a-zA-Z])[：:\s]*([A-Z0-9\-]+)/i,
      fileNo: /FILE\s*(?:NO|Number|No\.?)[：:\s]*([A-Z0-9\-]+)/i,
      blNo: /(?:B[\/\\]L|BILL\s*OF\s*LADING)\s*(?:NO|Number|No\.?)[：:\s]*([A-Z0-9]+)/i,

      vesselVoyage: /VESSEL[：:\s]*([A-Z\s]+)\s*(?:VOYAGE|VOY|NO\.?|No)?[：:\s]*([A-Z0-9]+)/i,
      portOfLoading: /(?:PORT\s*OF\s*LOADING|\bPOL\b|LOADING\s*PORT|装\s*货\s*港|起\s*运\s*港)[：:\s]*([A-Z][A-Z\s,]+?)(?=\s*\n|\s*,|\s+PORT|\s+装|$)/i,
      portOfDischarge: /(?:PORT\s*OF\s*DISCHARGE|\bPOD\b|DISCHARGE\s*PORT|卸\s*货\s*港|交\s*货\s*地|目\s*的\s*港)[：:\s]*([A-Z][A-Z\s,]+?)(?=\s*\n|\s*,|\s+PORT|\s+卸|\s+交|$)/i,

      containerInfo: /([A-Z]{4}[0-9]{7})\s+(20GP|22GP|40GP|40HC|45HC|45GP|20RF|40RF|20OT|40OT|20FR|40FR)/gi,
      sealNo: /SEAL\s*(?:NO|Number)[：:\s]*([A-Z0-9]+)/i,
      grossWeight: /(?:GROSS\s*WEIGHT|毛\s*重\s*[（(]?\s*KGS?\s*[)）]?)[：:\s]*([\d,\.]+)/i,
      packages: /(?:件\s*数|包\s*数|PACKAGES?|PCS)[：:\s]*([\d,]+)/i,
      volume: /VOLUME[：:\s]*([\d,\.]+)\s*(?:CBM|M3|CUBIC)/i,
      eta: /ETA[：:\s]*(\d{4}[-\/]\d{2}[-\/]\d{2})/i,
      etd: /ETD[：:\s]*(\d{4}[-\/]\d{2}[-\/]\d{2})/i,
      shipDate: /ON\s*BOARD[：:\s]*(\d{4}[-\/]\d{2}[-\/]\d{2})/i,
      freight: /FREIGHT[：:\s]*(PREPAID|COLLECT)/i
    };
  }

  /**
   * 解析文本内容
   * @param {string} text - OCR或提取的文本
   * @returns {Object} 结构化数据
   */
  parse(text) {
    const result = {
      documentType: this.detectDocumentType(text),
      bookingNo: this.extractField(text, 'bookingNo'),
      fileNo: this.extractField(text, 'fileNo'),
      blNo: this.extractField(text, 'blNo'),
      vessel: null,
      voyage: null,
      portOfLoading: this.cleanValue(this.extractField(text, 'portOfLoading')),
      portOfDischarge: this.cleanValue(this.extractField(text, 'portOfDischarge')),
      containers: this.extractContainers(text),
      grossWeight: null,
      volume: this.extractNumericField(text, 'volume'),
      eta: this.extractField(text, 'eta'),
      etd: this.extractField(text, 'etd'),
      shipDate: this.extractField(text, 'shipDate'),
      freight: this.extractField(text, 'freight'),
      rawText: text
    };

    // 提取船名航次
    this.extractVesselVoyage(text, result);

    // 提取 Hapag-Lloyd 专用字段
    this.extractHLCFields(text, result);

    // 毛重: 优先 Σ 各箱明细 (Hapag-Lloyd 模板无单独总毛重)
    result.grossWeight = this.computeGrossWeight(text, result.containers);

    // 提取入货通知格式字段
    if (result.documentType === 'CARGO_RECEIVING_NOTICE') {
      this.extractCargoReceivingNoticeFields(text, result);
    }

    return result;
  }

  /**
   * 解析数字字符串 (兼容欧式 "10860,0" 和美式 "10,860.50" 格式)
   * @param {string} s - 原始数字字符串
   * @returns {number|null}
   */
  parseLocalizedNumber(s) {
    if (!s) return null;
    let str = String(s).trim();
    if (!str) return null;
    const hasComma = str.includes(',');
    const hasDot = str.includes('.');
    if (hasComma && hasDot) {
      // 两者都有: 最后一个是 decimal 分隔符
      if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
        // 欧式: "10.860,50" → "10860.50"
        str = str.replace(/\./g, '').replace(',', '.');
      } else {
        // 美式: "10,860.50" → "10860.50"
        str = str.replace(/,/g, '');
      }
    } else if (hasComma) {
      // 仅逗号: 欧式 decimal "10860,0" → "10860.0"
      // 但若逗号后正好 3 位, 也可能是 thousands "10,860" → "10860"
      const parts = str.split(',');
      if (parts.length === 2 && parts[1].length === 3 && parts[0].length >= 1) {
        // "10,860" 形式 → 当 thousands 处理
        str = str.replace(',', '');
      } else {
        // 欧式 decimal
        str = str.replace(',', '.');
      }
    }
    const v = parseFloat(str);
    return isNaN(v) ? null : v;
  }

  /**
   * 计算毛重
   * 策略: 优先 Σ 各箱明细 "Gross Weight: X KGM"
   * 兜底: 取第一个 "GROSS WEIGHT: X" (单货场景)
   * 修复: 旧版只取第一个匹配, 漏掉多箱汇总; 欧式 "10860,0" 被错当 thousands 得 108600
   */
  computeGrossWeight(text, containers) {
    // 1. 优先: 找所有 "Gross Weight: X KGM" 明细并求和
    const perBoxRegex = /Gross\s*Weight[：:\s]*([\d,\.]+)\s*KGM/gi;
    const matches = [...text.matchAll(perBoxRegex)];
    if (matches.length >= 2) {
      let total = 0;
      for (const m of matches) {
        const v = this.parseLocalizedNumber(m[1]);
        if (v !== null && v > 0 && v < 1e7) total += v;
      }
      if (total > 0) return Math.round(total);
    }

    // 2. 兜底: 单条 GROSS WEIGHT (单货非分箱明细)
    if (matches.length === 1) {
      return this.parseLocalizedNumber(matches[0][1]);
    }

    // 3. 最后: 用最初的正则 (兼容其他格式)
    return this.extractNumericField(text, 'grossWeight');
  }

  /**
   * 检测文档类型
   */
  detectDocumentType(text) {
    if (/BOOKING\s*NOTE\s*$|^\s*BOOKING\s*NOTE\s*\n/im.test(text)) return 'BOOKING_NOTE';
    if (/BILL\s*OF\s*LADING/i.test(text)) return 'BILL_OF_LADING';
    if (/MARINE\s*B[\/\\]L/i.test(text)) return 'MARINE_BL';
    if (/SEAWAY\s*BILL/i.test(text)) return 'SEAWAY_BILL';
    if (/FIXTURE\s*NOTE/i.test(text)) return 'FIXTURE_NOTE';
    if (/入\s*货\s*通\s*知/i.test(text)) return 'CARGO_RECEIVING_NOTICE';
    return 'UNKNOWN';
  }

  /**
   * 提取字段
   */
  extractField(text, fieldName) {
    const pattern = this.patterns[fieldName];
    if (!pattern) return null;
    // 防御全局标志：全局模式下 match 不返回捕获组，需用非全局副本
    const regex = pattern.global ? new RegExp(pattern.source, pattern.flags.replace('g', '')) : pattern;
    const match = regex.exec(text);
    return match ? match[1]?.trim() : null;
  }

  /**
   * 提取 Hapag-Lloyd 专用字段
   */
  extractHLCFields(text, result) {
    // 提取 HLCU 开头的提单号
    if (!result.blNo) {
      const blMatch = text.match(/HLCU[A-Z0-9]+/i);
      if (blMatch) {
        result.blNo = blMatch[0].toUpperCase();
      }
    }

    // 优先: 解析明细列表 (Hapag-Lloyd 模板用 HIGH CUBE/GENERAL PURPOSE CONT. 描述每个箱)
    // 模式: "<长度>' X <宽>' X <高>" "类型" "CONT."
    // 例: "40' X 8' X 9'6\" HIGH CUBE CONT." → 40HC
    // 例: "20' X 8' X 8'6\" GENERAL PURPOSE CONT." → 20GP
    // 容差: 允许 PDF 解析丢空格 ("HIGHCUBECONT." / "40'X8'X9'6")
    const detailRegex = /(\d+)'\s*X\s*\d+'\s*X\s*[\d'"]+\s*(HIGH\s*CUBE|GENERAL\s*PURPOSE|REEFER|OPEN\s*TOP|FLAT\s*RACK)\s*CONT\./gi;
    const detailMatches = [...text.matchAll(detailRegex)];
    if (detailMatches.length > 0) {
      const detailContainers = [];
      for (const m of detailMatches) {
        const length = parseInt(m[1], 10);
        // 归一化: 去所有空白 (兼容 "HIGHCUBE" 和 "HIGH CUBE")
        const category = m[2].toUpperCase().replace(/\s+/g, '');
        const sizeType = this.sizeTypeFromDetail(length, category);
        detailContainers.push({ sizeType, containerNo: null });
      }
      // 明细优先: 替换现有结果
      result.containers = detailContainers;
      return;
    }

    // 兜底: 摘要 "Nx" 格式 (支持多组 "2x45GP,1x22GP")
    if (result.containers.length === 0) {
      const summaryRegex = /(\d+)\s*[xX*×]\s*((?:20|22|40|45)(?:GP|HC|RF|OT|FR|HQ))/gi;
      let m;
      while ((m = summaryRegex.exec(text)) !== null) {
        const count = parseInt(m[1], 10);
        const sizeType = this.normalizeSizeType(m[2]);
        for (let i = 0; i < count; i++) {
          result.containers.push({ sizeType, containerNo: null });
        }
      }
    }
  }

  /**
   * 从明细描述 ("HIGH CUBE" / "GENERAL PURPOSE" 等) + 长度推导箱型
   * @param {number} length - 20 / 40
   * @param {string} category - 归一化后无空白: HIGHCUBE / GENERALPURPOSE / REEFER / OPENTOP / FLATRACK
   * @returns {string} 标准化箱型
   */
  sizeTypeFromDetail(length, category) {
    const map = {
      'HIGHCUBE': length === 40 ? '40HC' : '20HC',
      'GENERALPURPOSE': length === 40 ? '40GP' : '20GP',
      'REEFER': length === 40 ? '40RF' : '20RF',
      'OPENTOP': length === 40 ? '40OT' : '20OT',
      'FLATRACK': length === 40 ? '40FR' : '20FR',
    };
    return map[category] || `${length}GP`;
  }

  /**
   * 提取入货通知格式字段（中文带空格格式）
   */
  extractCargoReceivingNoticeFields(text, result) {
    // 清除中文空格后的文本
    const cleanText = this.removeChineseSpaces(text);

    // 船名航次: 船 名 航 次:ZHONG GU YIN CHUAN 25028W (无斜杠，空格分隔，Word文档)
    if (!result.vessel) {
      const vesselNoSlashMatch = text.match(/船\s*名\s*航\s*次[：:\s]*([A-Z][A-Z\s]+?)\s+(\d{5,7}[A-Z])\b/i);
      if (vesselNoSlashMatch) {
        result.vessel = this.normalizeVesselName(vesselNoSlashMatch[1].trim());
        result.voyage = vesselNoSlashMatch[2].trim().toUpperCase();
      }
    }

    // 船名航次: 船名航次:RACINE26007W (无空格连在一起，cleanText中船名无空格)
    if (!result.vessel) {
      const vesselVoyageMatch = cleanText.match(/船名航次[：:\s]*([A-Z]+)(\d{5,7}[A-Z])/i);
      if (vesselVoyageMatch) {
        result.vessel = this.normalizeVesselName(vesselVoyageMatch[1].trim());
        result.voyage = vesselVoyageMatch[2].trim().toUpperCase();
      }
    }

    // 船名/航次:NORTHERN MATESTIC/25027W (斜杠在标签里,值也用斜杠)
    if (!result.vessel) {
      const vesselSlashMatch = cleanText.match(/船名[\/／]航次[：:\s]*([A-Z][A-Z\s]+?)[\/／](\d{4,6}[A-Z]?)/);
      if (vesselSlashMatch) {
        result.vessel = this.normalizeVesselName(vesselSlashMatch[1].trim());
        result.voyage = vesselSlashMatch[2].trim().toUpperCase();
      }
    }

    // 船名航次: 船名航次:\nZHONG GU YIN CHUAN / 25028W (带空格的船名)
    if (!result.vessel || !result.voyage) {
      const vesselVoyageSpaceMatch = text.match(/船名航次:\s*([A-Z][A-Z\s]+?)\s*\/\s*(\d{5,7}[A-Z])\b/i);
      if (vesselVoyageSpaceMatch) {
        result.vessel = this.normalizeVesselName(vesselVoyageSpaceMatch[1].trim());
        result.voyage = vesselVoyageSpaceMatch[2].trim().toUpperCase();
      }
    }

    // 船名航次: 船 名 航 次:ZHONG GU YIN CHUAN 25028W (无斜杠，空格分隔)
    if (!result.vessel) {
      const vesselNoSlashMatch = text.match(/船\s*名\s*航\s*次[：:\s]*([A-Z][A-Z\s]+?)\s+(\d{5,7}[A-Z])\b/i);
      if (vesselNoSlashMatch) {
        result.vessel = this.normalizeVesselName(vesselNoSlashMatch[1].trim());
        result.voyage = vesselNoSlashMatch[2].trim().toUpperCase();
      }
    }

    // VSL&VOY 格式: VSL&VOY：ZHONG GU CHENG DU/25047W
    const vslVoyMatch = text.match(/VSL\s*&\s*VOY[：:\s]*([A-Z\s]+)\/(\d{5,7}[A-Z])/i);
    if (vslVoyMatch) {
      result.vessel = this.normalizeVesselName(vslVoyMatch[1].trim());
      result.voyage = vslVoyMatch[2].trim().toUpperCase();
    }

    // VSL&VOY 变体: VSL&VOY: ZHONG GU CHENG DU/25047W
    if (!result.vessel && !result.voyage) {
      const vslVoyMatch2 = text.match(/VSL\s*&\s*VOY[：:\s]*([A-Z][A-Z\s]+?)\s*\/\s*(\d{5,7}[A-Z])\b/i);
      if (vslVoyMatch2) {
        result.vessel = this.normalizeVesselName(vslVoyMatch2[1].trim());
        result.voyage = vslVoyMatch2[2].trim().toUpperCase();
      }
    }

    // 提单号 & 箱型: 入货通知格式 "提单号：FQD0N00490  2*40HC" 中，BL号与箱型写在同一行
    // 提取思路：将 "FQD0N004902*40HC" 用 * 分割，前半段末尾数字为箱量，前面的为BL号
    // 注意：箱型/数量交给 extractContainers 统一处理(避免双重 push),这里只抽 BL 号
    if (!result.blNo) {
      const blStart = cleanText.indexOf('提单号');
      if (blStart >= 0) {
        const afterBl = cleanText.substring(blStart + 4);
        const nextFieldMatch = afterBl.match(/([一-龥]+[：:\s]|开船时间|卸货港|箱量|截单时间|截港时间)/);
        const blLine = nextFieldMatch ? afterBl.substring(0, nextFieldMatch.index) : afterBl;
        if (blLine.includes('*')) {
          // "FQD0N004892*40HC" → BL="FQD0N00489",count=2,sizeType="40HC" 留给 extractContainers
          const parts = blLine.split('*');
          const prefix = parts[0]; // "FQD0N004892"
          const countMatch = prefix.match(/(\d)(?=\*?$)/);
          if (countMatch) {
            result.blNo = prefix.substring(0, prefix.length - 1).toUpperCase();
          } else {
            result.blNo = prefix.toUpperCase();
          }
        } else {
          // 无 * 格式，正常提取BL号（通用模式）
          const blMatch = cleanText.match(/提单号[：:\s]*([A-Z0-9]+?)(?=[一-龥]|$)/i);
          if (blMatch) {
            result.blNo = blMatch[1].toUpperCase();
          }
        }
      }
    }
    // B/L NO 格式
    if (!result.blNo) {
      const blNoMatch = text.match(/B\s*[\/\\]\s*L\s*NO[：:\s]*([A-Z0-9]+)/i);
      if (blNoMatch) {
        result.blNo = blNoMatch[1].toUpperCase();
      }
    }

    // 卸货港: 卸货港：BANDARABBAS
    const podMatch = cleanText.match(/卸货港[：:\s]*([A-Z]+?)(?=\d+X)/i);
    if (podMatch) {
      result.portOfDischarge = podMatch[1].trim();
    }

    // PORT OF DISCHARGE 格式
    if (!result.portOfDischarge) {
      const portMatch = text.match(/DESTINATION[：:\s]*([A-Z\s]+?)(?=VOLUME|B\s*[\/\\]\s*L|$)/i);
      if (portMatch) {
        result.portOfDischarge = portMatch[1].trim().replace(/\s+/g, ' ');
      }
    }

    // PORTLOAD 连写格式: PORTLOAD：QINGDAO,CHINA
    if (!result.portOfLoading) {
      const polMatch = text.match(/PORTLOAD[：:\s]*([A-Z,\s]+?)(?=DESTINATION|VSL|VOY|$)/i);
      if (polMatch) {
        result.portOfLoading = polMatch[1].trim().replace(/[,，\s]+$/, '').replace(/\s+/g, ' ');
      }
    }

    // 卸货港 DESTINATION: BANDAR ABBAS,IRAN
    if (!result.portOfDischarge) {
      const portMatch = text.match(/DESTINATION[：:\s]*([A-Z][A-Z\s,]+?)(?=VSL|VOLUME|B\s*[\/\\]\s*L|ETD|截|$)/i);
      if (portMatch) {
        result.portOfDischarge = portMatch[1].trim().replace(/[,，\s]+$/, '').replace(/\s+/g, ' ');
      }
    }

    // 箱型: 1X40HC (标准) 或 1*40HC (入货通知格式，箱型写在提单号同行)
    if (result.containers.length === 0) {
      const containerMatch = cleanText.match(/(\d+)[X*](40HC|40HQ|40GP|20GP|45GP|45HC)/i);
      if (containerMatch) {
        const count = parseInt(containerMatch[1]);
        const sizeType = this.normalizeSizeType(containerMatch[2]);
        for (let i = 0; i < count; i++) {
          result.containers.push({
            sizeType: sizeType,
            containerNo: null
          });
        }
      }
    }
    // VOLUME: 40HC*1 格式 (箱型在前) 或 箱量：1*40HQ
    if (result.containers.length === 0) {
      const volumeMatch = text.match(/VOLUME[：:\s]*(40HC|40HQ|40GP|20GP|45GP|45HC)\s*\*\s*(\d+)/i);
      if (volumeMatch) {
        const count = parseInt(volumeMatch[2]);
        const sizeType = this.normalizeSizeType(volumeMatch[1]);
        for (let i = 0; i < count; i++) {
          result.containers.push({
            sizeType: sizeType,
            containerNo: null
          });
        }
      }
    }

    // 箱量：1*40HQ 格式
    if (result.containers.length === 0) {
      const boxCountMatch = text.match(/箱\s*量[：:\s]*(\d+)\s*\*\s*(40HQ|40HC|40GP|20GP|45GP|45HC)/i);
      if (boxCountMatch) {
        const count = parseInt(boxCountMatch[1]);
        const sizeType = this.normalizeSizeType(boxCountMatch[2]);
        for (let i = 0; i < count; i++) {
          result.containers.push({
            sizeType: sizeType,
            containerNo: null
          });
        }
      }
    }
  }

  /**
   * 提取数值字段
   */
  extractNumericField(text, fieldName) {
    const pattern = this.patterns[fieldName];
    if (!pattern) return null;
    const match = text.match(pattern);
    if (!match) return null;
    const value = match[1]?.replace(/,/g, '').trim();
    return parseFloat(value) || null;
  }

  /**
   * 清理值
   */
  cleanValue(value) {
    if (!value) return null;
    return value.replace(/\s+/g, ' ').replace(/[,.\s]+$/, '').trim();
  }

  /**
   * 标准化箱型尺寸
   * 22GP 统一为 20GP
   * 45GP 统一为 40HC
   */
  normalizeSizeType(sizeType) {
    const sizeMap = {
      '22GP': '20GP',
      '22HC': '20HC',
      '22RF': '20RF',
      '22OT': '20OT',
      '22FR': '20FR',
      '45GP': '40HC',
      '40HQ': '40HC'
    };
    return sizeMap[sizeType.toUpperCase()] || sizeType.toUpperCase();
  }

  /**
   * 清除中文空格
   */
  removeChineseSpaces(text) {
    return text.replace(/\s+/g, '').trim();
  }

  /**
   * 标准化船名
   * 清除多余空格，A.P. MOLLER 转为 A.P.MOLLER，但保留一般船名中的空格
   */
  normalizeVesselName(vessel) {
    if (!vessel) return null;
    let normalized = vessel.trim();
    // A.P. MOLLER 转为 A.P.MOLLER（去掉点号后的空格）
    normalized = normalized.replace(/A\.P\.\s*MOLLER/i, 'A.P.MOLLER');
    // 清除其他多余空格（多个空格变一个，包括不间断空格  ）
    normalized = normalized.replace(/[\s ]+/g, ' ').trim();
    return normalized;
  }

  /**
   * 提取船名航次
   */
  extractVesselVoyage(text, result) {
    // 1. 提取航次 (Voy. No 优先 > VOYAGE: > DP Voyage)
    const voyNoMatches = [...text.matchAll(/Voy\.?\s*No[：:\s]*(\d{2,4}[A-Z]?)/gi)];
    const primaryVoyMatch = voyNoMatches[0] || null;
    const voyageMatch = text.match(/VOYAGE[：:\s]*(\d{2,4}[A-Z]?)/i);
    const dpVoyageMatch = text.match(/DP\s*Voyage[：:\s]*(\d{2,4}[A-Z]?)/i);

    if (primaryVoyMatch) {
      result.voyage = primaryVoyMatch[1].trim().toUpperCase();
    } else if (voyageMatch) {
      result.voyage = voyageMatch[1].trim().toUpperCase();
    } else if (dpVoyageMatch) {
      result.voyage = dpVoyageMatch[1].trim().toUpperCase();
    }

    // 2. 提取船名 (策略 A→D 优先级)
    let vesselName = null;

    // 策略 A: 基于 Voy. No 锚点反向查找 (Hapag-Lloyd 模板专用)
    if (!vesselName) {
      vesselName = this.findVesselNameByVoyNoAnchor(text, primaryVoyMatch || dpVoyageMatch);
    }

    // 策略 B: 标准 VESSEL: NAME 格式 (单独行)
    if (!vesselName) {
      const stdMatch = text.match(/(?:^|\n)\s*VESSEL[：:\s]+([A-Z][A-Z\s.]+?)(?:\n|$)/im);
      if (stdMatch) {
        const cand = stdMatch[1].trim();
        if (cand.length >= 3 && /^[A-Z][A-Z\s.]+$/.test(cand)) {
          vesselName = cand;
        }
      }
    }

    // 策略 C: PNIT <NAME> HH:MM 格式 (集装箱码头时刻表)
    if (!vesselName) {
      const pnitMatch = text.match(/PNIT\s+([A-Z][A-Z\s]+?)\s+\d{2}:\d{2}/im);
      if (pnitMatch) {
        vesselName = pnitMatch[1].trim();
      }
    }

    // 策略 D: 船名航次同行 "A.P. MOLLER 622W"
    if (!vesselName || !result.voyage) {
      const vm = text.match(/([A-Z][.A-Z\s]+?)\s+(\d{2,4}[A-Z])\b/);
      if (vm && vm[1].length >= 3) {
        vesselName = vm[1].trim();
        if (!result.voyage) result.voyage = vm[2].trim().toUpperCase();
      }
    }

    if (vesselName) {
      result.vessel = this.normalizeVesselName(vesselName);
    }

    // 3. 中转场景: 检测副船 (第二个 Voy. No 锚点)
    if (voyNoMatches.length >= 2) {
      const secondVoy = voyNoMatches[1];
      // 副船航次必须不同于主船
      if (secondVoy[1].toUpperCase() !== result.voyage) {
        const secondVessel = this.findVesselNameByVoyNoAnchor(text, secondVoy);
        if (secondVessel && secondVessel !== result.vessel) {
          result.secondVessel = this.normalizeVesselName(secondVessel);
          result.secondVoyage = secondVoy[1].trim().toUpperCase();
        }
      }
    }
  }

  /**
   * 基于 Voy. No / DP Voyage 锚点反向查找船名 (Hapag-Lloyd 模板专用)
   * 原理: 船名在 Voy. No 之前 ≤ 400 字符内, 是"全大写多词行"
   * 修复: 旧版 `i` 标志导致 `[A-Z]` 匹配小写, 抓到正文 "vesselscheduleyouinitiallyrequested..."
   *
   * @param {string} text - 全文
   * @param {RegExpMatchArray|null} anchorMatch - Voy. No 或 DP Voyage 的 match 结果
   * @returns {string|null} 船名
   */
  findVesselNameByVoyNoAnchor(text, anchorMatch) {
    if (!anchorMatch) return null;

    const anchorIdx = anchorMatch.index;
    const beforeAnchor = text.substring(Math.max(0, anchorIdx - 400), anchorIdx);
    const lines = beforeAnchor.split(/[\n\r]+/).map(l => l.trim()).filter(l => l.length > 0);

    // 黑名单: Hapag-Lloyd 模板常见但不是船名的全大写短语
    const BLACKLIST = new Set([
      // 标签
      'VESSEL', 'VOYAGE', 'DP VOYAGE', 'IMO NO', 'CALL SIGN', 'FLAG', 'FCL',
      'BILL OF LADING', 'BOOKING CONFIRMATION', 'REMARKS', 'REMARK',
      'CUT-OFF', 'CUT OFF', 'FREIGHT FORWARDER', 'FREIGHT', 'HAULAGE', 'MERCHANT',
      'CY', 'UPDATE', 'SUBMIT YOUR VGM', 'PROVIDE', 'ACCORDING', 'PLEASE',
      // 港口/码头
      'QINGDAO', 'ROTTERDAM', 'TANGER MED', 'TANGER', 'APAPA', 'CUIJK',
      'APM2', 'APM2 TERM.MAASVLAKTE', 'TERM.MAASVLAKTE',
      'QQCT APMT TC4', 'QQCT APMT TC', 'QQCT',
      'TANGER MED TC3', 'APAPA QUAY, APAPA', 'APAPA QUAY',
      // 港口组合 (route 标题)
      'QINGDAO TANGER MED', 'TANGER MED APAPA', 'ROTTERDAM APM2',
      // 国家 UN/LOCODE
      'SHANGHAI', 'NINGBO', 'DALIAN', 'LOS ANGELES', 'LONG BEACH',
      'HAMBURG', 'ANTWERP', 'DUBAI', 'SINGAPORE', 'HONG KONG', 'BUSAN',
      'CNTAO', 'MAPTM', 'NGAPP', 'NLRTM', 'NLCUY',
      // 国家/地区
      'CHINA', 'NETHERLANDS', 'GERMANY', 'DENMARK', 'MALTA', 'SINGAPORE',
      'EUROPE', 'ASIA', 'AFRICA', 'AMERICA', 'TRADE', 'TRADES',
      // 机构
      'HAPAG-LLOYD', 'HAPAG LLOYD', 'HAPAGLLOYD', 'HAPAG-LLOYD AKTIENGESELLSCHAFT',
      'KUEHNE & NAGEL LTD.', 'KUEHNE & NAGEL', 'KUEHNE NAGEL',
      'CHAIRMAN OF THE SUPERVISORY BOARD', 'EXECUTIVE BOARD', 'REGISTERED OFFICE',
      'COMPANY REGISTER', 'SUPERVISORY BOARD', 'HOLDING',
    ]);

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];

      // 清理行尾时间戳: "SEASPANPRIDE 21:00 16:00" → "SEASPANPRIDE"
      // 或 "SEASPANPRIDE21:00" → "SEASPANPRIDE" (PDF 解析无空格)
      const cleaned = line
        .replace(/\s+\d{1,2}:\d{2}(\s+\d{1,2}:\d{2})?$/, '')
        .replace(/\d.*$/, '');

      if (!cleaned || cleaned.length < 3) continue;
      if (BLACKLIST.has(cleaned)) continue;

      // 清理后必须是全大写 (允许点号、空格、连字符)
      if (!/^[A-Z][A-Z. -]+$/.test(cleaned)) continue;

      // 必须 ≥2 词 (且每词 ≥2 字符) 或 单词 4+ 字符
      const words = cleaned.split(/\s+/);
      if (words.length === 1 && words[0].length < 4) continue;
      if (words.length === 2 && (words[0].length < 2 || words[1].length < 2)) continue;

      return cleaned;
    }

    return null;
  }

  /**
   * 提取集装箱信息
   */
  extractContainers(text) {
    const containers = [];
    let match;

    // 通用箱型片段 (避免遗漏 45GP / 22GP / 45HC 等内部叫法)
    const SIZE = '(?:20|22|40|45)(?:GP|HC|RF|OT|FR|HQ)';

    // 1. 提取箱号和箱型 (4字母+7数字箱号格式)
    const containerRegex = new RegExp(`([A-Z]{4}[0-9]{7})\\s+(${SIZE})`, 'gi');
    while ((match = containerRegex.exec(text)) !== null) {
      containers.push({
        containerNo: match[1].toUpperCase(),
        sizeType: this.normalizeSizeType(match[2])
      });
    }

    // 2. 箱型×箱量(中文变体: 40HC×2 / 1*40HC / 1x22GP / 2x45GP)
    if (containers.length === 0) {
      // 形如 40HC×2 (箱型在前,数量在后,中间 × / x / * 分隔)
      const boxCountRegex1 = new RegExp(`(${SIZE})\\s*[×xX*]\\s*(\\d+)(?!\\s*[A-Z]{4}\\d{7})`, 'g');
      while ((match = boxCountRegex1.exec(text)) !== null) {
        const sizeType = this.normalizeSizeType(match[1]);
        const count = parseInt(match[2], 10);
        for (let i = 0; i < count; i++) {
          containers.push({ containerNo: null, sizeType });
        }
      }
      // 形如 1*40HQ / 2x40GP / 2x45GP,1x22GP (数量在前,箱型在后)
      if (containers.length === 0) {
        const boxCountRegex2 = new RegExp(`(\\d+)\\s*[×xX*]\\s*(${SIZE})`, 'g');
        while ((match = boxCountRegex2.exec(text)) !== null) {
          const count = parseInt(match[1], 10);
          const sizeType = this.normalizeSizeType(match[2]);
          for (let i = 0; i < count; i++) {
            containers.push({ containerNo: null, sizeType });
          }
        }
      }
    }

    // 提取封条号
    const sealRegex = /SEAL[：:\s]*(?:NO\.?|Number)?[：:\s]*([A-Z0-9]+)/gi;
    const seals = [];
    while ((match = sealRegex.exec(text)) !== null) {
      seals.push(match[1].toUpperCase());
    }

    // 为每个集装箱分配封条号
    containers.forEach((c, i) => {
      if (seals[i]) c.sealNo = seals[i];
    });

    return containers;
  }

  /**
   * 格式化输出
   * 格式: 船名-航次-提单号-箱量-箱型尺寸
   * - 单箱型: "MUNKEBO MAERSK-624W-HLCUTA12605EOHA7-3-40HC"
   * - 混箱型: "MUNKEBO MAERSK-624W-HLCUTA12605EOHA7-3-[2x40HC+1x20GP]"
   */
  format(result) {
    const vesselVoyage = result.vessel && result.voyage
      ? `${result.vessel}-${result.voyage}`
      : result.vessel || result.voyage || 'N/A';

    const containerSummary = this.formatContainerSummary(result.containers);

    return `${vesselVoyage}-${result.blNo || result.bookingNo || 'N/A'}-${containerSummary}`;
  }

  /**
   * 格式化箱型摘要
   * - 单一箱型: "3-40HC" (3 个 40HC)
   * - 混箱型:   "3-2x40HC+1x20GP" (共 3 箱, 2 个 40HC + 1 个 20GP, 按出现顺序)
   * @param {Array} containers
   * @returns {string} 摘要
   */
  formatContainerSummary(containers) {
    if (!containers || containers.length === 0) {
      return 'N/A';
    }

    // 按出现顺序统计 (避免 Object.keys 顺序不稳定)
    const seen = [];
    const counts = {};
    for (const c of containers) {
      const type = c.sizeType || 'CONTAINER';
      if (!(type in counts)) {
        seen.push(type);
        counts[type] = 0;
      }
      counts[type] += 1;
    }

    const total = containers.length;
    if (seen.length === 1) {
      // 单一箱型
      return `${total}-${seen[0]}`;
    } else {
      // 混箱型 — 用方括号包裹
      const mixed = seen.map(t => `${counts[t]}x${t}`).join('+');
      return `${total}-[${mixed}]`;
    }
  }

  /**
   * 输出为标准格式
   */
  toStandardFormat(result) {
    return this.format(result);
  }

  /**
   * 计算字符串相似度（基于 Levenshtein 距离）
   * @param {string} str1
   * @param {string} str2
   * @returns {number} 相似度 0.0 - 1.0
   */
  calculateSimilarity(str1, str2) {
    if (!str1 && !str2) return 1.0;
    if (!str1 || !str2) return 0.0;

    const s1 = str1.toUpperCase().trim();
    const s2 = str2.toUpperCase().trim();

    if (s1 === s2) return 1.0;

    const len1 = s1.length;
    const len2 = s2.length;
    const maxLen = Math.max(len1, len2);
    if (maxLen === 0) return 1.0;

    // 计算 Levenshtein 距离
    const matrix = [];
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = s1[i-1] === s2[j-1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i-1][j] + 1,      // 删除
          matrix[i][j-1] + 1,      // 插入
          matrix[i-1][j-1] + cost  // 替换
        );
      }
    }

    const distance = matrix[len1][len2];
    return 1 - (distance / maxLen);
  }

  /**
   * 解析标准格式字符串
   * 格式: 船名-航次-提单号-箱量-箱型尺寸
   * - 单箱型: A.P.MOLLER-622W-HLCUTA12604DJZJ4-2-20GP
   * - 混箱型: MUNKEBO MAERSK-624W-HLCUTA12605EOHA7-3-2x40HC+1x20GP
   * @param {string} standardFormat
   * @returns {Object} 解析后的字段
   */
  parseStandardFormat(standardFormat) {
    if (!standardFormat || typeof standardFormat !== 'string') {
      return null;
    }

    // 混箱型: parts[4..] 用 "-" 拼接回来 (例: "2x40HC+1x20GP")
    // 用第 5 段开始重新拼接, 然后按 "+" 拆
    const headParts = standardFormat.split('-');
    if (headParts.length < 2) return null;

    const sizeTypeRaw = headParts.length > 4 ? headParts.slice(4).join('-') : (headParts[4] || null);

    // 解析箱型: "40HC" 或 "[2x40HC+1x20GP]"（混箱型被方括号包裹,先剥掉再解析）
    // 兼容:全角方括号【】、半角方括号[]、全角圆括号（）、半角圆括号()
    const sizeTypeStripped = sizeTypeRaw ? sizeTypeRaw.replace(/^[（(\[【]|[）)\]】]$/g, '') : sizeTypeRaw;
    let containerTypes = null;
    if (sizeTypeStripped) {
      if (sizeTypeStripped.includes('+')) {
        // 混箱型: ["2x40HC", "1x20GP"]
        containerTypes = sizeTypeStripped.split('+').map(s => {
          const m = s.match(/^(\d+)?x?(20GP|22GP|40GP|40HC|45HC|45GP|20RF|40RF|20OT|40OT|20FR|40FR)$/i);
          if (!m) return null;
          return {
            count: m[1] ? parseInt(m[1], 10) : 1,
            sizeType: m[2].toUpperCase()
          };
        }).filter(Boolean);
      } else {
        // 单箱型 — 同样应用正则剥掉 "Nx" 前缀 (e.g. "1x20GP" -> count:1, sizeType:20GP)
        const m = sizeTypeStripped.match(/^(\d+)?x?(20GP|22GP|40GP|40HC|45HC|45GP|20RF|40RF|20OT|40OT|20FR|40FR)$/i);
        if (m) {
          containerTypes = [{
            count: m[1] ? parseInt(m[1], 10) : 1,
            sizeType: m[2].toUpperCase()
          }];
        } else {
          containerTypes = [{ count: 1, sizeType: sizeTypeStripped.toUpperCase() }];
        }
      }
    }

    return {
      vessel: headParts[0] || null,
      voyage: headParts[1] || null,
      blNo: headParts[2] || null,
      containerCount: headParts[3] ? parseInt(headParts[3], 10) : null,
      sizeType: sizeTypeRaw,
      containerTypes,  // 新增: 解析后的箱型数组
    };
  }

  /**
   * 模糊比对识别结果与标准格式
   * 规则：提单号、箱量、箱型必须完全一致，才进行船名、航次比对
   * @param {Object} result - parse() 返回的识别结果
   * @param {string} standardFormat - 标准格式字符串，格式: 船名-航次-提单号-箱量-箱型
   * @param {number} threshold - 相似度阈值，默认 0.7 (70%)
   * @returns {Object} 比对结果 { matched: boolean, similarity: number, details: {...} }
   */
  fuzzyCompare(result, standardFormat, threshold = 0.7) {
    const expected = this.parseStandardFormat(standardFormat);
    if (!expected) {
      return {
        matched: false,
        similarity: 0,
        error: '无效的标准格式字符串'
      };
    }

    const details = {};
    const exactMatchFields = {};
    let allFieldsMatched = true;

    // === 第一步：精确匹配检查（提单号、箱量、箱型必须完全一致）===

    // 提单号精确匹配
    if (expected.blNo) {
      exactMatchFields.blNo = {
        expected: expected.blNo,
        actual: result.blNo,
        matched: expected.blNo.toUpperCase() === result.blNo?.toUpperCase()
      };
      if (!exactMatchFields.blNo.matched) {
        allFieldsMatched = false;
      }
    }

    // 箱量子集匹配: actual >= expected 即过 (识别多算 OK, 少算 fail)
    if (expected.containerCount != null) {
      const actualCount = result.containers?.length || 0;
      exactMatchFields.containerCount = {
        expected: expected.containerCount,
        actual: actualCount,
        matched: actualCount >= expected.containerCount
      };
      if (!exactMatchFields.containerCount.matched) {
        allFieldsMatched = false;
      }
    }

    // 箱型子集匹配: expected 的所有箱型尺寸必须出现在 result.containers 中(识别出更多不计入失败)
    if (expected.containerTypes && expected.containerTypes.length > 0) {
      const actualTypes = new Set(
        (result.containers || []).map(c => (c.sizeType || '').toUpperCase()).filter(Boolean)
      );
      const expectedTypes = expected.containerTypes.map(t => t.sizeType.toUpperCase());
      const missingTypes = expectedTypes.filter(t => !actualTypes.has(t));
      exactMatchFields.sizeType = {
        expected: expected.sizeType,
        actual: [...actualTypes].join('+') || '(无)',
        matched: missingTypes.length === 0,
        missingTypes,
      };
      if (!exactMatchFields.sizeType.matched) {
        allFieldsMatched = false;
      }
    }

    details.exactMatchFields = exactMatchFields;

    // 如果精确匹配字段不全部一致，直接返回不吻合
    if (!allFieldsMatched) {
      return {
        matched: false,
        similarity: 0,
        threshold,
        details,
        reason: '精确匹配字段不一致'
      };
    }

    // === 第二步：进行船名航次模糊比对 ===

    let totalWeight = 0;
    let weightedSum = 0;

    // 计算船名相似度
    if (expected.vessel) {
      if (result.vessel) {
        details.vesselSimilarity = this.calculateSimilarity(result.vessel, expected.vessel);
      } else {
        details.vesselSimilarity = 0;
      }
      weightedSum += details.vesselSimilarity * 0.5;
      totalWeight += 0.5;
    } else {
      details.vesselSimilarity = null;
    }

    // 计算航次相似度
    if (expected.voyage) {
      if (result.voyage) {
        details.voyageSimilarity = this.calculateSimilarity(result.voyage, expected.voyage);
      } else {
        details.voyageSimilarity = 0;
      }
      weightedSum += details.voyageSimilarity * 0.5;
      totalWeight += 0.5;
    } else {
      details.voyageSimilarity = null;
    }

    // 计算船名航次综合相似度
    let vesselVoyageSimilarity = null;
    if (details.vesselSimilarity !== null && details.voyageSimilarity !== null) {
      vesselVoyageSimilarity = (details.vesselSimilarity + details.voyageSimilarity) / 2;
    } else if (details.vesselSimilarity !== null) {
      vesselVoyageSimilarity = details.vesselSimilarity;
    } else if (details.voyageSimilarity !== null) {
      vesselVoyageSimilarity = details.voyageSimilarity;
    }
    details.vesselVoyageSimilarity = vesselVoyageSimilarity;

    // 总体相似度
    const overallSimilarity = totalWeight > 0 ? weightedSum / totalWeight : 0;

    details.vesselVoyageSimilarity = vesselVoyageSimilarity;

    return {
      matched: overallSimilarity >= threshold,
      similarity: Math.round(overallSimilarity * 100) / 100,
      threshold,
      details
    };
  }

  /**
   * 提单号归一化：全角转半角 → 去所有空白 → 去各类连字符 → 转大写。
   * 规则权威只在 Node 一侧；Java 侧仅用等价 SQL 表达式做粗筛，最终判定以此为准。
   */
  normalizeBlNo(value) {
    if (value == null) return '';
    let s = String(value);
    s = s.replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    s = s.replace(/[\s\u3000\u00A0]+/g, '');
    s = s.replace(/[-\u2010-\u2015\uFF0D\u2212]+/g, '');
    return s.toUpperCase();
  }

  /**
   * 结构化比对（/match 专用，D8 逐类型份数口径）。
   * 与 fuzzyCompare 的差异：申请侧一行只有一个尺寸+箱型，按「该类型份数」比对，
   * 而不是拿识别到的全部箱型总数去 >= 申请数。fuzzyCompare 保持原语义不变。
   * @param {Object} result - parse() 输出的识别结果
   * @param {Object} expected - { vessel, voyage, blNo, containerCount, containerSize, containerType }
   * @param {number} threshold - 船名/航次加权相似度阈值，默认 0.7
   */
  compareWithExpected(result, expected, threshold = 0.7) {
    const details = { exactMatchFields: {} };
    const exact = details.exactMatchFields;

    // 1) 提单号：两侧同规则归一化后精确相等（硬门槛）
    const expectedBlNo = this.normalizeBlNo(expected.blNo);
    const actualBlNo = this.normalizeBlNo(result.blNo);
    exact.blNo = {
      expected: expectedBlNo,
      actual: actualBlNo,
      matched: !!expectedBlNo && expectedBlNo === actualBlNo
    };

    // 2) 申请侧箱型拼装并归一化（45GP -> 40HC），识别侧结果已是归一化值
    const expectedSizeType = this.normalizeSizeType(
      String(expected.containerSize || '') + String(expected.containerType || '')
    );
    const expectedCount = Number(expected.containerCount) || 0;

    // 3) 识别侧按类型统计份数
    const actualByType = {};
    for (const c of (result.containers || [])) {
      const t = this.normalizeSizeType(String(c.sizeType || ''));
      if (!t) continue;
      actualByType[t] = (actualByType[t] || 0) + 1;
    }
    const actualCount = actualByType[expectedSizeType] || 0;
    const typesMatched = expectedCount > 0 && actualCount >= expectedCount;
    exact.containerTypes = {
      expected: [{ sizeType: expectedSizeType, count: expectedCount }],
      actual: Object.keys(actualByType).map(t => ({ sizeType: t, count: actualByType[t] })),
      missing: typesMatched ? [] : [{ sizeType: expectedSizeType, required: expectedCount, actual: actualCount }]
    };

    // 4) 船名/航次模糊比对（权重与 fuzzyCompare 完全一致：各 0.5）
    let totalWeight = 0;
    let weightedSum = 0;
    if (expected.vessel) {
      details.vesselSimilarity = result.vessel ? this.calculateSimilarity(result.vessel, expected.vessel) : 0;
      weightedSum += details.vesselSimilarity * 0.5;
      totalWeight += 0.5;
    } else {
      details.vesselSimilarity = null;
    }
    if (expected.voyage) {
      details.voyageSimilarity = result.voyage ? this.calculateSimilarity(result.voyage, expected.voyage) : 0;
      weightedSum += details.voyageSimilarity * 0.5;
      totalWeight += 0.5;
    } else {
      details.voyageSimilarity = null;
    }
    let vv = null;
    if (details.vesselSimilarity !== null && details.voyageSimilarity !== null) {
      vv = (details.vesselSimilarity + details.voyageSimilarity) / 2;
    } else if (details.vesselSimilarity !== null) {
      vv = details.vesselSimilarity;
    } else if (details.voyageSimilarity !== null) {
      vv = details.voyageSimilarity;
    }
    details.vesselVoyageSimilarity = vv;
    const overallSimilarity = totalWeight > 0 ? weightedSum / totalWeight : 0;

    const matched = exact.blNo.matched && typesMatched && overallSimilarity >= threshold;
    let reason = null;
    if (!exact.blNo.matched) reason = '提单号不一致';
    else if (!typesMatched) reason = '箱型份数不足';
    else if (overallSimilarity < threshold) reason = '船名航次相似度不足';

    return {
      matched,
      similarity: Math.round(overallSimilarity * 100) / 100,
      threshold,
      reason,
      details
    };
  }

  /**
   * 解析组合格式字符串
   * 格式: 船名-航次-提单号-箱量-箱型+文档
   * 文档: PDF URL 或 base64 编码
   * @param {string} combinedFormat
   * @returns {Object} { expected: {...}, document: string, documentType: 'url'|'base64' }
   */
  parseCombinedFormat(combinedFormat) {
    if (!combinedFormat || typeof combinedFormat !== 'string') {
      return null;
    }

    // 按最后一个 + 分隔，因为文档URL中可能包含 +
    const lastPlusIndex = combinedFormat.lastIndexOf('+');
    if (lastPlusIndex === -1) {
      return null;
    }

    const standardFormat = combinedFormat.slice(0, lastPlusIndex).trim();
    const documentRef = combinedFormat.slice(lastPlusIndex + 1).trim();

    if (!documentRef) {
      return null;
    }

    const expected = this.parseStandardFormat(standardFormat);
    if (!expected) {
      return null;
    }

    return {
      expected,
      document: documentRef,
      isUrl: documentRef.startsWith('http://') || documentRef.startsWith('https://')
    };
  }

  /**
   * 格式化比对结果输出
   * @param {Object} comparisonResult - compareWithDocument 返回的结果
   * @returns {Object} 格式化后的结果
   */
  formatComparisonResult(comparisonResult) {
    const lines = [];
    const isMatched = comparisonResult.matched;

    lines.push('========================================');
    lines.push(`比对结果: ${isMatched ? '✅ 吻合' : '❌ 不吻合'}`);

    if (isMatched) {
      lines.push(`相似度: ${(comparisonResult.similarity * 100).toFixed(0)}%`);
      lines.push(`阈值: ${(comparisonResult.threshold * 100).toFixed(0)}%`);
    } else {
      lines.push(`相似度: ${(comparisonResult.similarity * 100).toFixed(0)}%`);
      lines.push('');
      lines.push('不吻合原因:');

      const ef = comparisonResult.details?.exactMatchFields || {};

      if (ef.blNo && !ef.blNo.matched) {
        lines.push(`  - 提单号不一致 (期望: ${ef.blNo.expected}, 识别: ${ef.blNo.actual})`);
      }
      if (ef.containerCount && !ef.containerCount.matched) {
        lines.push(`  - 箱量不足 (期望 ≥${ef.containerCount.expected}, 识别: ${ef.containerCount.actual})`);
      }
      if (ef.sizeType && !ef.sizeType.matched) {
        if (ef.sizeType.missingTypes && ef.sizeType.missingTypes.length > 0) {
          lines.push(`  - 箱型缺失: ${ef.sizeType.missingTypes.join(', ')} (期望: ${ef.sizeType.expected}, 识别: ${ef.sizeType.actual})`);
        } else {
          lines.push(`  - 箱型不一致 (期望: ${ef.sizeType.expected}, 识别: ${ef.sizeType.actual})`);
        }
      }

      // 检查精确匹配字段是否全部通过，如果通过但相似度不足则显示模糊匹配原因
      const anyExactFailed = (ef.blNo && !ef.blNo.matched) || (ef.containerCount && !ef.containerCount.matched) || (ef.sizeType && !ef.sizeType.matched);
      if (!anyExactFailed) {
        if (comparisonResult.details?.vesselSimilarity !== null && comparisonResult.details?.vesselSimilarity < comparisonResult.threshold) {
          lines.push(`  - 船名相似度低于阈值: ${(comparisonResult.details.vesselSimilarity * 100).toFixed(1)}% (期望: ${comparisonResult.expected?.vessel}, 识别: ${comparisonResult.recognized?.vessel})`);
        }
        if (comparisonResult.details?.voyageSimilarity !== null && comparisonResult.details?.voyageSimilarity < comparisonResult.threshold) {
          lines.push(`  - 航次相似度低于阈值: ${(comparisonResult.details.voyageSimilarity * 100).toFixed(1)}% (期望: ${comparisonResult.expected?.voyage}, 识别: ${comparisonResult.recognized?.voyage})`);
        }
      }
    }

    lines.push('');
    lines.push('标准格式:');
    const exp = comparisonResult.expected;
    lines.push(`  ${exp?.vessel || '-'}-${exp?.voyage || '-'}-${exp?.blNo || '-'}-${exp?.containerCount ?? '-'}-${exp?.sizeType || '-'}`);

    lines.push('识别结果:');
    const rec = comparisonResult.recognized;
    lines.push(`  ${rec?.vessel || '-'}-${rec?.voyage || '-'}-${rec?.blNo || '-'}-${rec?.containerCount ?? '-'}-${rec?.sizeType || '-'}`);

    return {
      matched: isMatched,
      similarity: comparisonResult.similarity,
      threshold: comparisonResult.threshold,
      reason: isMatched ? null : this.getMismatchReasons(comparisonResult),
      formattedOutput: lines.join('\n'),
      standardFormat: `${exp?.vessel || '-'}-${exp?.voyage || '-'}-${exp?.blNo || '-'}-${exp?.containerCount ?? '-'}-${exp?.sizeType || '-'}`,
      recognizedFormat: `${rec?.vessel || '-'}-${rec?.voyage || '-'}-${rec?.blNo || '-'}-${rec?.containerCount ?? '-'}-${rec?.sizeType || '-'}`,
      details: comparisonResult.details
    };
  }

  /**
   * 获取不吻合的详细原因
   */
  getMismatchReasons(comparisonResult) {
    const reasons = [];
    const ef = comparisonResult.details?.exactMatchFields || {};

    if (ef.blNo && !ef.blNo.matched) {
      reasons.push({
        field: '提单号',
        expected: ef.blNo.expected,
        actual: ef.blNo.actual,
        type: 'exact'
      });
    }
    if (ef.containerCount && !ef.containerCount.matched) {
      reasons.push({
        field: '箱量',
        expected: ef.containerCount.expected,
        actual: ef.containerCount.actual,
        type: 'subset'
      });
    }
    if (ef.sizeType && !ef.sizeType.matched) {
      reasons.push({
        field: '箱型',
        expected: ef.sizeType.expected,
        actual: ef.sizeType.actual,
        missingTypes: ef.sizeType.missingTypes || [],
        type: 'subset'
      });
    }

    if (reasons.length === 0) {
      if (comparisonResult.details?.vesselSimilarity !== null && comparisonResult.details?.vesselSimilarity < comparisonResult.threshold) {
        reasons.push({
          field: '船名',
          expected: comparisonResult.expected?.vessel,
          actual: comparisonResult.recognized?.vessel,
          similarity: comparisonResult.details?.vesselSimilarity,
          type: 'fuzzy'
        });
      }
      if (comparisonResult.details?.voyageSimilarity !== null && comparisonResult.details?.voyageSimilarity < comparisonResult.threshold) {
        reasons.push({
          field: '航次',
          expected: comparisonResult.expected?.voyage,
          actual: comparisonResult.recognized?.voyage,
          similarity: comparisonResult.details?.voyageSimilarity,
          type: 'fuzzy'
        });
      }
    }

    return reasons;
  }

  /**
   * 解析组合格式并进行模糊比对
   * 格式: 船名-航次-提单号-箱量-箱型+文档
   * 文档: PDF URL 或 base64 编码
   * @param {string} combinedFormat - 组合格式字符串
   * @param {Function} pdfExtractor - PDF解析函数 (path/url/base64) => Promise<text>
   * @param {number} threshold - 相似度阈值，默认 0.7
   * @returns {Promise<Object>} 比对结果
   */
  async compareWithDocument(combinedFormat, pdfExtractor, threshold = 0.7) {
    const parsed = this.parseCombinedFormat(combinedFormat);
    if (!parsed) {
      return {
        matched: false,
        similarity: 0,
        error: '无效的组合格式字符串，格式: 船名-航次-提单号-箱量-箱型+文档(URL或base64)'
      };
    }

    // 解析文档获取文本
    let text;
    try {
      if (parsed.isUrl) {
        text = await pdfExtractor(parsed.document);
      } else {
        text = await pdfExtractor(parsed.document);
      }
    } catch (err) {
      return {
        matched: false,
        similarity: 0,
        error: `文档解析失败: ${err.message}`
      };
    }

    // 识别文档
    const result = this.parse(text);

    // 用原始期望格式字符串进行比对
    const expectedFormat = [
      parsed.expected.vessel,
      parsed.expected.voyage,
      parsed.expected.blNo,
      parsed.expected.containerCount,
      parsed.expected.sizeType
    ].filter(v => v !== null && v !== undefined).join('-');

    // 模糊比对
    const comparison = this.fuzzyCompare(result, expectedFormat, threshold);

    return {
      ...comparison,
      recognized: {
        vessel: result.vessel,
        voyage: result.voyage,
        blNo: result.blNo,
        containerCount: result.containers?.length || 0,
        sizeType: result.containers[0]?.sizeType || null
      },
      expected: parsed.expected
    };
  }
}

// Node.js 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BookingRecognizer };
}

// 测试
if (require.main === module) {
  const text = `
    BOOKING NOTE

    BOOKING NO: 124-79242630
    FILE NO: 424-667-00
    B/L NO: HLCUTA12604DJZJ4

    VESSEL: A.P. MOLLER
    VOYAGE: 622W

    PORT OF LOADING: NINGBO, CHINA
    PORT OF DISCHARGE: DUBAI, UAE

    CONTAINERS:
    TEMU3716804 22GP
    TEMU3716815 22GP

    SEAL NO: WSHC017498

    GROSS WEIGHT: 20,160 KGS
    VOLUME: 29.460 M3

    ETA: 2024-12-14
    FREIGHT: PREPAID
  `;

  const recognizer = new BookingRecognizer();
  const result = recognizer.parse(text);

  console.log('=== 识别结果 ===');
  console.log(JSON.stringify(result, null, 2));
  console.log('\n=== 标准格式输出 ===');
  console.log(recognizer.toStandardFormat(result));
}
