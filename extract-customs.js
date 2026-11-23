// extract-customs.js - 一次性脚本：从报关单 PDF 提取关键字段
// 修复要点:
//   1. 中文字符间空白归一化(支持 U+3000 全角空格)
//   2. 字段值用"下一个栏目名边界"做 lookahead,避免跨字段污染
//   3. 港口/地区用字典精确匹配
//   4. 毛重直接搜"数字+千克"模式
const { extractTextFromPDF } = require("./pdf-parser");
const { BookingRecognizer } = require("./index");

// 报关单所有栏目名,用于在 value 提取时作 lookahead 边界
const FIELD_NAMES = [
  "运输工具名称及航次号",
  "提运单号",
  "货物存放地点",
  "监管方式",
  "征免性质",
  "启运港",
  "合同协议号",
  "贸易国",
  "启运国",
  "经停港",
  "入境口岸",
  "包装种类",
  "毛重",
  "件数",
  "净重",
  "成交方式",
  "保费",
  "随附单证",
  "原产国",
  "最终目的国",
  "卉内目的地",
  "境内目的地",
  "征免",
  "特殊关系确认",
  "价格影响确认",
  "支付特许权使用费确认",
  "公式定价确认",
  "暂定价格确认",
  "自报自缴",
  "申报单位",
  "报关人员",
  "境内收货人",
  "境外发货人",
  "消费使用单位",
  "进境关别",
  "进口日期",
  "申报日期",
  "备案号",
  "运输方式",
  "进口口岸",
];
const FIELD_NAMES_RE = `(?:${FIELD_NAMES.join("|")})`;

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("用法: node extract-customs.js <pdf路径>");
    process.exit(1);
  }

  const text = await extractTextFromPDF(filePath);
  console.log("=== rawText 前 400 字符 ===");
  console.log(text.slice(0, 400));

  const cnNorm = text.replace(/([一-龥])[^\S\n]+(?=[一-龥])/g, "$1");
  console.log("\n=== cnNorm 全部字符 ===");
  console.log(cnNorm);

  const lines = cnNorm
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const r = new BookingRecognizer();

  // 通用字段提取: keyword(代码) 名称,值用 [一-龥]{2,8} + lookahead 边界
  const extractCodeName = (keyword) => {
    // cnNorm 表格结构下 name 易跨字段污染, 只取 code 部分最可靠
    const re = new RegExp(`${keyword}\\s*[(（]([^)）]+)[)）]`);
    const m = cnNorm.match(re);
    return m ? { code: m[1].trim(), name: null } : null;
  };

  // 1. 海关编号 (18 位数字)
  const customsNo = (text.match(/\b(\d{18})\b/) || [])[1];

  // 2. 船名 + 航次
  let vessel = null,
    voyage = null,
    blNo = null;
  const toolIdx = lines.findIndex((l) => l.includes("运输工具名称及航次号"));
  const toolContext =
    toolIdx >= 0 ? lines.slice(toolIdx, toolIdx + 3).join(" ") : "";
  const toolMatch = toolContext.match(
    /\b([A-Z][A-Z\s]{2,30}?)\s*[\/／]\s*(\d{3,5}[A-Z]?)\b/,
  );
  if (toolMatch) {
    vessel = toolMatch[1].trim().replace(/\s+/g, " ");
    voyage = toolMatch[2];
    const after = toolContext.slice(toolMatch.index + toolMatch[0].length);
    const blMatch = after.match(/\b([A-Z0-9]{8,15})\b/);
    if (blMatch) blNo = blMatch[1];
  }

  // 港口字典
  const KNOWN_PORTS = [
    "黑德兰港",
    "悉尼港",
    "墨尔本港",
    "布里斯班港",
    "阿德莱德港",
    "上海港",
    "宁波港",
    "青岛港",
    "天津港",
    "广州港",
    "深圳港",
    "黄岛港",
    "前湾港",
    "大连港",
    "厦门港",
    "福州港",
    "鹿特丹港",
    "汉堡港",
    "安特卫普港",
    "泽布吕赫港",
    "新加坡港",
    "丹戎不碌港",
    "巴生港",
    "林查班港",
    "长滩港",
    "洛杉矶港",
    "纽约港",
  ];
  const KNOWN_REGIONS = [
    "黄岛",
    "前湾",
    "青岛",
    "上海",
    "宁波",
    "广州",
    "深圳",
    "厦门",
    "福州",
    "大连",
    "天津",
  ];

  const pickPlaceName = (line, dictionary, useLast = false) => {
    let bestName = null,
      bestIdx = -1;
    for (const name of dictionary) {
      const i = useLast ? line.lastIndexOf(name) : line.indexOf(name);
      if (i >= 0 && i > bestIdx) {
        bestIdx = i;
        bestName = name;
      }
    }
    if (bestName) return bestName;
    return null;
  };

  // 3. 起运港
  let pol = null;
  const polLineIdx = lines.findIndex((l) => l.includes("启运港"));
  if (polLineIdx >= 0) {
    let polNext = polLineIdx + 1;
    while (polNext < lines.length && !lines[polNext].trim()) polNext++;
    if (polNext < lines.length)
      pol = pickPlaceName(lines[polNext], KNOWN_PORTS);
  }

  // 4. 入境口岸 + 代码
  let podCode = null,
    pod = null;
  const podLineIdx = lines.findIndex((l) => l.includes("入境口岸"));
  if (podLineIdx >= 0) {
    const line = lines[podLineIdx];
    const podCodeMatch = line.match(/\((\d{6})\)/);
    if (podCodeMatch) {
      podCode = podCodeMatch[1];
      let podNext = podLineIdx + 1;
      while (podNext < lines.length && !lines[podNext].trim()) podNext++;
      if (podNext < lines.length) {
        pod = pickPlaceName(
          lines[podNext],
          [...KNOWN_REGIONS, ...KNOWN_PORTS],
          true,
        );
      }
    }
  }

  // 5. 毛重
  let grossWeightKg = null;
  const wMatch = cnNorm.match(/(\d{5,12})\s*千克/);
  if (wMatch) grossWeightKg = parseInt(wMatch[1], 10);

  // 6. 成交方式 (FOB/CIF/C&F 等)
  let tradeTerm = null;
  for (const l of lines) {
    const m = l.match(/\b(C&F|FOB|CIF|CFR|EXW|FAS|DAP|DDP)\b/);
    if (m) {
      tradeTerm = m[1];
      break;
    }
  }

  // 7. 境内收货人信用代码
  const consigneeCode = (cnNorm.match(/\((\w{18})\)/) || [])[1];

  // ========== 扩展字段 ==========
  // 日期
  const allDates = [...cnNorm.matchAll(/(?:^|[^\d])(20\d{6})(?:[^\d]|$)/g)].map(
    (m) => m[1],
  );
  const importDate = allDates[0] || null;
  const declareDate = allDates[1] || null;

  // 进境关别
  const customsBranch = (cnNorm.match(/进境关别[^0-9]*[(〈]?(\d{4})/) || [])[1];

  // 多个 (代码) + 名称 字段 (统一用 extractCodeName)
  const transportMode = extractCodeName("运输方式");
  const supervisionMode = extractCodeName("监管方式");
  const taxNature = extractCodeName("征免性质");
  const tradeCountry = extractCodeName("贸易国");
  const originCountry = extractCodeName("启运国");
  const finalDest = extractCodeName("最终目的国");
  const packaging = extractCodeName("包装种类");

  // 经停港 (无名称)
  const transitPortCode = (cnNorm.match(/经停港\s*[(（](\w+)[)）]/) || [])[1];

  // 合同协议号 (无代码)
  const contractNo = (cnNorm.match(/合同协议号\s+(\w+)/) || [])[1];

  // 件数
  const packageCount = (cnNorm.match(/件数\s+(\d+)/) || [])[1];

  // 商品段
  const goodsLine = cnNorm.match(/\b(\d{10})\s+([^\n]{2,30}?)\s+(\d+)\s*千克/);
  const hsCode = goodsLine ? goodsLine[1] : null;
  const goodsName = goodsLine ? goodsLine[2].trim() : null;
  const totalPrice = (cnNorm.match(/\b(\d{6,12}\.\d+)\s+美元/) || [])[1];

  // 境内目的地 (cnNorm 里是"卉内目的地"OCR 错误, 兼容两种)
  const domesticDest = (() => {
    const m = cnNorm.match(
      /(卉内目的地|境内目的地)\s+([一-龥]{4,30}?)(?=\s|征免|$)/,
    );
    return m ? m[2].trim() : null;
  })();

  // 征免
  const taxLevy = (() => {
    const m = cnNorm.match(/征免\s+([一-龥]{2,8}?)(?=\s|$)/);
    return m ? m[1].trim() : null;
  })();

  // 报关员证号
  const declarantCertNo = (cnNorm.match(/报关人员证号\s+(\d+)/) || [])[1];

  // 申报单位
  const declarantUnit = (() => {
    const m = cnNorm.match(
      /申报单位\s*[(（](\w+)[)）]\s*([一-龥]{2,30}?)(?=\s*[<(（]|申报)/,
    );
    return m ? { code: m[1], name: m[2].trim() } : null;
  })();

  // 确认标志
  const confirmFlags = {};
  for (const key of [
    "特殊关系确认",
    "价格影响确认",
    "支付特许权使用费确认",
    "公式定价确认",
    "暂定价格确认",
    "自报自缴",
  ]) {
    const m = cnNorm.match(new RegExp(`${key}\\s*[:：]?\\s*(是|否)`));
    if (m) confirmFlags[key] = m[1];
  }

  // 集装箱
  const containers = r.extractContainers(text);

  // === 输出 ===
  console.log("\n=== 报关单字段提取 ===");
  console.log("海关编号:", customsNo);
  console.log("进口日期:", importDate, "申报日期:", declareDate);
  console.log("进境关别:", customsBranch);
  console.log("运输方式:", JSON.stringify(transportMode));
  console.log("监管方式:", JSON.stringify(supervisionMode));
  console.log("征免性质:", JSON.stringify(taxNature));
  console.log("合同协议号:", contractNo);
  console.log("贸易国:", JSON.stringify(tradeCountry));
  console.log("启运国:", JSON.stringify(originCountry));
  console.log("经停港代码:", transitPortCode);
  console.log("起运港:", pol);
  console.log("入境口岸代码:", podCode);
  console.log("入境口岸:", pod);
  console.log("包装种类:", JSON.stringify(packaging));
  console.log("件数:", packageCount);
  console.log("毛重(千克):", grossWeightKg);
  console.log("成交方式:", tradeTerm);
  console.log("HS编码:", hsCode);
  console.log("商品名称:", goodsName);
  console.log("总价:", totalPrice, "美元");
  console.log("最终目的国:", JSON.stringify(finalDest));
  console.log("境内目的地:", domesticDest);
  console.log("征免:", taxLevy);
  console.log("报关员证号:", declarantCertNo);
  console.log("申报单位:", JSON.stringify(declarantUnit));
  console.log("境内收货人信用代码:", consigneeCode);
  console.log("确认标志:", JSON.stringify(confirmFlags));
  console.log("集装箱:", JSON.stringify(containers));

  const result = {
    documentType: "CUSTOMS_DECLARATION",
    customsNo,
    importDate,
    declareDate,
    customsBranch,
    transportMode,
    supervisionMode,
    taxNature,
    contractNo,
    tradeCountry,
    originCountry,
    transitPortCode,
    vessel,
    voyage,
    blNo,
    portOfLoading: pol,
    portOfDischarge: pod,
    portOfDischargeCode: podCode,
    packaging,
    packageCount,
    grossWeight: grossWeightKg,
    tradeTerm,
    hsCode,
    goodsName,
    totalPrice,
    finalDest,
    domesticDest,
    taxLevy,
    declarantCertNo,
    declarantUnit,
    consigneeCode,
    confirmFlags,
    containers,
  };
  console.log("\n=== 综合结果 ===");
  console.log(JSON.stringify(result, null, 2));

  console.log("\n=== 标准格式（占位）===");
  console.log(r.toStandardFormat(result));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
