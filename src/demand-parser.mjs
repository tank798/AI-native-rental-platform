const LOCATION_CATALOG = [
  "静安寺",
  "江苏路",
  "隆德路",
  "武宁路",
  "南京西路",
  "徐家汇",
  "陆家嘴",
  "张江",
  "五角场",
  "人民广场",
  "中山公园",
  "曹杨路",
  "漕河泾",
  "大宁",
  "世纪大道",
  "长寿路",
  "天潼路",
  "衡山路",
  "虹桥路",
  "金桥",
  "外滩"
];

function currentDateInShanghai() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function isoDate(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function dateParts(value) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function addDays(value, amount) {
  const { year, month, day } = dateParts(value);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function yearForMonth(reference, month) {
  const { year, month: referenceMonth } = dateParts(reference);
  return month < referenceMonth - 2 ? year + 1 : year;
}

function amountFrom(numberText, unit, inferredUnit) {
  const amount = Number(numberText);
  const effectiveUnit = unit || inferredUnit;
  if (/k|千/i.test(effectiveUnit || "")) return Math.round(amount * 1000);
  return Math.round(amount);
}

function parseBudget(text) {
  const range = text.match(/(?:预算|租金)?\s*(?:在|是|约|大概|控制在)?\s*[¥￥]?\s*(\d+(?:\.\d+)?)\s*(k|千)?\s*(?:[-~～—–至到])\s*[¥￥]?\s*(\d+(?:\.\d+)?)\s*(k|千)?/i);
  if (range) {
    const sharedUnit = range[2] || range[4] || "";
    const low = amountFrom(range[1], range[2], sharedUnit);
    const high = amountFrom(range[3], range[4], sharedUnit);
    if (low >= 1000 && high >= low) {
      return { target: low, hardMax: high, explicitRange: true, capInferred: false };
    }
  }

  const explicitTarget = text.match(/(?:理想|目标|希望控制在)\s*[¥￥]?\s*(\d+(?:\.\d+)?)\s*(k|千)?/i);
  const explicitMax = text.match(/(?:封顶|最高|最多|不超过)\s*[¥￥]?\s*(\d+(?:\.\d+)?)\s*(k|千)?/i);
  if (explicitMax) {
    const hardMax = amountFrom(explicitMax[1], explicitMax[2], "");
    const target = explicitTarget ? amountFrom(explicitTarget[1], explicitTarget[2], "") : hardMax;
    if (target >= 1000 && hardMax >= target) {
      return { target, hardMax, explicitRange: Boolean(explicitTarget), capInferred: false };
    }
  }

  const contextual = text.match(/(?:预算|租金)(.{0,10}?)[¥￥]?\s*(\d+(?:\.\d+)?)\s*(k|千)?/i);
  const fallback = text.match(/[¥￥]?\s*(\d{4,5})\s*(?:元|块|\/月|每月|左右|以内|以下)/);
  const match = contextual || fallback;
  if (!match) return null;

  const context = contextual ? contextual[1] : text.slice(Math.max(0, match.index - 8), match.index + match[0].length + 5);
  const numberText = contextual ? contextual[2] : fallback[1];
  const unit = contextual ? contextual[3] : "";
  const target = amountFrom(numberText, unit, "");
  if (target < 1000) return null;

  const explicitCap = /不超过|最多|最高|封顶|以内|以下/.test(`${context}${match[0]}`);
  return {
    target,
    hardMax: explicitCap ? target : null,
    explicitRange: false,
    capInferred: !explicitCap
  };
}

function parseMoveIn(text, referenceDate) {
  const exact = text.match(/(\d{1,2})月(\d{1,2})[日号]?\s*(?:前后|左右|入住|起租)?/);
  if (exact && !/月(?:初|底|中旬)/.test(exact[0])) {
    const month = Number(exact[1]);
    const day = Number(exact[2]);
    const year = yearForMonth(referenceDate, month);
    const from = isoDate(year, month, day);
    return { from, to: addDays(from, 4), label: `${month} 月 ${day} 日前后` };
  }

  const early = text.match(/(\d{1,2})月初/);
  if (early) {
    const month = Number(early[1]);
    const year = yearForMonth(referenceDate, month);
    return { from: isoDate(year, month, 1), to: isoDate(year, month, 5), label: `${month} 月初` };
  }

  const late = text.match(/(\d{1,2})月底/);
  if (late) {
    const month = Number(late[1]);
    const year = yearForMonth(referenceDate, month);
    const lastDay = daysInMonth(year, month);
    return { from: isoDate(year, month, Math.max(1, lastDay - 6)), to: isoDate(year, month, lastDay), label: `${month} 月底` };
  }

  if (/下个月|下月/.test(text)) {
    const parts = dateParts(referenceDate);
    const month = parts.month === 12 ? 1 : parts.month + 1;
    const year = parts.month === 12 ? parts.year + 1 : parts.year;
    return { from: isoDate(year, month, 1), to: isoDate(year, month, 10), label: "下月上旬" };
  }

  return null;
}

function parseCommute(text) {
  if (/半小时/.test(text)) return 30;
  if (/一小时/.test(text)) return 60;
  const match = text.match(/(?:通勤|路上|地铁|到公司).{0,12}?(\d{1,3})\s*(?:分钟|min)|(?:最多|不超过|控制在)?\s*(\d{1,3})\s*(?:分钟|min).{0,8}?(?:通勤|以内|之内|到公司)|(?:最多|不超过|控制在)\s*(\d{1,3})\s*分钟/);
  return match ? Number(match[1] || match[2] || match[3]) : null;
}

function parseSharedHousing(text) {
  if (/整租|不接受合租|不要合租|不合租|拒绝合租/.test(text)) return false;
  if (/合租|室友/.test(text)) return true;
  return null;
}

function parseRoommateGender(text) {
  if (/(?:室友|合租).{0,8}?(?:女生|女性|女租客)|(?:女生|女性|女租客).{0,8}?(?:室友|合租)/.test(text)) return "female";
  if (/(?:室友|合租).{0,8}?(?:男生|男性|男租客)|(?:男生|男性|男租客).{0,8}?(?:室友|合租)/.test(text)) return "male";
  return null;
}

function parseLeaseMonths(text) {
  if (/(?:租|住)(?:满)?一年|一年(?:起租|长租)|长租/.test(text)) return 12;
  if (/(?:租|住)(?:满)?半年|半年(?:起租|左右)/.test(text)) return 6;
  const match = text.match(/(?:租期|至少租|准备租|打算租|能租|租|住)\s*(?:大概|约|至少)?\s*(\d{1,2})\s*个?月/);
  return match ? Number(match[1]) : null;
}

function parseFloorPreference(text) {
  if (/高楼层|高层|视野好/.test(text)) return "high";
  if (/中楼层|中层/.test(text)) return "middle";
  if (/低楼层|低层|方便上下楼/.test(text)) return "low";
  if (/楼层不限|楼层无所谓|几楼都行/.test(text)) return "any";
  return null;
}

function parseViewingAvailability(text) {
  if (/工作日(?:晚上|晚间|下班后)/.test(text)) return "weekday_evening";
  if (/周末/.test(text)) return "weekend";
  if (/随时看房|看房时间不限|看房都可以/.test(text)) return "any";
  return null;
}

function cleanLocationCandidate(value) {
  return String(value || "")
    .replace(/^(?:求租|位置|地点)\s*[：:]\s*/, "")
    .replace(/^(?:我|本人)?(?:想|希望|打算|准备)?(?:要|去)?(?:住|租|找房)?(?:在|到)?\s*/, "")
    .replace(/(?:附近|周边|一带|这边|都可以|均可)$/g, "")
    .replace(/^(?:上海|北京|深圳|广州)(?:市)?/, "")
    .trim();
}

function parseCommuteDestinations(text) {
  const destinations = LOCATION_CATALOG.filter((location) => {
    const namedTrip = new RegExp(`(?:通勤(?:到|去)?|去|到)\\s*${location}(?:\\s*(?:上班|工作|通勤|\\d+\\s*分钟))`).test(text);
    const workplace = new RegExp(`(?:上班|工作)(?:地点)?(?:在|到|去)\\s*${location}`).test(text);
    return namedTrip || workplace;
  });
  return [...new Set(destinations)];
}

function parseLocations(text, commuteDestinations = []) {
  const commuteOnly = new Set(commuteDestinations);
  const known = LOCATION_CATALOG.filter((location) => text.includes(location) && !commuteOnly.has(location));
  if (known.length) return known;

  const candidates = [];
  const pushCandidate = (rawValue) => {
    const value = cleanLocationCandidate(rawValue);
    if (!value || value.length < 2 || value.length > 24) return;
    value
      .split(/(?:、|\/|或者|或|和)/)
      .map(cleanLocationCandidate)
      .filter((item) => item.length >= 2 && item.length <= 16)
      .forEach((item) => candidates.push(item));
  };

  const explicitPatterns = [
    /(?:想住|希望住|打算住|准备住|住在|找房在|租在|区域(?:是|在)|地点(?:是|在)|靠近)\s*([^，,。；;]{2,32}?)(?=(?:，|,|。|；|;|预算|租金|入住|通勤|整租|合租|$))/g,
    /(?:^|[，,。；;])\s*([^，,。；;]{2,24}?)(?:附近|周边|一带)(?=(?:，|,|。|；|;|预算|租金|入住|通勤|整租|合租|$))/g,
    /(?:位置|地点)\s*[：:]\s*([^（(，,。；;\n]{2,24})/g,
    /(?:帮我找|想找|找)\s*([^，,。；;]{2,16}?)\s*(?:的房|房子)/g
  ];

  explicitPatterns.forEach((pattern) => {
    for (const match of text.matchAll(pattern)) pushCandidate(match[1]);
  });

  return [...new Set(candidates)];
}

function parsePreference(text, nounPattern) {
  const noun = `(?:${nounPattern})`;
  const gap = "[^，,。；;]{0,4}";
  if (new RegExp(`${noun}\\s*(?:最好|优先)|(?:最好|优先|希望)${gap}${noun}`).test(text)) return "preferred";
  if (new RegExp(`${noun}\\s*(?:不需要|无所谓|不限)|(?:不需要|无所谓|不限)${gap}${noun}`).test(text)) return "any";
  if (new RegExp(`${noun}\\s*(?:必须|一定|才行)|(?:必须|一定|只要|需要)${gap}${noun}`).test(text)) return "required";
  if (new RegExp(noun).test(text)) return "preferred";
  return null;
}

export function parseDemandText(rawText, referenceDate = currentDateInShanghai()) {
  const text = String(rawText || "")
    .replace(/\s+/g, " ")
    .replace(/\s*(月|日|号|分钟|元|块|千)\s*/g, "$1")
    .trim();
  const commuteDestinations = parseCommuteDestinations(text);
  const locations = parseLocations(text, commuteDestinations);
  const budget = parseBudget(text);
  const moveInWindow = parseMoveIn(text, referenceDate);
  const maxCommuteMinutes = parseCommute(text);
  const sharedHousing = parseSharedHousing(text);
  const roommateGender = parseRoommateGender(text);
  const leaseMonths = parseLeaseMonths(text);
  const floor = parseFloorPreference(text);
  const viewingAvailability = parseViewingAvailability(text);
  const ensuite = parsePreference(text, "独卫|独立卫生间");
  const elevator = parsePreference(text, "电梯");
  const kitchen = /不需要厨房|厨房无所谓/.test(text) ? false : /厨房/.test(text) ? true : null;
  const washer = /不需要洗衣机|洗衣机无所谓/.test(text) ? false : /洗衣机/.test(text) ? true : null;
  const utilities = /民水民电/.test(text) ? "residential" : /水电.{0,8}(?:清楚|透明|说清)|(?:清楚|透明).{0,8}水电/.test(text) ? "known" : null;
  const washerType = /滚筒/.test(text) ? "drum" : /波轮|涡轮/.test(text) ? "pulsator" : null;
  const exposure = /朝南|南向/.test(text) ? "south" : /朝北|北向/.test(text) ? "north" : /朝东|东向/.test(text) ? "east" : /朝西|西向/.test(text) ? "west" : null;
  const network = /(?:需要|必须|要)[^，,。；;]{0,20}(?:网络|宽带|wifi)|(?:网络|宽带|wifi)[^，,。；;]{0,4}(?:需要|必须)/i.test(text)
    ? "required"
    : /(?:网络|宽带|wifi).{0,4}(?:不限|无所谓)|(?:不限|无所谓).{0,4}(?:网络|宽带|wifi)/i.test(text)
      ? "any"
      : /网络|宽带|wifi/i.test(text)
        ? "preferred"
        : null;

  const coreMissing = [];
  if (!locations.length) coreMissing.push("location");
  if (!budget?.hardMax) coreMissing.push("budget");
  if (!moveInWindow) coreMissing.push("moveIn");
  if (sharedHousing === null) coreMissing.push("housing");
  if (!maxCommuteMinutes) coreMissing.push("commute");

  const preferenceMissing = [];
  if (!ensuite) preferenceMissing.push("ensuite");
  if (!elevator) preferenceMissing.push("elevator");
  if (!utilities) preferenceMissing.push("utilities");
  if (kitchen === null) preferenceMissing.push("kitchen");
  if (washer === null) preferenceMissing.push("washer");

  const questionByMissingField = {
    location: { fieldKey: "targetLocations", question: "你想住在哪些区域？", reasonCode: "HARD_CONDITION_UNKNOWN", priority: 100 },
    budget: { fieldKey: "budget.hardMax", question: "你能接受的月租最高上限是多少？", reasonCode: "HARD_CONDITION_UNKNOWN", priority: 95 },
    moveIn: { fieldKey: "moveInWindow", question: "你希望在什么日期范围内入住？", reasonCode: "HARD_CONDITION_UNKNOWN", priority: 90 },
    housing: { fieldKey: "sharedHousing", question: "你要整租，还是可以接受合租？", reasonCode: "HARD_CONDITION_UNKNOWN", priority: 85 },
    commute: { fieldKey: "maxCommuteMinutes", question: "你能接受的最长通勤时间是多少分钟？", reasonCode: "HARD_CONDITION_UNKNOWN", priority: 80 }
  };
  const questions = coreMissing.map((key) => questionByMissingField[key]).filter(Boolean).slice(0, 3);

  return {
    rawText: text,
    fields: {
      city: /北京/.test(text) ? "北京" : /深圳/.test(text) ? "深圳" : /广州/.test(text) ? "广州" : "上海",
      locations,
      targetLocations: [...locations],
      commuteDestinations,
      budget,
      moveInWindow,
      maxCommuteMinutes,
      leaseMonths,
      sharedHousing,
      roommateGender,
      viewingAvailability,
      preferences: { ensuite, elevator, utilities, washerType, exposure, floor, network },
      facilities: { kitchen, washer }
    },
    coreMissing,
    preferenceMissing,
    questions
  };
}

export function parsedDemandTags(parsed) {
  if (!parsed) return [];
  const { fields } = parsed;
  const tags = [];
  if (fields.locations.length) tags.push(fields.locations.join(" / "));
  if (fields.budget) {
    const { target, hardMax, explicitRange } = fields.budget;
    tags.push(explicitRange ? `¥${target.toLocaleString()}–${hardMax.toLocaleString()}` : `约 ¥${target.toLocaleString()}`);
  }
  if (fields.moveInWindow) tags.push(fields.moveInWindow.label);
  if (fields.maxCommuteMinutes) tags.push(`通勤 ≤ ${fields.maxCommuteMinutes} 分钟`);
  if (fields.leaseMonths) tags.push(`${fields.leaseMonths} 个月`);
  if (fields.sharedHousing === false) tags.push("整租");
  if (fields.sharedHousing === true && fields.roommateGender === "female") tags.push("女生合租");
  else if (fields.sharedHousing === true) tags.push("可合租");
  if (fields.preferences.ensuite === "required") tags.push("必须独卫");
  if (fields.preferences.exposure === "south") tags.push("朝南");
  if (fields.preferences.floor && fields.preferences.floor !== "any") {
    tags.push({ low: "低楼层", middle: "中楼层", high: "高楼层" }[fields.preferences.floor]);
  }
  if (fields.facilities.kitchen) tags.push("要厨房");
  if (fields.facilities.washer) tags.push("要洗衣机");
  return tags;
}

export const demandParserCatalog = {
  locations: [...LOCATION_CATALOG]
};
