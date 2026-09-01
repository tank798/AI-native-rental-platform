export const SIMULATION_DATE = "2026-08-23";

/** Fixed only for deterministic demos and evals; production code injects its real clock. */
export const simulationClock = {
  nowIso: () => `${SIMULATION_DATE}T04:00:00.000Z`,
  todayInShanghai: () => SIMULATION_DATE
};

export const baseMandate = {
  id: "mandate-renter-001",
  intent: "rent",
  city: "上海",
  locations: ["静安寺", "江苏路", "隆德路", "武宁路"],
  maxCommuteMinutes: 35,
  budget: {
    target: 3000,
    hardMax: 3100,
    targetIsPrivate: true,
    hardMaxIsPrivate: true
  },
  moveInWindow: {
    from: "2026-08-28",
    to: "2026-09-05"
  },
  leaseMonths: 12,
  roomType: "private_room",
  sharedHousing: true,
  roommateGender: "female",
  hardConstraints: {
    kitchen: true,
    washer: true,
    noBrokerOrServiceFee: true
  },
  preferences: {
    ensuite: "preferred",
    elevator: "preferred",
    exposure: "south_preferred",
    utilities: "residential_preferred",
    washerType: "drum_preferred"
  },
  negotiationAuthority: {
    mayOfferTarget: true,
    mayAcceptUpToHardMax: true,
    mayTradeLeaseLength: true,
    mayTradeMoveInDate: true,
    binding: false
  }
};

const verifiedAll = {
  identity: "verified",
  role: "verified",
  rights: "verified",
  liveSite: "verified"
};

const baseFacilities = {
  kitchen: true,
  washer: true,
  washerType: "drum",
  elevator: true,
  ensuite: false,
  exposure: "south",
  utilities: "residential",
  network: "included"
};

export const listings = [
  {
    id: "home-nanyang",
    title: "静安寺 · 南阳路朝南次卧",
    shortTitle: "南阳路朝南次卧",
    role: "subletter",
    claimedRole: "subletter",
    publisher: "现租客本人",
    district: "静安区",
    location: "静安寺",
    station: "静安寺站",
    walkMinutes: 8,
    commuteMinutes: 18,
    addressHint: "南阳路 · 近西康路",
    listedRent: 3200,
    minRent: 3100,
    depositMonths: 1,
    availableFrom: "2026-08-29",
    leaseMonthsMin: 6,
    conditionalOffers: [
      {
        rent: 3000,
        conditions: { leaseMonthsMin: 12, moveInOnOrBefore: "2026-09-01" },
        label: "租满 12 个月，9 月 1 日前起租"
      }
    ],
    room: { areaSqm: 13.8, floor: 8, totalFloors: 18, roommateCount: 2, roommateGender: "female" },
    facilities: { ...baseFacilities, ensuite: false },
    fees: { service: 0, intermediary: 0, propertyMonthly: 0, networkMonthly: 0 },
    verification: { ...verifiedAll },
    lastVerifiedDays: 0,
    freshness: "live",
    evidence: { duplicatePhoto: false, feeMessage: false, roleConflict: false },
    photoTone: "sage",
    photoLabel: "朝南卧室 · 现场核验图"
  },
  {
    id: "home-jiangsu",
    title: "江苏路 · 愚园路安静主卧",
    shortTitle: "愚园路安静主卧",
    role: "landlord",
    claimedRole: "landlord",
    publisher: "产权人本人",
    district: "长宁区",
    location: "江苏路",
    station: "江苏路站",
    walkMinutes: 6,
    commuteMinutes: 22,
    addressHint: "愚园路 · 近镇宁路",
    listedRent: 2950,
    minRent: 2900,
    depositMonths: 1,
    availableFrom: "2026-09-03",
    leaseMonthsMin: 12,
    conditionalOffers: [],
    room: { areaSqm: 12.1, floor: 3, totalFloors: 6, roommateCount: 1, roommateGender: "female" },
    facilities: { ...baseFacilities, elevator: false, exposure: "east", washerType: "pulsator" },
    fees: { service: 0, intermediary: 0, propertyMonthly: 0, networkMonthly: 50 },
    verification: { ...verifiedAll },
    lastVerifiedDays: 1,
    freshness: "live",
    evidence: { duplicatePhoto: false, feeMessage: false, roleConflict: false },
    photoTone: "clay",
    photoLabel: "主卧窗边 · 现场核验图"
  },
  {
    id: "home-wuning",
    title: "武宁路 · 低预算明亮次卧",
    shortTitle: "低预算明亮次卧",
    role: "subletter",
    claimedRole: "subletter",
    publisher: "现租客本人",
    district: "普陀区",
    location: "武宁路",
    station: "武宁路站",
    walkMinutes: 10,
    commuteMinutes: 34,
    addressHint: "武宁南路 · 近余姚路",
    listedRent: 2750,
    minRent: 2700,
    depositMonths: 1,
    availableFrom: "2026-08-28",
    leaseMonthsMin: 10,
    conditionalOffers: [],
    room: { areaSqm: 11.4, floor: 5, totalFloors: 7, roommateCount: 2, roommateGender: "female" },
    facilities: { ...baseFacilities, elevator: false, exposure: "south", network: "shared" },
    fees: { service: 0, intermediary: 0, propertyMonthly: 0, networkMonthly: 40 },
    verification: { ...verifiedAll },
    lastVerifiedDays: 2,
    freshness: "live",
    evidence: { duplicatePhoto: false, feeMessage: false, roleConflict: false },
    photoTone: "amber",
    photoLabel: "次卧全景 · 现场核验图"
  },
  {
    id: "home-longde",
    title: "隆德路 · 带独卫朝南卧室",
    shortTitle: "带独卫朝南卧室",
    role: "landlord",
    claimedRole: "landlord",
    publisher: "产权人本人",
    district: "普陀区",
    location: "隆德路",
    station: "隆德路站",
    walkMinutes: 4,
    commuteMinutes: 29,
    addressHint: "曹杨路 · 近谈家渡路",
    listedRent: 3180,
    minRent: 3100,
    depositMonths: 1,
    availableFrom: "2026-09-01",
    leaseMonthsMin: 12,
    conditionalOffers: [],
    room: { areaSqm: 15.2, floor: 10, totalFloors: 22, roommateCount: 1, roommateGender: "female" },
    facilities: { ...baseFacilities, ensuite: true },
    fees: { service: 0, intermediary: 0, propertyMonthly: 80, networkMonthly: 0 },
    verification: { ...verifiedAll },
    lastVerifiedDays: 0,
    freshness: "live",
    evidence: { duplicatePhoto: false, feeMessage: false, roleConflict: false },
    photoTone: "blue",
    photoLabel: "独卫卧室 · 现场核验图"
  },
  {
    id: "home-broker-trap",
    title: "静安寺 · 所谓房东直租",
    shortTitle: "所谓房东直租",
    role: "broker",
    claimedRole: "landlord",
    publisher: "角色存疑",
    district: "静安区",
    location: "静安寺",
    station: "静安寺站",
    walkMinutes: 3,
    commuteMinutes: 16,
    addressHint: "南京西路附近",
    listedRent: 2600,
    minRent: 2600,
    depositMonths: 1,
    availableFrom: "2026-08-25",
    leaseMonthsMin: 12,
    conditionalOffers: [],
    room: { areaSqm: 16, floor: 12, totalFloors: 24, roommateCount: 1, roommateGender: "female" },
    facilities: { ...baseFacilities, ensuite: true },
    fees: { service: 800, intermediary: 0, propertyMonthly: 0, networkMonthly: 0 },
    verification: { identity: "verified", role: "conflict", rights: "missing", liveSite: "unverified" },
    lastVerifiedDays: 0,
    freshness: "live",
    evidence: { duplicatePhoto: true, feeMessage: true, roleConflict: true },
    photoTone: "risk",
    photoLabel: "图片与其他平台重复"
  },
  {
    id: "home-male-roommates",
    title: "曹杨路 · 男生合租次卧",
    shortTitle: "男生合租次卧",
    role: "subletter",
    claimedRole: "subletter",
    publisher: "现租客本人",
    district: "普陀区",
    location: "隆德路",
    station: "隆德路站",
    walkMinutes: 5,
    commuteMinutes: 28,
    addressHint: "曹杨路附近",
    listedRent: 2800,
    minRent: 2750,
    depositMonths: 1,
    availableFrom: "2026-09-01",
    leaseMonthsMin: 6,
    conditionalOffers: [],
    room: { areaSqm: 12.8, floor: 9, totalFloors: 16, roommateCount: 2, roommateGender: "male" },
    facilities: { ...baseFacilities },
    fees: { service: 0, intermediary: 0, propertyMonthly: 0, networkMonthly: 0 },
    verification: { ...verifiedAll },
    lastVerifiedDays: 1,
    freshness: "live",
    evidence: { duplicatePhoto: false, feeMessage: false, roleConflict: false },
    photoTone: "slate",
    photoLabel: "卧室照片 · 现场核验图"
  },
  {
    id: "home-stale",
    title: "江苏路 · 已久未确认房源",
    shortTitle: "久未确认房源",
    role: "subletter",
    claimedRole: "subletter",
    publisher: "现租客本人",
    district: "长宁区",
    location: "江苏路",
    station: "江苏路站",
    walkMinutes: 7,
    commuteMinutes: 21,
    addressHint: "江苏路附近",
    listedRent: 2900,
    minRent: 2850,
    depositMonths: 1,
    availableFrom: "2026-08-20",
    leaseMonthsMin: 6,
    conditionalOffers: [],
    room: { areaSqm: 13, floor: 5, totalFloors: 7, roommateCount: 1, roommateGender: "female" },
    facilities: { ...baseFacilities },
    fees: { service: 0, intermediary: 0, propertyMonthly: 0, networkMonthly: 0 },
    verification: { ...verifiedAll, liveSite: "expired" },
    lastVerifiedDays: 21,
    freshness: "stale",
    evidence: { duplicatePhoto: false, feeMessage: false, roleConflict: false },
    photoTone: "slate",
    photoLabel: "历史照片 · 已过期"
  },
  {
    id: "home-unknown-utilities",
    title: "静安寺 · 信息待补充卧室",
    shortTitle: "信息待补充卧室",
    role: "landlord",
    claimedRole: "landlord",
    publisher: "产权人本人",
    district: "静安区",
    location: "静安寺",
    station: "昌平路站",
    walkMinutes: 9,
    commuteMinutes: 25,
    addressHint: "昌平路附近",
    listedRent: 3000,
    minRent: 2950,
    depositMonths: 1,
    availableFrom: "2026-09-02",
    leaseMonthsMin: 12,
    conditionalOffers: [],
    room: { areaSqm: 12.6, floor: 4, totalFloors: 8, roommateCount: 1, roommateGender: "female" },
    facilities: { ...baseFacilities, utilities: "unknown", washerType: "unknown" },
    fees: { service: 0, intermediary: 0, propertyMonthly: null, networkMonthly: null },
    verification: { ...verifiedAll, liveSite: "partial" },
    lastVerifiedDays: 1,
    freshness: "live",
    evidence: { duplicatePhoto: false, feeMessage: false, roleConflict: false },
    photoTone: "paper",
    photoLabel: "卧室照片 · 部分信息待核"
  },
  {
    id: "home-over-budget",
    title: "静安寺 · 高层独卫主卧",
    shortTitle: "高层独卫主卧",
    role: "landlord",
    claimedRole: "landlord",
    publisher: "产权人本人",
    district: "静安区",
    location: "静安寺",
    station: "静安寺站",
    walkMinutes: 5,
    commuteMinutes: 17,
    addressHint: "华山路附近",
    listedRent: 3600,
    minRent: 3300,
    depositMonths: 1,
    availableFrom: "2026-09-01",
    leaseMonthsMin: 12,
    conditionalOffers: [],
    room: { areaSqm: 17, floor: 16, totalFloors: 25, roommateCount: 1, roommateGender: "female" },
    facilities: { ...baseFacilities, ensuite: true },
    fees: { service: 0, intermediary: 0, propertyMonthly: 100, networkMonthly: 0 },
    verification: { ...verifiedAll },
    lastVerifiedDays: 0,
    freshness: "live",
    evidence: { duplicatePhoto: false, feeMessage: false, roleConflict: false },
    photoTone: "blue",
    photoLabel: "高层卧室 · 现场核验图"
  }
];

export const labScenarios = [
  {
    id: "full-demo",
    name: "完整委托",
    description: "混合真实候选、价格协商、性别冲突、过期房源与中介陷阱。",
    listingIds: listings.map((listing) => listing.id)
  },
  {
    id: "price-boundary",
    name: "预算边界",
    description: "挂牌 3,200 元，双方 AI 用租期与起租日协商到 3,000 元。",
    listingIds: ["home-nanyang", "home-over-budget"]
  },
  {
    id: "broker-trap",
    name: "中介伪装",
    description: "低价诱导、角色材料冲突并在站内索取服务费。",
    listingIds: ["home-broker-trap"]
  },
  {
    id: "missing-facts",
    name: "关键信息缺失",
    description: "水电、网费与洗衣机类型未确认，AI 必须降级并标示未知。",
    listingIds: ["home-unknown-utilities", "home-jiangsu"]
  },
  {
    id: "no-fit",
    name: "没有合适房源",
    description: "只有室友性别冲突、超预算与过期房源，结果必须为零。",
    listingIds: ["home-male-roommates", "home-over-budget", "home-stale"]
  }
];

export const demoSupplyDraft = {
  role: "subletter",
  city: "上海",
  district: "静安区",
  location: "静安寺",
  station: "静安寺站",
  address: "上海市静安区南阳路（楼栋号仅匹配后可见）",
  title: "静安寺 8 分钟，朝南次卧个人转租",
  listedRent: 3200,
  minimumAuthorizedRent: 3000,
  // 房东自主给出的让价（不低于 minimumAuthorizedRent）。对外提案价只能取
  // listedRent 或本字段，永不由租客的私密上限推导。
  concessionRent: 3050,
  availableFrom: "2026-09-03",
  leaseEnd: "2027-08-31",
  leaseMonthsMin: 12,
  areaSqm: 15,
  floor: 9,
  totalFloors: 18,
  viewingAvailability: "any",
  roommateGender: "female",
  roommateCount: 2,
  fees: {
    rent: 3200,
    deposit: 3200,
    utilities: "民水民电按账单均摊",
    network: 0,
    property: 0,
    service: 0,
    intermediary: 0
  },
  verification: {
    identity: { submissionStatus: "submitted", verificationStatus: "verified", source: "fixture", reviewedAt: "2026-08-30T02:00:00.000Z", displayLabel: "评测夹具：已核验" },
    roleDocument: { submissionStatus: "submitted", verificationStatus: "verified", source: "fixture", reviewedAt: "2026-08-30T02:00:00.000Z", displayLabel: "评测夹具：已核验" },
    rightsDocument: { submissionStatus: "submitted", verificationStatus: "verified", source: "fixture", reviewedAt: "2026-08-30T02:00:00.000Z", displayLabel: "评测夹具：已核验" },
    livePhotoChallenge: { submissionStatus: "submitted", verificationStatus: "verified", source: "fixture", reviewedAt: "2026-08-30T02:00:00.000Z", displayLabel: "评测夹具：已核验" }
  },
  facilities: {
    kitchen: true,
    washer: true,
    elevator: true,
    ensuite: false,
    exposure: "south"
  }
};

function makeTenantCase({
  id,
  alias,
  occupation,
  locations = ["静安寺"],
  target = 3000,
  hardMax = 3200,
  moveInFrom = "2026-08-28",
  moveInTo = "2026-09-05",
  leaseMonths = 12,
  sharedHousing = true,
  roommateGender = "female",
  maxCommuteMinutes = 40,
  ensuite = false
}) {
  const mandate = structuredClone(baseMandate);
  mandate.id = `mandate-${id}`;
  mandate.locations = locations;
  mandate.budget.target = target;
  mandate.budget.hardMax = hardMax;
  mandate.moveInWindow = { from: moveInFrom, to: moveInTo };
  mandate.leaseMonths = leaseMonths;
  mandate.sharedHousing = sharedHousing;
  mandate.roommateGender = roommateGender;
  mandate.maxCommuteMinutes = maxCommuteMinutes;
  mandate.hardConstraints.ensuite = ensuite;
  return { id, alias, occupation, mandate };
}

// 出租端的对称评测集：既包含可继续的租客，也覆盖性别、整租、区域、
// 预算、租期、入住日和独卫等常见硬冲突。
export const tenantCases = [
  makeTenantCase({ id: "tenant-01", alias: "林同学", occupation: "研究生", target: 3000, hardMax: 3200 }),
  makeTenantCase({ id: "tenant-02", alias: "顾女士", occupation: "产品设计", target: 3100, hardMax: 3300, roommateGender: null }),
  makeTenantCase({ id: "tenant-03", alias: "许同学", occupation: "应届毕业生", target: 2900, hardMax: 3000 }),
  makeTenantCase({ id: "tenant-04", alias: "周先生", occupation: "工程师", roommateGender: "male" }),
  makeTenantCase({ id: "tenant-05", alias: "沈女士", occupation: "教师", sharedHousing: false, roommateGender: null, hardMax: 4300 }),
  makeTenantCase({ id: "tenant-06", alias: "陈同学", occupation: "实习生", locations: ["张江"], hardMax: 3200 }),
  makeTenantCase({ id: "tenant-07", alias: "唐女士", occupation: "编辑", target: 2600, hardMax: 2800 }),
  makeTenantCase({ id: "tenant-08", alias: "陆女士", occupation: "咨询顾问", target: 3200, hardMax: 3500, ensuite: true }),
  makeTenantCase({ id: "tenant-09", alias: "韩同学", occupation: "交换生", target: 3200, hardMax: 3400, leaseMonths: 3 }),
  makeTenantCase({ id: "tenant-10", alias: "夏女士", occupation: "金融从业", target: 3100, hardMax: 3300, moveInFrom: "2026-08-20", moveInTo: "2026-08-28" })
];

export function getListingsByIds(ids) {
  const allowed = new Set(ids);
  return listings.filter((listing) => allowed.has(listing.id));
}
