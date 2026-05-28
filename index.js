/**
 * 订舱识别模块 - Booking Recognition Module
 * 从订舱单/海运单据中提取结构化信息
 */

class BookingRecognizer {
  constructor() {
    // 字段模式定义
    this.patterns = {
      bookingNo: /BOOKING\s*(?:NO|Number|No\.?|No)(?:\s+[:\s]|[^a-zA-Z])[:\s]*([A-Z0-9\-]+)/i,
      fileNo: /FILE\s*(?:NO|Number|No\.?)[:\s]*([A-Z0-9\-]+)/i,
      blNo: /(?:B[\/\\]L|BILL\s*OF\s*LADING)\s*(?:NO|Number|No\.?)[:\s]*([A-Z0-9]+)/i,

      vesselVoyage: /VESSEL[:\s]*([A-Z\s]+)\s*(?:VOYAGE|VOY|NO\.?|No)?[:\s]*([A-Z0-9]+)/i,
      portOfLoading: /(?:PORT\s*OF\s*LOADING|\bPOL\b|LOADING\s*PORT)[:\s]*(.+?)(?=\n|,|PORT|$)/i,
      portOfDischarge: /(?:PORT\s*OF\s*DISCHARGE|\bPOD\b|DISCHARGE\s*PORT)[:\s]*(.+?)(?=\n|,|PORT|$)/i,

      containerInfo: /([A-Z]{4}[0-9]{7})\s+(20GP|22GP|40GP|40HC|45HC|45GP|20RF|40RF|20OT|40OT|20FR|40FR)/gi,
      sealNo: /SEAL\s*(?:NO|Number)[:\s]*([A-Z0-9]+)/i,
      grossWeight: /GROSS\s*WEIGHT[:\s]*([\d,\.]+)\s*(?:KGS|KG|KILOS?)/i,
      volume: /VOLUME[:\s]*([\d,\.]+)\s*(?:CBM|M3|CUBIC)/i,
      eta: /ETA[:\s]*(\d{4}[-\/]\d{2}[-\/]\d{2})/i,
      etd: /ETD[:\s]*(\d{4}[-\/]\d{2}[-\/]\d{2})/i,
      shipDate: /ON\s*BOARD[:\s]*(\d{4}[-\/]\d{2}[-\/]\d{2})/i,
      freight: /FREIGHT[:\s]*(PREPAID|COLLECT)/i
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
      grossWeight: this.extractNumericField(text, 'grossWeight'),
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

    // 提取入货通知格式字段
    if (result.documentType === 'CARGO_RECEIVING_NOTICE') {
      this.extractCargoReceivingNoticeFields(text, result);
    }

    return result;
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

    // 提取 1x22GP 格式的箱型信息
    const containerCountMatch = text.match(/(\d+)x(22GP|20GP|40GP|40HC|45HC|45GP)/i);
    if (containerCountMatch && result.containers.length === 0) {
      const count = parseInt(containerCountMatch[1]);
      const sizeType = this.normalizeSizeType(containerCountMatch[2]);
      for (let i = 0; i < count; i++) {
        result.containers.push({
          sizeType: sizeType,
          containerNo: null  // Hapag-Lloyd 格式可能没有箱号
        });
      }
    }
  }

  /**
   * 提取入货通知格式字段（中文带空格格式）
   */
  extractCargoReceivingNoticeFields(text, result) {
    // 清除中文空格后的文本
    const cleanText = this.removeChineseSpaces(text);

    // 船名航次: 船 名 航 次:ZHONG GU YIN CHUAN 25028W (无斜杠，空格分隔，Word文档)
    if (!result.vessel) {
      const vesselNoSlashMatch = text.match(/船\s*名\s*航\s*次[:\s]*([A-Z][A-Z\s]+?)\s+(\d{5,7}[A-Z])\b/i);
      if (vesselNoSlashMatch) {
        result.vessel = this.normalizeVesselName(vesselNoSlashMatch[1].trim());
        result.voyage = vesselNoSlashMatch[2].trim().toUpperCase();
      }
    }

    // 船名航次: 船名航次:RACINE26007W (无空格连在一起，cleanText中船名无空格)
    if (!result.vessel) {
      const vesselVoyageMatch = cleanText.match(/船名航次[:\s]*([A-Z]+)(\d{5,7}[A-Z])/i);
      if (vesselVoyageMatch) {
        result.vessel = this.normalizeVesselName(vesselVoyageMatch[1].trim());
        result.voyage = vesselVoyageMatch[2].trim().toUpperCase();
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
      const vesselNoSlashMatch = text.match(/船\s*名\s*航\s*次[:\s]*([A-Z][A-Z\s]+?)\s+(\d{5,7}[A-Z])\b/i);
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
    if (!result.blNo) {
      const blStart = cleanText.indexOf('提单号');
      if (blStart >= 0) {
        const afterBl = cleanText.substring(blStart + 4);
        const nextFieldMatch = afterBl.match(/([一-龥]+[：:\s]|开船时间|卸货港|箱量|截单时间|截港时间)/);
        const blLine = nextFieldMatch ? afterBl.substring(0, nextFieldMatch.index) : afterBl;
        if (blLine.includes('*')) {
          const parts = blLine.split('*');
          const prefix = parts[0]; // "FQD0N004902"
          const containerType = parts[1]; // "40HC"
          // 末位数字为箱量（2*40HC 的 2），前面的为BL号
          const countMatch = prefix.match(/(\d)(?=\*?$)/);
          if (countMatch) {
            const count = parseInt(countMatch[1]);
            result.blNo = prefix.substring(0, prefix.length - 1).toUpperCase();
            if (containerType) {
              const typeMatch = containerType.match(/(40HC|40HQ|40GP|20GP|45GP|45HC)/i);
              if (typeMatch) {
                const sizeType = this.normalizeSizeType(typeMatch[1]);
                for (let i = 0; i < count; i++) {
                  result.containers.push({ sizeType, containerNo: null });
                }
              }
            }
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
    // Hapag-Lloyd 格式: Vessel DATE PORT VESSEL_NAME HH:MM (船名在日期港口时间之后)
    // 匹配 PNIT SEASPAN BREEZE 00:01 格式
    const vesselLineMatch = text.match(/PNIT\s+([A-Z][A-Z\s]+?)\s+\d{2}:\d{2}/im);
    // Hapag-Lloyd 格式: Vessel\nMUNICH MAERSK\nDP Voyage: 682932\nVoy. No: 622W
    const vesselMatch = text.match(/(?:Vessel|VESSEL)[:\s]*\n?([A-Z][A-Z\s.]+?)(?:\s*\n|DP\s*Voyage|Voy\.?\s*No|$)/im);
    // Hapag-Lloyd 格式: Voy. No: 622W (优先匹配，忽略 DP Voyage)
    const voyNoMatch = text.match(/Voy\.?\s*No[:\s]*(\d{2,4}[A-Z]?)/i);
    // 标准格式: VOYAGE: 622W
    const voyageMatch = text.match(/VOYAGE[:\s]*(\d{2,4}[A-Z]?)/i);
    // Hapag-Lloyd DP Voyage: 682932 (最后选项)
    const dpVoyageMatch = text.match(/DP\s*Voyage[:\s]*(\d{2,4}[A-Z]?)/i);

    if (vesselLineMatch) {
      result.vessel = this.normalizeVesselName(vesselLineMatch[1].trim());
    } else if (vesselMatch) {
      result.vessel = this.normalizeVesselName(vesselMatch[1].trim());
    }
    if (voyNoMatch) {
      result.voyage = voyNoMatch[1].trim().toUpperCase();
    } else if (voyageMatch) {
      result.voyage = voyageMatch[1].trim().toUpperCase();
    } else if (dpVoyageMatch) {
      result.voyage = dpVoyageMatch[1].trim().toUpperCase();
    }

    // 尝试船名航次在同一行的格式: A.P. MOLLER 622W
    if (!result.vessel || !result.voyage) {
      const vesselVoyageMatch = text.match(/([A-Z][.A-Z\s]+?)\s+(\d{2,4}[A-Z])\b/);
      if (vesselVoyageMatch) {
        result.vessel = this.normalizeVesselName(vesselVoyageMatch[1].trim());
        result.voyage = vesselVoyageMatch[2].trim().toUpperCase();
      }
    }
  }

  /**
   * 提取集装箱信息
   */
  extractContainers(text) {
    const containers = [];
    let match;

    // 提取箱号和箱型
    const containerRegex = /([A-Z]{4}[0-9]{7})\s+(20GP|22GP|40GP|40HC|45HC|20RF|40RF|20OT|40OT|20FR|40FR)/gi;
    while ((match = containerRegex.exec(text)) !== null) {
      containers.push({
        containerNo: match[1].toUpperCase(),
        sizeType: this.normalizeSizeType(match[2])
      });
    }

    // 提取封条号
    const sealRegex = /SEAL[:\s]*(?:NO\.?|Number)?[:\s]*([A-Z0-9]+)/gi;
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
   */
  format(result) {
    const vesselVoyage = result.vessel && result.voyage
      ? `${result.vessel}-${result.voyage}`
      : result.vessel || result.voyage || 'N/A';

    const containerSummary = result.containers.length > 0
      ? `${result.containers.length}-${result.containers[0]?.sizeType || 'CONTAINER'}`
      : 'N/A';

    return `${vesselVoyage}-${result.blNo || result.bookingNo || 'N/A'}-${containerSummary}`;
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
   * 例如: A.P.MOLLER-622W-HLCUTA12604DJZJ4-2-20GP
   * @param {string} standardFormat
   * @returns {Object} 解析后的字段
   */
  parseStandardFormat(standardFormat) {
    if (!standardFormat || typeof standardFormat !== 'string') {
      return null;
    }

    const parts = standardFormat.split('-');
    if (parts.length < 2) return null;

    return {
      vessel: parts[0] || null,
      voyage: parts[1] || null,
      blNo: parts[2] || null,
      containerCount: parts[3] ? parseInt(parts[3], 10) : null,
      sizeType: parts[4] || null
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

    // 箱量精确匹配
    if (expected.containerCount != null) {
      const actualCount = result.containers?.length || 0;
      exactMatchFields.containerCount = {
        expected: expected.containerCount,
        actual: actualCount,
        matched: expected.containerCount === actualCount
      };
      if (!exactMatchFields.containerCount.matched) {
        allFieldsMatched = false;
      }
    }

    // 箱型精确匹配
    if (expected.sizeType != null) {
      const actualSizeType = result.containers?.[0]?.sizeType?.toUpperCase() || '';
      const expectedSizeType = expected.sizeType.toUpperCase();
      exactMatchFields.sizeType = {
        expected: expected.sizeType,
        actual: result.containers?.[0]?.sizeType,
        matched: expectedSizeType === actualSizeType
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
        lines.push(`  - 箱量不一致 (期望: ${ef.containerCount.expected}, 识别: ${ef.containerCount.actual})`);
      }
      if (ef.sizeType && !ef.sizeType.matched) {
        lines.push(`  - 箱型不一致 (期望: ${ef.sizeType.expected}, 识别: ${ef.sizeType.actual})`);
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
        type: 'exact'
      });
    }
    if (ef.sizeType && !ef.sizeType.matched) {
      reasons.push({
        field: '箱型',
        expected: ef.sizeType.expected,
        actual: ef.sizeType.actual,
        type: 'exact'
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
