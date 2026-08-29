import { MARKET_REFERENCE_DATE, marketplaceAreas } from "./marketplace-corpus.mjs";

function pad(value) {
  return String(value).padStart(2, "0");
}

function amount(text, pattern) {
  const match = text.match(pattern);
  if (!match) return null;
  const value = Number(match[1]);
  return /k|千/i.test(match[2] || "") ? Math.round(value * 1000) : Math.round(value);
}

function parseDate(text, referenceDate) {
  const match = text.match(/(\d{1,2})月(\d{1,2})[日号]/);
  if (!match) return null;
  const referenceYear = Number(referenceDate.slice(0, 4));
  const referenceMonth = Number(referenceDate.slice(5, 7));
  const month = Number(match[1]);
  const year = month < referenceMonth - 2 ? referenceYear + 1 : referenceYear;
  return `${year}-${pad(month)}-${pad(match[2])}`;
}

function parseRoommateCount(text) {
  if (/整租无室友|整租|无室友/.test(text)) return 0;
  const match = text.match(/([0-9一二三四])\s*位?(?:女生|男生)?室友/);
  if (!match) return null;
  const values = { 一: 1, 二: 2, 三: 3, 四: 4 };
  return values[match[1]] ?? Number(match[1]);
}

export function parseSupplyText(rawText, referenceDate = MARKET_REFERENCE_DATE) {
  const text = String(rawText || "").replace(/\s+/g, " ").trim();
  const claimedRole = /房东本人|房东直租|产权人|自己的房子|把房子租出去/.test(text)
    ? "landlord"
    : /现租客|当前租客|个人转租|自己住|现在住这儿的租客|住的房间/.test(text)
      ? "subletter"
      : null;
  const brokerDenial = /不是中介|非中介|无中介|没有中介|(?:不收(?:取)?|免|零|0\s*)(?:任何)?中介费/.test(text);
  const brokerSignal = /经纪人|中介|公寓管家|统一带看/.test(text) && !brokerDenial;
  const explicitBroker = /账号实际由经纪人|经纪人统一带看|中介代发|公寓管家/.test(text);
  const role = explicitBroker || brokerSignal ? "broker" : claimedRole;
  const area = marketplaceAreas.find((item) => text.includes(item.location) || text.includes(item.station));
  const listedRent = amount(text, /(?:月租|房租|租金|挂牌|\|)\s*[：:]?\s*[¥￥]?\s*(\d+(?:\.\d+)?)\s*(k|千)?(?:元|rmb|\/月|每月)?/i)
    ?? amount(text, /(?:^|[，,；;｜|\s])\s*(\d{4,5})\s*(k|千)?\s*(?:元每月|元\/月|rmb\/月|\/月|[｜|\s])/i);
  const minRent = amount(text, /(?:最低|底价|可聊到|可以|诚心的话|长租可以|授权最低)\s*[¥￥]?\s*(\d+(?:\.\d+)?)\s*(k|千)?/i);
  const zeroServiceFee = /0\s*服务费|零服务费|无服务费|免服务费|不收(?:取)?(?:任何)?服务费|不收(?:取)?(?:任何)?中介费服务费/.test(text);
  const zeroIntermediaryFee = /0\s*中介费|零中介费|无中介费|免中介费|不是中介|不收(?:取)?(?:任何)?中介费/.test(text);
  const serviceFee = amount(text, /(?:服务费|带看费|签约费)\s*[¥￥]?\s*(\d+(?:\.\d+)?)\s*(k|千)?/i)
    ?? amount(text, /(?:另收|收取)?\s*[¥￥]?\s*(\d+(?:\.\d+)?)\s*(k|千)?\s*(?:元)?(?:服务费|带看费|签约费)/i)
    ?? (zeroServiceFee ? 0 : null);
  const intermediaryFee = amount(text, /(?:中介费)\s*[¥￥]?\s*(\d+(?:\.\d+)?)\s*(k|千)?/i)
    ?? (zeroIntermediaryFee ? 0 : null);
  const roommateCount = parseRoommateCount(text);
  const roommateGender = /女生室友|位女生/.test(text) ? "female" : /男生室友|位男生/.test(text) ? "male" : null;
  const floorMatch = text.match(/(\d{1,2})\s*(?:\/|楼\/|层\/)(\d{1,2})\s*(?:楼|层)?/);
  const areaMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:㎡|平|平方米)/);
  const riskSignals = [];
  if (role === "broker") riskSignals.push("broker_role", "role_conflict");
  if (Number(serviceFee || 0) > 0 || Number(intermediaryFee || 0) > 0) riskSignals.push("prohibited_fee");
  if (/参考图|别的平台保存|盗图/.test(text)) riskSignals.push("duplicate_photo");
  if (/上个月拍|没法重新确认现场|现场过期/.test(text)) riskSignals.push("stale");
  if (/产权证.*提供不了|在租合同.*提供不了|出租权.*缺失/.test(text)) riskSignals.push("rights_missing");

  const facilities = {
    elevator: /无电梯|楼梯房/.test(text) ? false : /有电梯|电梯房|电梯/.test(text) ? true : null,
    ensuite: /共用卫生间|共卫/.test(text) ? false : /独卫|独立卫生间/.test(text) ? true : null,
    kitchen: /不能做饭|无厨房/.test(text) ? false : /可做饭|有厨房|厨房/.test(text) ? true : null,
    washer: /无洗衣机/.test(text) ? false : /洗衣机/.test(text) ? true : null,
    washerType: /滚筒/.test(text) ? "drum" : /波轮|涡轮/.test(text) ? "pulsator" : null,
    utilities: /民水民电/.test(text) ? "residential" : /水电待确认/.test(text) ? "unknown" : null,
    exposure: /朝南|南向/.test(text) ? "south" : /朝北|北向/.test(text) ? "north" : /朝东|东向/.test(text) ? "east" : /朝西|西向/.test(text) ? "west" : null,
    network: /含网|包网|网络免费|wifi免费/i.test(text) ? "included" : /有网|宽带|wifi/i.test(text) ? "shared" : null
  };
  const missingFields = [];
  if (!role) missingFields.push("role");
  if (!area) missingFields.push("location");
  if (!listedRent) missingFields.push("listedRent");
  if (!parseDate(text, referenceDate)) missingFields.push("availableFrom");
  if (roommateCount === null) missingFields.push("roommates");

  return {
    rawText: text,
    fields: {
      city: "上海",
      district: area?.district || null,
      location: area?.location || null,
      station: area?.station || null,
      role,
      claimedRole,
      listedRent,
      minRent: minRent ?? listedRent,
      availableFrom: parseDate(text, referenceDate),
      room: {
        areaSqm: areaMatch ? Number(areaMatch[1]) : null,
        floor: floorMatch ? Number(floorMatch[1]) : null,
        totalFloors: floorMatch ? Number(floorMatch[2]) : null,
        roommateCount,
        roommateGender
      },
      facilities,
      fees: { service: serviceFee, intermediary: intermediaryFee }
    },
    riskSignals: [...new Set(riskSignals)],
    missingFields
  };
}

export const supplyParserCatalog = {
  locations: marketplaceAreas.map((item) => item.location),
  stations: marketplaceAreas.map((item) => item.station)
};
