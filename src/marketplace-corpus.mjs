export const MARKET_REFERENCE_DATE = "2026-08-28";

export const marketplaceAreas = [
  { district: "静安区", location: "静安寺", station: "静安寺站", road: "愚园路", baseRent: 3300, commute: 18 },
  { district: "长宁区", location: "江苏路", station: "江苏路站", road: "镇宁路", baseRent: 3000, commute: 22 },
  { district: "普陀区", location: "隆德路", station: "隆德路站", road: "曹杨路", baseRent: 2850, commute: 28 },
  { district: "普陀区", location: "武宁路", station: "武宁路站", road: "武宁南路", baseRent: 2750, commute: 32 },
  { district: "静安区", location: "南京西路", station: "南京西路站", road: "威海路", baseRent: 3900, commute: 16 },
  { district: "徐汇区", location: "徐家汇", station: "徐家汇站", road: "南丹路", baseRent: 3500, commute: 24 },
  { district: "浦东新区", location: "陆家嘴", station: "浦东南路站", road: "乳山路", baseRent: 4200, commute: 20 },
  { district: "浦东新区", location: "张江", station: "张江高科站", road: "晨晖路", baseRent: 3100, commute: 26 },
  { district: "杨浦区", location: "五角场", station: "五角场站", road: "国定路", baseRent: 2800, commute: 34 },
  { district: "黄浦区", location: "人民广场", station: "人民广场站", road: "新昌路", baseRent: 3800, commute: 19 },
  { district: "长宁区", location: "中山公园", station: "中山公园站", road: "长宁路", baseRent: 3200, commute: 23 },
  { district: "普陀区", location: "曹杨路", station: "曹杨路站", road: "兰溪路", baseRent: 2700, commute: 30 },
  { district: "徐汇区", location: "漕河泾", station: "漕河泾开发区站", road: "宜山路", baseRent: 2900, commute: 27 },
  { district: "静安区", location: "大宁", station: "上海马戏城站", road: "广中西路", baseRent: 2600, commute: 36 },
  { district: "浦东新区", location: "世纪大道", station: "世纪大道站", road: "张杨路", baseRent: 3600, commute: 21 },
  { district: "普陀区", location: "长寿路", station: "长寿路站", road: "胶州路", baseRent: 3050, commute: 25 },
  { district: "虹口区", location: "天潼路", station: "天潼路站", road: "四川北路", baseRent: 3100, commute: 24 },
  { district: "徐汇区", location: "衡山路", station: "衡山路站", road: "高安路", baseRent: 4000, commute: 18 },
  { district: "长宁区", location: "虹桥路", station: "虹桥路站", road: "淮海西路", baseRent: 3400, commute: 25 },
  { district: "浦东新区", location: "金桥", station: "金桥路站", road: "金桥路", baseRent: 2800, commute: 39 }
];

const numberWords = ["零", "一", "二", "三", "四"];
const occupations = ["产品经理", "设计师", "研究生", "工程师", "咨询顾问", "教师", "编辑", "医护", "金融从业", "实习生"];
const aliases = ["林同学", "顾女士", "许同学", "周先生", "沈女士", "陈同学", "唐女士", "陆女士", "韩同学", "夏女士"];

function isoDay(day) {
  return `2026-09-${String(day).padStart(2, "0")}`;
}

function dateCopy(day, style) {
  if (style === 1) return "9月初入住";
  if (style === 6) return `9月${day}号左右能搬`;
  return `9月${day}日入住`;
}

function dateWindow(day, style) {
  if (style === 1) return { from: "2026-09-01", to: "2026-09-05" };
  return { from: isoDay(day), to: isoDay(Math.min(day + 4, 28)) };
}

function landlordStyleText(style, data) {
  const role = data.claimedRole === "landlord" ? "房东本人直租" : "现租客个人转租";
  const gender = data.roommateCount ? `${data.roommateCount}位${data.roommateGender === "female" ? "女生" : "男生"}室友` : "整租无室友";
  const facilities = [
    data.facilities.elevator ? "有电梯" : "无电梯",
    data.facilities.ensuite ? "独卫" : "共用卫生间",
    data.facilities.kitchen ? "可做饭" : "不能做饭",
    data.facilities.washer ? `${data.facilities.washerType === "drum" ? "滚筒" : "波轮"}洗衣机` : "无洗衣机",
    data.facilities.utilities === "residential" ? "民水民电" : "水电待确认"
  ].join("，");
  const core = `${role}，${data.district}${data.location}，${data.station}步行${data.walkMinutes}分钟，${data.addressHint}，月租${data.listedRent}元，最低${data.minRent}元，${data.availableCopy}，${data.areaSqm}平，${data.floor}/${data.totalFloors}楼，${gender}，${facilities}，押一付一，0中介费0服务费。`;

  const variants = [
    core,
    `急出！不是中介哈，我是${data.claimedRole === "landlord" ? "房东本人" : "现在住这儿的租客"}。${data.location}${data.station}附近，${data.listedRent}/月，可聊到${data.minRent}，${data.availableCopy}。${gender}，${facilities}。`,
    `${data.location}｜${data.station}｜${data.listedRent}/月｜底价${data.minRent}｜${data.availableCopy}｜${data.areaSqm}㎡｜${data.floor}楼｜${gender}｜${facilities}｜${role}`,
    `嗯我这边有个房，位置就在${data.location}，离${data.station}大概${data.walkMinutes}分钟吧，房租${data.listedRent}，诚心的话${data.minRent}，然后${data.availableCopy}，${gender}，${facilities}，我是${data.claimedRole === "landlord" ? "房东" : "当前租客"}。`,
    `${role}\n地址：${data.district}${data.addressHint}\n交通：${data.station}步行${data.walkMinutes}分钟\n租金：${data.listedRent}元/月（授权最低${data.minRent}）\n入住：${data.availableCopy}\n房屋：${data.areaSqm}㎡，${data.floor}/${data.totalFloors}层，${gender}\n设施：${facilities}`,
    `个人房源！！！我是${data.claimedRole === "landlord" ? "房东本人" : "现在住这儿的租客，个人转租"}，${data.location}好房，地铁${data.walkMinutes}分钟，月租${data.listedRent}，${data.availableCopy}，${gender}。有厨房洗衣机，${data.facilities.elevator ? "电梯房" : "楼梯房"}，不收乱七八糟的费。`,
    `帮自己${data.claimedRole === "landlord" ? "的房子" : "住的房间"}找人，${data.location}${data.addressHint}，${data.station}走路${data.walkMinutes}min，租金${data.listedRent}rmb/月，${data.availableCopy}，${gender}，wifi有，${facilities}。`,
    `${data.location} ${data.listedRent} ${data.availableCopy} ${gender} ${data.areaSqm}平 ${facilities} ${role}`,
    `最近工作变动所以要${data.claimedRole === "landlord" ? "把房子租出去" : "转租"}，房子在${data.location}的${data.addressHint}，到${data.station}步行${data.walkMinutes}分钟。挂牌${data.listedRent}，长租可以${data.minRent}，${data.availableCopy}。室友情况：${gender}。${facilities}。`,
    `房源信息：${data.district}/${data.location}/${data.station}；${role}；${data.listedRent}元每月；${data.availableCopy}；${gender}；${facilities}。有意再看细节。`
  ];
  return variants[style];
}

function tenantStyleText(style, data) {
  const housing = data.sharedHousing
    ? data.roommateGender === "female" ? "接受女生合租" : data.roommateGender === "male" ? "接受男生合租" : "可以合租"
    : "只考虑整租";
  const facilities = [
    data.hardConstraints.elevator ? "必须有电梯" : "电梯不限",
    data.hardConstraints.ensuite ? "必须独卫" : "独卫优先",
    data.hardConstraints.kitchen ? "需要厨房" : "厨房不限",
    data.hardConstraints.washer ? "要洗衣机" : "洗衣机不限"
  ].join("，");
  const core = `想住${data.location}附近，预算${data.target}到${data.hardMax}元，${data.moveCopy}，通勤不超过${data.maxCommuteMinutes}分钟，${housing}，${facilities}，民水民电最好。`;
  const variants = [
    core,
    `求租：${data.location}/${data.station}一带，${data.target}-${data.hardMax}/月，${data.moveCopy}，${housing}，通勤${data.maxCommuteMinutes}分钟以内。${facilities}。`,
    `${data.location}找房 预算${(data.target / 1000).toFixed(2)}k~${(data.hardMax / 1000).toFixed(2)}k ${data.moveCopy} ${housing} 通勤最多${data.maxCommuteMinutes}分钟 ${facilities}`,
    `嗯我想找个${data.location}附近的房子，价格大概${data.target}到${data.hardMax}吧，${data.moveCopy}，路上最好别超过${data.maxCommuteMinutes}分钟，${housing}，然后${facilities}。`,
    `位置：${data.location}（${data.station}周边）\n月租：${data.target}—${data.hardMax}\n入住：${data.moveCopy}\n通勤：≤${data.maxCommuteMinutes}分钟\n居住：${housing}\n要求：${facilities}`,
    `找房找房！${data.location}附近都行，月租封顶${data.hardMax}，理想${data.target}，${data.moveCopy}，${housing}，通勤${data.maxCommuteMinutes}分钟以内。${facilities}，别是中介。`,
    `工作在${data.location}附近，所以想住${data.location}，预算${data.target}到${data.hardMax}，${data.moveCopy}，到公司${data.maxCommuteMinutes}分钟之内，${housing}，${facilities}。`,
    `${data.location}｜${data.target}-${data.hardMax}｜${data.moveCopy}｜${data.maxCommuteMinutes}min通勤｜${housing}｜${facilities}`,
    `我比较在意通勤，想住${data.location}附近，最多${data.maxCommuteMinutes}分钟。预算${data.target}到${data.hardMax}，${data.moveCopy}，${housing}，${facilities}。其他可以聊。`,
    `帮我找${data.location}的房，${data.moveCopy}，预算${data.target}—${data.hardMax}，${housing}，${facilities}，通勤控制在${data.maxCommuteMinutes}分钟。`
  ];
  return variants[style];
}

function riskFor(index) {
  const slot = index % 25;
  return slot === 20 ? "broker" : slot === 21 ? "fee" : slot === 22 ? "stale" : slot === 23 ? "rights_missing" : slot === 24 ? "duplicate_photo" : "clear";
}

function buildLandlordCase(index) {
  const n = index + 1;
  const area = marketplaceAreas[index % marketplaceAreas.length];
  const tier = Math.floor(index / marketplaceAreas.length);
  const risk = riskFor(index);
  const claimedRole = index % 2 === 0 ? "landlord" : "subletter";
  const role = risk === "broker" ? "broker" : claimedRole;
  const listedRent = area.baseRent + (tier - 2) * 90 + (index % 3) * 50;
  const minRent = listedRent - (index % 3) * 100;
  const day = 1 + (index % 14);
  const roommateCount = index % 4;
  const roommateGender = roommateCount ? (index % 3 === 0 ? "male" : "female") : null;
  const floor = 2 + (index % 16);
  const totalFloors = Math.max(floor + 2, index % 2 ? 18 : 7);
  const facilities = {
    kitchen: index % 13 !== 0,
    washer: index % 11 !== 0,
    washerType: index % 4 === 0 ? "pulsator" : "drum",
    elevator: totalFloors > 7 || index % 5 !== 0,
    ensuite: index % 6 === 0,
    exposure: ["south", "east", "north", "west"][index % 4],
    utilities: index % 17 === 0 ? "unknown" : "residential",
    network: index % 7 === 0 ? "shared" : "included"
  };
  const style = index % 10;
  const data = {
    claimedRole,
    district: area.district,
    location: area.location,
    station: area.station,
    addressHint: `${area.road}${20 + (index % 70)}弄`,
    walkMinutes: 3 + (index % 10),
    listedRent,
    minRent,
    availableFrom: isoDay(day),
    availableCopy: `9月${day}日可入住`,
    areaSqm: Number((10.5 + (index % 9) * 0.8).toFixed(1)),
    floor,
    totalFloors,
    roommateCount,
    roommateGender,
    facilities
  };
  let rawText = landlordStyleText(style, data);
  if (risk === "broker") rawText += " 备注：账号实际由经纪人统一带看。";
  if (risk === "fee") rawText += " 签约前另收500元服务费。";
  if (risk === "stale") rawText += " 这条是上个月拍的，暂时没法重新确认现场。";
  if (risk === "rights_missing") rawText += " 产权证或在租合同暂时提供不了。";
  if (risk === "duplicate_photo") rawText += " 图片是从别的平台保存的同户型参考图。";

  const verification = {
    identity: "verified",
    role: risk === "broker" ? "conflict" : "verified",
    rights: risk === "rights_missing" ? "missing" : "verified",
    liveSite: risk === "stale" ? "expired" : "verified"
  };
  const evidence = {
    duplicatePhoto: risk === "duplicate_photo",
    feeMessage: risk === "fee",
    roleConflict: risk === "broker"
  };
  const listing = {
    id: `market-home-${String(n).padStart(3, "0")}`,
    title: `${area.location} · ${facilities.ensuite ? "独卫" : "明亮"}${roommateCount ? "卧室" : "一居室"}`,
    shortTitle: `${area.location}${facilities.ensuite ? "独卫" : ""}${roommateCount ? "卧室" : "一居室"}`,
    role,
    claimedRole,
    publisher: role === "landlord" ? "产权人本人" : role === "subletter" ? "现租客本人" : "角色存疑",
    district: area.district,
    location: area.location,
    station: area.station,
    walkMinutes: data.walkMinutes,
    commuteMinutes: area.commute + (index % 7) - 3,
    addressHint: data.addressHint,
    listedRent,
    minRent,
    depositMonths: 1,
    availableFrom: data.availableFrom,
    leaseMonthsMin: [3, 6, 12][index % 3],
    conditionalOffers: index % 9 === 0 && risk === "clear"
      ? [{ rent: minRent, conditions: { leaseMonthsMin: 12, moveInOnOrBefore: "2026-09-05" }, label: "租满 12 个月并在 9 月 5 日前起租" }]
      : [],
    room: { areaSqm: data.areaSqm, floor, totalFloors, roommateCount, roommateGender },
    facilities,
    fees: {
      service: risk === "fee" ? 500 : 0,
      intermediary: 0,
      propertyMonthly: index % 8 === 0 ? 100 : 0,
      networkMonthly: facilities.network === "included" ? 0 : 50
    },
    verification,
    lastVerifiedDays: risk === "stale" ? 35 : index % 3,
    freshness: risk === "stale" ? "stale" : "live",
    evidence,
    photoTone: ["sage", "clay", "blue", "slate"][index % 4],
    photoLabel: risk === "duplicate_photo" ? "跨平台参考图" : "房源现场图"
  };

  return {
    id: `S${String(n).padStart(3, "0")}`,
    style: ["规范", "口语", "缩写", "语音", "分行", "随意", "叙述", "极简", "故事", "半结构化"][style],
    risk,
    input: rawText,
    expected: {
      role,
      claimedRole,
      location: area.location,
      station: area.station,
      listedRent,
      // 没有公开底价的文案只能按挂牌价理解，不能从私有结构化数据“猜”出底价。
      minRent: [0, 1, 2, 3, 4, 8].includes(style) ? minRent : listedRent,
      availableFrom: data.availableFrom,
      roommateGender,
      roommateCount,
      serviceFee: risk === "fee" ? 500 : 0
    },
    listing,
    draft: {
      role,
      city: "上海",
      district: area.district,
      location: area.location,
      station: area.station,
      address: `上海市${area.district}${data.addressHint}`,
      title: listing.title,
      listedRent,
      minimumAuthorizedRent: minRent,
      availableFrom: data.availableFrom,
      leaseEnd: "2027-09-01",
      leaseMonthsMin: listing.leaseMonthsMin,
      areaSqm: data.areaSqm,
      floor: data.floor,
      totalFloors: data.totalFloors,
      viewingAvailability: "any",
      roommateGender,
      roommateCount,
      fees: { rent: listedRent, deposit: listedRent, utilities: "民水民电", network: listing.fees.networkMonthly, property: listing.fees.propertyMonthly, service: listing.fees.service, intermediary: 0 },
      verification: Object.fromEntries([
        ["identity", true],
        ["roleDocument", risk !== "broker"],
        ["rightsDocument", risk !== "rights_missing"],
        ["livePhotoChallenge", !["stale", "duplicate_photo"].includes(risk)]
      ].map(([kind, verified]) => [kind, {
        submissionStatus: "submitted",
        verificationStatus: verified ? "verified" : "rejected",
        source: "fixture",
        reviewedAt: "2026-08-30T02:00:00.000Z",
        displayLabel: verified ? "评测夹具：已核验" : "评测夹具：未通过"
      }])),
      facilities: { kitchen: facilities.kitchen, washer: facilities.washer, elevator: facilities.elevator, ensuite: facilities.ensuite, exposure: facilities.exposure }
    }
  };
}

function buildTenantCase(index) {
  const n = index + 1;
  const style = index % 10;
  const baseArea = marketplaceAreas[(index * 3) % marketplaceAreas.length];
  const noFit = index % 20 === 19;
  const location = noFit ? "外滩" : baseArea.location;
  const station = noFit ? "豫园站" : baseArea.station;
  const sharedHousing = index % 8 !== 0;
  const roommateGender = sharedHousing ? (index % 4 === 0 ? "male" : index % 5 === 0 ? null : "female") : null;
  const target = Math.max(1800, baseArea.baseRent - 350 + (index % 4) * 100);
  const hardMax = target + 350 + (index % 3) * 100;
  const day = 1 + (index % 12);
  const moveInWindow = dateWindow(day, style);
  const maxCommuteMinutes = [25, 30, 35, 40, 45][index % 5];
  const hardConstraints = {
    kitchen: index % 7 === 0,
    washer: index % 6 === 0,
    noBrokerOrServiceFee: true,
    ensuite: index % 11 === 0,
    elevator: index % 9 === 0
  };
  const data = {
    location,
    station,
    target,
    hardMax,
    moveCopy: dateCopy(day, style),
    maxCommuteMinutes,
    sharedHousing,
    roommateGender,
    hardConstraints
  };
  let input = tenantStyleText(style, data);
  const intentionallyIncomplete = index % 25 === 23 ? "moveIn" : index % 25 === 24 ? "budget" : null;
  if (intentionallyIncomplete === "moveIn") input = input.replace(/(?:9月初入住|9月\d{1,2}(?:日入住|号左右能搬))[，,｜\n]?/g, "时间灵活，");
  if (intentionallyIncomplete === "budget") {
    input = input
      .replace(new RegExp(`${target}(?:到|-|—)${hardMax}(?:元|/月)?`, "g"), `${target}左右`)
      .replace(new RegExp(`${(target / 1000).toFixed(2)}k~${(hardMax / 1000).toFixed(2)}k`, "gi"), `${target}左右`)
      .replace(new RegExp(`封顶${hardMax}，理想${target}`, "g"), `${target}左右`);
  }

  const mandate = {
    id: `market-mandate-${String(n).padStart(3, "0")}`,
    intent: "rent",
    city: "上海",
    locations: [location],
    maxCommuteMinutes,
    budget: { target, hardMax, targetIsPrivate: true, hardMaxIsPrivate: true },
    moveInWindow,
    leaseMonths: [3, 6, 12, 12][index % 4],
    roomType: sharedHousing ? "private_room" : "whole_unit",
    sharedHousing,
    roommateGender,
    hardConstraints,
    preferences: { ensuite: hardConstraints.ensuite ? "required" : "preferred", elevator: hardConstraints.elevator ? "required" : "any", exposure: index % 3 === 0 ? "south_preferred" : "any", utilities: "residential_preferred", washerType: "drum_preferred" },
    negotiationAuthority: { mayOfferTarget: true, mayAcceptUpToHardMax: true, mayTradeLeaseLength: true, mayTradeMoveInDate: true, binding: false }
  };

  return {
    id: `T${String(n).padStart(3, "0")}`,
    style: ["规范", "求租帖", "缩写", "语音", "分行", "随意", "场景化", "极简", "偏好优先", "自然表达"][style],
    input,
    intentionallyIncomplete,
    expected: {
      location,
      target,
      hardMax: intentionallyIncomplete === "budget" ? null : hardMax,
      moveInWindow: intentionallyIncomplete === "moveIn" ? null : moveInWindow,
      maxCommuteMinutes,
      sharedHousing,
      roommateGender
    },
    tenant: {
      id: `market-tenant-${String(n).padStart(3, "0")}`,
      alias: aliases[index % aliases.length],
      occupation: occupations[index % occupations.length],
      mandate
    }
  };
}

export const landlordCopyCases = Array.from({ length: 100 }, (_, index) => buildLandlordCase(index));
export const tenantCopyCases = Array.from({ length: 100 }, (_, index) => buildTenantCase(index));
export const marketplaceListings = landlordCopyCases.map((item) => item.listing);
export const marketplaceTenants = tenantCopyCases.map((item) => item.tenant);

export const marketplaceCorpusStats = {
  landlordCases: landlordCopyCases.length,
  tenantCases: tenantCopyCases.length,
  allowedListings: marketplaceListings.filter((item) => ["landlord", "subletter"].includes(item.role) && item.freshness === "live" && item.verification.rights === "verified" && !item.evidence.duplicatePhoto && !item.evidence.feeMessage).length,
  riskListings: marketplaceListings.filter((item) => item.role === "broker" || item.evidence.duplicatePhoto || item.evidence.feeMessage || item.freshness === "stale" || item.verification.rights !== "verified").length
};
