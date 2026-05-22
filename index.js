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

    // 船名航次: 船名航次:RACINE26007W (无空格连在一起)
    const vesselVoyageMatch = cleanText.match(/船名航次[:\s]*([A-Z]+)(\d{5,7}[A-Z])/i);
    if (vesselVoyageMatch) {
      result.vessel = vesselVoyageMatch[1].trim();
      result.voyage = vesselVoyageMatch[2].trim().toUpperCase();
    }

    // 船名航次: 船名航次:\nZHONG GU YIN CHUAN / 25028W (带空格的船名)
    if (!result.vessel || !result.voyage) {
      const vesselVoyageSpaceMatch = text.match(/船名航次:\s*([A-Z][A-Z\s]+?)\s*\/\s*(\d{5,7}[A-Z])\b/i);
      if (vesselVoyageSpaceMatch) {
        result.vessel = this.normalizeVesselName(vesselVoyageSpaceMatch[1].trim());
        result.voyage = vesselVoyageSpaceMatch[2].trim().toUpperCase();
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

    // 提单号: 提单号：FQD0N00525 或 B/L NO：FQD0D00574
    if (!result.blNo) {
      const blMatch = cleanText.match(/提单号[：:\s]*([A-Z0-9]+)/i);
      if (blMatch) {
        result.blNo = blMatch[1].toUpperCase();
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

    // 箱型: 1X40HC 或 VOLUME: 40HC*1
    if (result.containers.length === 0) {
      const containerMatch = cleanText.match(/(\d+)X(40HC|40GP|20GP|45GP|45HC)/i);
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
    // VOLUME: 40HC*1 格式 (箱型在前)
    if (result.containers.length === 0) {
      const volumeMatch = text.match(/VOLUME[：:\s]*(40HC|40GP|20GP|45GP|45HC)\s*\*\s*(\d+)/i);
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
      '45GP': '40HC'
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
    // 清除其他多余空格（多个空格变一个）
    normalized = normalized.replace(/\s+/g, ' ').trim();
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
