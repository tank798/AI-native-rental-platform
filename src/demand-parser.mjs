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
  "曹杨路"
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
  const match = text.match(/(?:通勤|路上|地铁|到公司).{0,10}?(\d{1,3})\s*分钟|(?:最多|不超过|控制在)?\s*(\d{1,3})\s*分钟.{0,8}?(?:通勤|以内|之内|到公司)/);
  return match ? Number(match[1] || match[2]) : null;
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

function cleanLocationCandidate(value) {
  return String(value || "")
    .replace(/^(?:我|本人)?(?:想|希望|打算|准备)?(?:要|去)?(?:住|租|找房)?(?:在|到)?\s*/, "")
    .replace(/(?:附近|周边|一带|这边|都可以|均可)$/g, "")
    .replace(/^(?:上海|北京|深圳|广州)(?:市)?/, "")
    .trim();
}

function parseLocations(text) {
  const known = LOCATION_CATALOG.filter((location) => text.includes(location));
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
    /(?:^|[，,。；;])\s*([^，,。；;]{2,24}?)(?:附近|周边|一带)(?=(?:，|,|。|；|;|预算|租金|入住|通勤|整租|合租|$))/g
  ];

  explicitPatterns.forEach((pattern) => {
    for (const match of text.matchAll(pattern)) pushCandidate(match[1]);
  });

  return [...new Set(candidates)];
}

function parsePreference(text, nounPattern) {
  const noun = `(?:${nounPattern})`;
  if (new RegExp(`(?:必须|一定|只要|需要).{0,5}${noun}|${noun}.{0,5}(?:必须|一定|才行)`).test(text)) return "required";
  if (new RegExp(`(?:最好|优先|希望).{0,5}${noun}|${noun}.{0,5}(?:最好|优先)`).test(text)) return "preferred";
  if (new RegExp(`(?:不需要|无所谓|不限).{0,5}${noun}|${noun}.{0,5}(?:不需要|无所谓|不限)`).test(text)) return "any";
  if (new RegExp(noun).test(text)) return "preferred";
  return null;
}

export function parseDemandText(rawText, referenceDate = currentDateInShanghai()) {
  const text = String(rawText || "")
    .replace(/\s+/g, " ")
    .replace(/\s*(月|日|号|分钟|元|块|千)\s*/g, "$1")
    .trim();
  const locations = parseLocations(text);
  const budget = parseBudget(text);
  const moveInWindow = parseMoveIn(text, referenceDate);
  const maxCommuteMinutes = parseCommute(text);
  const sharedHousing = parseSharedHousing(text);
  const roommateGender = parseRoommateGender(text);
  const ensuite = parsePreference(text, "独卫|独立卫生间");
  const elevator = parsePreference(text, "电梯");
  const kitchen = /不需要厨房|厨房无所谓/.test(text) ? false : /厨房/.test(text) ? true : null;
  const washer = /不需要洗衣机|洗衣机无所谓/.test(text) ? false : /洗衣机/.test(text) ? true : null;
  const utilities = /民水民电/.test(text) ? "residential" : /水电.{0,8}(?:清楚|透明|说清)|(?:清楚|透明).{0,8}水电/.test(text) ? "known" : null;
  const washerType = /滚筒/.test(text) ? "drum" : /波轮|涡轮/.test(text) ? "pulsator" : null;
  const exposure = /朝南|南向/.test(text) ? "south" : /朝北|北向/.test(text) ? "north" : /朝东|东向/.test(text) ? "east" : /朝西|西向/.test(text) ? "west" : null;

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

  return {
    rawText: text,
    fields: {
      city: /北京/.test(text) ? "北京" : /深圳/.test(text) ? "深圳" : /广州/.test(text) ? "广州" : "上海",
      locations,
      budget,
      moveInWindow,
      maxCommuteMinutes,
      sharedHousing,
      roommateGender,
      preferences: { ensuite, elevator, utilities, washerType, exposure },
      facilities: { kitchen, washer }
    },
    coreMissing,
    preferenceMissing
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
  if (fields.sharedHousing === false) tags.push("整租");
  if (fields.sharedHousing === true && fields.roommateGender === "female") tags.push("女生合租");
  else if (fields.sharedHousing === true) tags.push("可合租");
  if (fields.preferences.ensuite === "required") tags.push("必须独卫");
  if (fields.preferences.exposure === "south") tags.push("朝南");
  if (fields.facilities.kitchen) tags.push("要厨房");
  if (fields.facilities.washer) tags.push("要洗衣机");
  return tags;
}

export const demandParserCatalog = {
  locations: [...LOCATION_CATALOG]
};
