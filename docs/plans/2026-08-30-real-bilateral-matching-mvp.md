# v0.7 Real Bilateral Matching MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把当前“AI 对话 + 模拟市场 + 结果展示”的原型，迭代成一条可验证的真实双边闭环：真实租客任务与真实房东任务持续匹配，AI 只追问阻断匹配的未知信息，双方针对同一版条件分别确认，服务端确认双方同意后才解锁联系方式。

**Architecture:** 保留 Node.js、SQLite、原生前端和确定性硬条件匹配器；把 Qwen 放在需求理解、定向追问、解释和经授权的协商位置，不让大模型决定硬条件是否通过。新增版本化任务、双边 `match_case`、条款版本、澄清请求、双方确认、联系方式授权、事件日志和增量匹配作业。前端改为完全读取服务端事实，不再用种子数据、本地布尔值或脚本动画伪造真实闭环。

**Tech Stack:** Node.js ESM、`node:http`、`node:sqlite`、Qwen 3.5 via SiliconFlow、Vanilla JavaScript、CSS、Node Test Runner、Playwright、`sharp`、SQLite WAL。

---

## 1. 执行结论

下一步不要继续堆更多首页视觉、聊天文案或模拟候选。唯一主线应当是：

> **v0.7 · 真实双边匹配：让两个真实用户任务在服务端形成唯一匹配案例，并完成“澄清—同版确认—联系方式解锁”的闭环。**

当前产品已经证明了三件事：AI 对话可以把自然语言转成结构化草稿；租客与房东都能创建任务；系统可以持续刷新候选并展示结果。但核心目标仍未真正实现，因为当前候选池主要由内置数据填充，AI 澄清只完成了首轮 intake，双方确认与联系方式解锁是前端演示状态，用户修正过的字段还有被旧解析值覆盖的风险。

因此，v0.7 的完成标准不是“页面看起来像完成了”，而是以下链路在两个独立会话中真实发生并可由数据库和审计事件证明：

```text
真实租客创建需求任务
        ↓
真实房东创建房源任务
        ↓
系统对任务对进行确定性双向评估
        ↓
形成唯一 match_case；若有阻断未知项则定向追问
        ↓
生成不可歧义的公开条款版本 terms_version + terms_hash
        ↓
租客与房东分别确认同一版本
        ↓
服务端签发 contact_grant
        ↓
双方才能读取对方联系方式并推进看房
```

任何一个环节都不能由前端本地状态、假联系人、预设倒计时、种子账号或含糊的“已核验”文案替代。

## 2. 当前核心目标实现度复核

本表按 2026-08-30 的仓库快照判断，不以演示页面是否出现某个视觉状态为依据，而以数据是否真实、状态是否可恢复、规则是否可审计为依据。

| 核心能力 | 当前状态 | 已经做到 | 仍然缺失 | v0.7 验收证据 |
| :---: | :---: | :---: | :---: | :---: |
| AI 帮租客完善需求 | 部分实现 | Qwen intake、规则降级、结构化字段、追问界面 | 地点语义可能混淆；多问题只展示首个；用户修改可能被旧解析值覆盖 | 用户修改后，请求体、数据库和最终匹配均使用修改值；字段准确率达到门槛 |
| AI 帮房东完善房源 | 部分实现 | 房源对话、字段草稿、材料上传入口、风险提示 | 草稿继承演示默认值；材料只上传未核验；真实公开图片管线缺失 | 缺失字段保持未知；上传与核验分离；公开照片有授权和处理链路 |
| AI 自动完成匹配 | 部分实现 | 有确定性打分、候选生成、定时刷新 | 主要使用种子市场；不是对真实任务对进行权威双边评估；Qwen 未参与阻断未知项澄清 | 真实任务对产生唯一案例；种子候选永不产生案例；硬条件零泄漏 |
| 不依赖人工反复聊天 | 未实现 | 结果卡和解释降低了一部分人工沟通 | 澄清、协商、同版确认与联系方式门禁均未形成服务端闭环 | AI 最多追问高价值问题；双方确认前禁止自由聊天和联系方式交换 |
| 持续匹配 | 技术原型 | 10 秒调度、任务状态、候选版本 | 全量扫描、同步 SQLite、每实例调度；UI 即使断线仍可能声称匹配中 | 任务变更触发增量作业；调度器只做补偿；P95 重算时间达标 |
| 结果界面 | 基本实现 | 结果列表、详情、解释、地图与状态视觉 | 结果真假混合；多任务不可管理；刷新/深链/错误与无障碍不足 | 任务中心、案例详情、真实状态、连接状态、同会话深链完整 |
| 双方确认后推进 | 未实现 | 有演示按钮和固定联系人 | 无服务端案例、条款版本、双方确认、授权、撤销 | 两个会话确认同一 `terms_hash` 后才可读取对方联系方式 |

结论：现有版本适合证明交互概念，不适合声称“核心目标已实现”。v0.7 完成后，才能准确声称“真实双边匹配闭环已建立”；仍不能声称已经完成实名、产权、合同、支付或官方核验。

## 3. 版本边界

### 3.1 v0.7 必须完成

- 租客和房东使用两个不同账号或受控会话创建真实任务。
- 每个字段保存值、来源、置信度、确认状态、可见性和版本。
- 用户确认或编辑的值始终覆盖 AI 推断值。
- 一个租客任务和一个房东任务最多形成一个当前有效的 `match_case`。
- 硬条件由确定性规则判断；未知硬条件不会被猜成“符合”。
- AI 每轮只追问最多三个最有信息增益的问题，优先消除阻断项。
- 公开条款生成明确版本与哈希；条款变化自动撤销旧确认。
- 租客与房东分别确认同一版条款；单方确认不能解锁联系方式。
- 联系方式只通过服务端授权接口返回，并可失效、撤销和审计。
- 任务新增、修改、暂停、恢复、关闭、过期会触发正确的增量重算。
- 结果页展示真实任务、真实候选、真实案例状态和真实房源公开照片。
- 断线、AI 降级、匹配失败和空结果都必须诚实展示。
- 存储型 XSS、模型成本滥用、伪造图片、会话泄露和私密字段串线有自动测试。
- 建立一套两账号端到端冒烟脚本和一个受控城市小范围试点方案。

### 3.2 v0.7 明确不做

- 押金、租金支付、资金托管。
- 电子合同、法律签署、争议仲裁。
- 官方身份证、产权或征信核验。
- 租前自由聊天、社区、动态广场。
- 中介批量房源工具和全国范围供给接入。
- 大模型自主决定硬条件通过、自主承诺价格或代替用户作出有约束力的同意。
- PostgreSQL、Redis、Kafka 或复杂通用工作流引擎迁移。
- 多语言、原生 App、完整后台运营系统。

以上能力不是不重要，而是不应阻塞最小闭环的真实性验证。公网试点前，手机号登录、真实核验服务、隐私加密和生产数据库隔离仍是阻断项，见本文第 17 节。

### 3.3 “真实”的精确定义

v0.7 中的“真实”只表示：

- 供需两边都来自数据库中的真实用户任务，而不是静态语料。
- 案例、澄清、条款、确认和联系人授权都由服务端持久化并恢复。
- 页面刷新、重新登录或更换前端状态后，结果仍由服务器事实决定。
- 公开数据和私密数据有明确边界。

它不表示：

- 上传材料已经得到第三方或人工核验。
- 房源、身份、产权和信用已经获得官方背书。
- 双方确认等同于法律合同。

## 4. 产品原则与系统不变量

下面的规则是实现过程中不可用“先做演示”绕过的约束。

1. 用户编辑优先于 AI 推断；AI 不能静默覆盖用户已经确认的字段。
2. 未知值保持未知；阻断匹配的未知值进入澄清，不得用默认值补齐。
3. 硬条件由确定性规则裁决；Qwen 负责理解、提问、解释和生成候选建议。
4. 种子市场只允许在显式 `DEMO_MODE=true` 下展示，永远不能生成真实匹配案例。
5. 同一供需任务对最多有一个当前案例；重复作业必须幂等。
6. 双方必须确认完全相同的 `terms_version` 和 `terms_hash`。
7. 任一相关字段变化，都使旧条款、旧确认和旧联系人授权失效。
8. 单方确认、前端按钮状态或客户端缓存都不能解锁联系人。
9. 一份案例的授权不能读取另一份案例的数据；非参与者统一返回 404，避免枚举。
10. 租客最高预算、房东最低授权价、精确地址、原始材料和联系方式不得出现在公共候选投影。
11. “已上传”“待审核”“规则检查通过”“双方已确认”“官方核验”是不同事实，文案不得混用。
12. 空结果是真实结果；系统不得为避免空白而注入假候选。
13. 所有写操作都可安全重试，所有关键状态变化都有结构化事件。
14. 前端只保存界面偏好和当前任务 ID，不保存授权、确认或私密业务真值。
15. AI 不可用时可以降级为规则解析，但必须向用户明确说明能力变化。

## 5. 两条验收故事

### 5.1 故事 A：租客先创建任务，房源后出现

1. 租客输入：“静安寺附近找房，预算三千五左右，去陆家嘴通勤最好 30 分钟，九月初入住，接受合租。”
2. 系统识别“静安寺”为目标居住区域，“陆家嘴”为通勤目的地，而不是把二者都当成可住区域。
3. AI 一轮最多追问三个阻断或高价值问题，例如预算上限、租期和对室友性别的要求。
4. 系统预填通勤上限 30 分钟；租客手工改为 25 分钟并确认。
5. 最终任务请求、数据库字段和匹配规则全部使用 25 分钟，任何地方都不能恢复为 30 分钟。
6. 此时没有真实符合房源，结果页诚实显示“暂无真实符合项”，并说明系统仍在持续匹配。
7. 两天后一个房东发布符合区域与价格的真实房源，任务变更事件触发该任务对的增量评估。
8. 系统发现水电费用承担方式未知，且它会影响预算判断，于是只向房东发出定向澄清。
9. 房东回答后，系统生成公开条款版本 1，并分别给双方展示相同的租金、入住窗口、租期、费用边界和仍存在的非阻断未知项。
10. 租客确认版本 1 后仍不能看联系方式；房东确认同一版本后，服务端才签发联系人授权。
11. 若房东随后修改月租，版本 1 的双方确认和授权立即失效，生成版本 2，必须重新确认。

### 5.2 故事 B：房东先发布房源，持续等待租客

1. 房东描述房源，但没有提供最低可接受租金、最短租期、楼层电梯、额外费用、可看房时间或材料状态。
2. 系统不得沿用演示默认的面积、楼层或 12 个月租期；未知字段明确显示“待补充”。
3. AI 按优先级追问：合法性与安全、硬条件、价格与租期、会显著减少沟通的信息。
4. 房东上传公开房源照片和私密证明材料。两者进入不同数据模型与权限域。
5. 私密材料只显示“已上传，待审核”；只有人工或第三方服务真正完成核验后，才能显示相应核验结果。
6. 新租客任务出现后，系统做真实任务对评估并形成案例。
7. 租客最高预算与房东最低授权价只用于服务端计算，双方只看到落入交集的建议公开租金，不看到对方底牌。
8. 房东单方确认不解锁联系人；租客确认同一版条款后才解锁。
9. 任务暂停、过期或房源撤回后，案例失效，联系人接口重新返回锁定状态。

## 6. 目标领域模型

### 6.1 字段级真值模型

需求和房源中的关键字段不再只保存一个裸值，而保存以下元数据：

```js
{
  value: 25,
  source: "user_confirmed",
  confidence: 1,
  confirmationStatus: "confirmed",
  visibility: "case_public",
  version: 3,
  updatedAt: "2026-08-30T12:00:00.000Z"
}
```

`source` 只允许：

- `user_text`
- `ai_inferred`
- `user_confirmed`
- `counterparty_answer`
- `map_service`
- `document_submitted`
- `manual_review`
- `third_party_verification`

`visibility` 只允许：

- `owner_private`：只有任务所有者和必要的服务端计算可见。
- `matching_private`：只用于匹配器，不能直接返回给任一对手方。
- `case_public`：可进入具体双边案例公开条款。
- `market_public`：可进入候选列表的公开摘要。

合并优先级固定为：

```text
同一字段的最新 user_confirmed
    > 最新 counterparty_answer
    > 最新 user_text
    > map_service / manual_review / third_party_verification
    > ai_inferred
    > unknown
```

这里的优先级只处理同一字段的值来源，不代表低优先级来源的核验效力较低。例如 `third_party_verification` 应作为独立核验事实存在，不能被用户修改成“已核验”。

### 6.2 案例状态机

```text
potential
  ├─ 有阻断未知项 ─────────────→ clarifying
  │                              │
  │                        澄清答案写入
  │                              ↓
  └─ 条件完整且硬条件通过 ─────→ terms_ready
                                  ↓
                         awaiting_confirmations
                            │              │
                      一方确认         任一方拒绝
                            │              ↓
                            │           declined
                            ↓
                    mutually_confirmed
                            ↓
                     contact_unlocked
                            ↓
                    viewing_scheduled
                            ↓
                          closed

任务、条款或资格变化：任一非终态 → invalidated → 重新评估
任务到期：任一非终态 → expired
```

状态实现时，`contact_unlocked` 可以是由有效授权推导出的能力，而不是必须写进 `match_cases.status` 的重复状态。接口仍必须返回用户可理解的展示状态。

### 6.3 SQLite v0.7 数据结构

迁移使用 `PRAGMA user_version`，每次迁移在一个事务内完成。以下 SQL 是目标语义，实施时应根据现有表名和约束生成 `src/server/migrations/*.sql` 或等价的 ESM migration。

```sql
ALTER TABLE tasks ADD COLUMN input_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tasks ADD COLUMN client_request_id TEXT;
ALTER TABLE tasks ADD COLUMN expires_at TEXT;
ALTER TABLE tasks ADD COLUMN last_matched_at TEXT;

CREATE UNIQUE INDEX tasks_owner_client_request_idx
ON tasks(owner_id, client_request_id)
WHERE client_request_id IS NOT NULL;

CREATE TABLE task_fields (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  value_json TEXT,
  source TEXT NOT NULL,
  confidence REAL,
  confirmation_status TEXT NOT NULL,
  visibility TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(task_id, field_key)
);

CREATE TABLE match_cases (
  id TEXT PRIMARY KEY,
  renter_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  supply_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  renter_input_version INTEGER NOT NULL,
  supply_input_version INTEGER NOT NULL,
  current_terms_version INTEGER,
  terminal_reason TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(renter_task_id, supply_task_id)
);

CREATE TABLE match_terms (
  match_case_id TEXT NOT NULL REFERENCES match_cases(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  terms_hash TEXT NOT NULL,
  public_terms_json TEXT NOT NULL,
  blocking_unknowns_json TEXT NOT NULL,
  non_blocking_unknowns_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  invalidated_at TEXT,
  PRIMARY KEY(match_case_id, version),
  UNIQUE(match_case_id, terms_hash)
);

CREATE TABLE clarification_requests (
  id TEXT PRIMARY KEY,
  match_case_id TEXT NOT NULL REFERENCES match_cases(id) ON DELETE CASCADE,
  terms_version INTEGER,
  target_party TEXT NOT NULL CHECK(target_party IN ('renter', 'supply')),
  field_key TEXT NOT NULL,
  question TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  priority INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open', 'answered', 'dismissed', 'superseded')),
  raw_answer TEXT,
  structured_answer_json TEXT,
  created_at TEXT NOT NULL,
  answered_at TEXT
);

CREATE UNIQUE INDEX clarification_open_field_idx
ON clarification_requests(match_case_id, target_party, field_key)
WHERE status = 'open';

CREATE TABLE party_confirmations (
  match_case_id TEXT NOT NULL REFERENCES match_cases(id) ON DELETE CASCADE,
  party TEXT NOT NULL CHECK(party IN ('renter', 'supply')),
  owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  terms_version INTEGER NOT NULL,
  terms_hash TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('confirmed', 'declined')),
  confirmed_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY(match_case_id, party, terms_version)
);

CREATE TABLE profile_contacts (
  owner_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  contact_type TEXT NOT NULL CHECK(contact_type IN ('wechat', 'phone', 'email')),
  encrypted_value TEXT NOT NULL,
  masked_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE contact_grants (
  id TEXT PRIMARY KEY,
  match_case_id TEXT NOT NULL REFERENCES match_cases(id) ON DELETE CASCADE,
  terms_version INTEGER NOT NULL,
  renter_owner_id TEXT NOT NULL REFERENCES profiles(id),
  supply_owner_id TEXT NOT NULL REFERENCES profiles(id),
  granted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revoke_reason TEXT,
  UNIQUE(match_case_id, terms_version)
);

CREATE TABLE listing_media (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK(purpose IN ('public_listing', 'private_evidence')),
  original_path TEXT NOT NULL,
  derivative_path TEXT,
  detected_mime TEXT,
  sha256 TEXT NOT NULL,
  review_status TEXT NOT NULL,
  public_consent_at TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE viewing_appointments (
  id TEXT PRIMARY KEY,
  match_case_id TEXT NOT NULL REFERENCES match_cases(id) ON DELETE CASCADE,
  proposed_by TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE match_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_case_id TEXT NOT NULL REFERENCES match_cases(id) ON DELETE CASCADE,
  actor_owner_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE outbox_events (
  id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  locked_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
```

`public_terms_json` 只能包含双方应共同确认的内容，例如公开租金、入住窗口、租期、押付方式、公开费用、房源粗粒度位置、看房条件和非阻断未知项。以下内容严禁写入：租客最高预算、房东最低授权价、精确门牌、原始输入、材料路径、联系方式、session/token 或完整 owner ID。

### 6.4 核心对象关系

```text
profile ── owns ── task ── has ── task_field
                    │
                    ├── emits ── outbox_event
                    │
        renter task ├── paired with ── supply task
                    │                    │
                    └────── match_case ──┘
                                  │
                ┌─────────────────┼──────────────────┐
                │                 │                  │
          match_terms     clarification_request  match_event
                │
       party_confirmation × 2
                │
           contact_grant
                │
       viewing_appointment
```

## 7. AI 与规则引擎的职责边界

### 7.1 Qwen 应负责

- 从自然语言提取字段，并为每个字段返回来源片段与置信度。
- 区分居住区域、通勤目的地、地铁站、城市和行政区。
- 在已有结构化状态上选择最多三个高价值澄清问题。
- 把确定性匹配器给出的原因转成用户能理解的解释。
- 在双方明确授权的价格区间内提出建议，不能自行确认。
- 把澄清回答转成受 schema 约束的字段更新建议。

### 7.2 确定性服务必须负责

- 金额、日期、租期、通勤上限、整租/合租、设施和身份边界等硬条件。
- 任务状态、案例唯一性、条款版本、哈希、双方确认和授权。
- 私密字段的可见性裁剪。
- 图片类型、大小、解码、元数据去除和访问权限。
- 幂等、并发冲突、失效、过期和事件记录。
- 联系方式是否可以解锁。

### 7.3 AI 输出契约

所有模型输出必须经过严格 schema 验证，失败时只允许一次针对 JSON 格式的修复重试，再失败则进入规则降级，不得把半结构化结果直接写入任务。

```js
{
  schemaVersion: 1,
  fields: {
    targetLocations: [{
      value: "静安寺",
      semanticRole: "residential_target",
      confidence: 0.94,
      evidence: "静安寺附近找房"
    }],
    commuteDestination: {
      value: "陆家嘴",
      semanticRole: "commute_destination",
      confidence: 0.97,
      evidence: "去陆家嘴通勤"
    }
  },
  questions: [{
    fieldKey: "budget.hardMax",
    reasonCode: "HARD_CONDITION_UNKNOWN",
    question: "你能接受的月租最高上限是多少？",
    priority: 100
  }],
  warnings: []
}
```

请求约束：

- 单次模型调用默认超时 20 秒，最多一次可重试错误；禁止当前 120 秒乘多次重试的长尾。
- 每个会话和 IP 有分钟、小时和日级配额。
- 单个 intake 最多保留必要上下文，不无限累积 `calls`。
- Provider 错误映射为内部稳定错误码，不把原始响应返回浏览器。
- 提示词版本、模型名、耗时、token 用量、schema 成功与否写指标，不写用户完整原文到普通日志。

### 7.4 澄清问题优先级

按以下顺序计算问题价值：

1. 合法性与人身安全。
2. 会直接决定硬条件是否通过的未知字段。
3. 会改变公开条款版本的价格、租期、费用和日期。
4. 历史上最容易导致重复沟通的信息。
5. 只影响排序的软偏好。

每轮最多三个问题；同一案例、同一方、同一字段不能存在两个 open 问题；用户已经确认的答案不重复追问；冲突必须显式展示“原值—新值—影响”，不能静默选择。

## 8. 匹配与持续重算设计

### 8.1 一次任务对评估

匹配器输入是两个固定版本的任务：

```js
evaluateTaskPair({
  renterTask,
  renterInputVersion,
  supplyTask,
  supplyInputVersion,
  evaluatedAt
})
```

输出必须是对称、可复现、可解释的结果：

```js
{
  eligible: false,
  hardConflicts: [],
  blockingUnknowns: ["utilities.payer"],
  nonBlockingUnknowns: ["roommate.schedule"],
  score: 78,
  publicReasons: ["预算区间有交集", "通勤时间符合上限"],
  privateDiagnostics: [],
  termsProposal: null,
  evaluatorVersion: "rules-0.7.0"
}
```

规则：

- 有硬冲突：不创建可确认条款；双方候选中可选择不展示或展示为明确不匹配诊断，不能误标为候选。
- 无硬冲突但有阻断未知项：创建或保持 `clarifying` 案例，只向能回答的一方提问。
- 无硬冲突且阻断未知项为空：生成或复用 `terms_hash`，进入 `terms_ready`。
- 只有排序偏好未满足：可以成为候选，但解释中必须区分“满足硬条件”和“偏好得分”。
- 同一输入版本与评估器版本重复执行，结果和事件必须幂等。

### 8.2 增量匹配作业

创建或修改任务时，在同一个数据库事务中更新任务并写入：

```js
{
  eventType: "task.match_requested",
  aggregateId: taskId,
  dedupeKey: `task:${taskId}:input:${inputVersion}`
}
```

单进程 Worker 执行：

1. 以 `BEGIN IMMEDIATE` 领取一个可执行事件。
2. 查询相反类型、状态为 active、城市与粗粒度区域可能相交的真实任务。
3. 对每个任务对调用一次确定性评估。
4. 在一个短事务中 upsert 双方候选投影、案例、澄清、条款与事件。
5. 将作业标记 completed。
6. 失败时记录稳定错误码，指数退避，达到上限后进入 failed 并告警。

当前 10 秒全量 scheduler 保留为补偿器：只扫描卡住的 pending/processing 事件、过期任务和需要重新对账的案例，不再每轮全量 O(R×S) 重算所有 active 任务。

### 8.3 冷启动与种子数据

- 默认运行模式为 `MARKET_MODE=real`，只展示真实任务产生的候选。
- `MARKET_MODE=demo` 才加载语料市场，并在页面顶部持续显示“演示数据”。
- demo 候选没有真实 owner，不生成 `match_case`，不显示双方确认和联系方式入口。
- 真实模式的空结果必须给出可操作解释：哪些硬条件导致供给稀疏、系统是否在线、任务何时再次匹配。
- 试点通过定向招募供需解决冷启动，不通过把种子候选混进真实结果解决。

## 9. 接口契约

所有修改类接口要求有效会话、`Content-Type` 白名单、请求体大小限制、Origin/CSRF 校验和 `Idempotency-Key`。非参与者访问案例统一返回 404。

### 9.1 任务接口

```text
POST   /api/tasks
GET    /api/tasks
GET    /api/tasks/:taskId
PATCH  /api/tasks/:taskId
POST   /api/tasks/:taskId/pause
POST   /api/tasks/:taskId/resume
POST   /api/tasks/:taskId/close
POST   /api/tasks/:taskId/renew
GET    /api/tasks/:taskId/matches
```

`POST /api/tasks` 示例：

```json
{
  "clientRequestId": "0beec7b5-43c8-4c90-a92a-3c3a5f67de31",
  "kind": "renter",
  "rawText": "静安寺附近找房，去陆家嘴通勤 25 分钟以内",
  "fields": {
    "budget.hardMax": {
      "value": 3500,
      "source": "user_confirmed",
      "confirmationStatus": "confirmed"
    }
  }
}
```

幂等语义：

- 首次创建返回 201。
- 相同 owner、相同 `clientRequestId`、相同规范化请求返回原任务，状态 200。
- 相同 ID、不同请求哈希返回 409 `IDEMPOTENCY_CONFLICT`。
- 任务修改必须携带 `expectedInputVersion`；旧版本返回 409 `TASK_VERSION_CONFLICT`。

### 9.2 案例与澄清接口

```text
GET   /api/matches/:matchCaseId
GET   /api/matches/:matchCaseId/events
POST  /api/matches/:matchCaseId/clarifications/:clarificationId/answers
POST  /api/matches/:matchCaseId/confirm
POST  /api/matches/:matchCaseId/decline
GET   /api/matches/:matchCaseId/contact
POST  /api/matches/:matchCaseId/viewings
```

确认请求必须明确绑定版本：

```json
{
  "termsVersion": 2,
  "termsHash": "sha256:4ec7...",
  "decision": "confirmed"
}
```

确认接口规则：

- 当前用户必须是该案例的参与方。
- 当前条款版本与哈希必须完全相等。
- 案例必须处于可确认状态，任务仍 active 且未过期。
- 当前用户必须已经设置可用联系人。
- 同一决定重复提交返回 200 且不重复写事件。
- 条款变更、任务暂停、关闭、过期或硬条件变化会撤销确认。

### 9.3 联系方式接口

```text
PUT  /api/profile/contact
GET  /api/matches/:matchCaseId/contact
```

单方确认时返回：

```json
{
  "code": "CONTACT_LOCKED",
  "message": "双方确认同一版条件后才能交换联系方式"
}
```

双方确认且授权仍有效时才返回对手方联系人。每次读取只记录 `contact.viewed` 事件，不在事件或普通日志中记录联系人原值。

### 9.4 稳定错误码

| HTTP | 错误码 | 用户语义 | 客户端动作 |
| :---: | :---: | :---: | :---: |
| 400 | `INVALID_REQUEST` | 请求格式不正确 | 显示字段错误，不自动重试 |
| 401 | `SESSION_REQUIRED` | 会话已失效 | 引导重新登录 |
| 404 | `NOT_FOUND` | 资源不存在或不可访问 | 返回任务中心，避免泄露 |
| 409 | `TASK_VERSION_CONFLICT` | 任务已在别处更新 | 拉取新版本并让用户复核 |
| 409 | `TERMS_VERSION_CONFLICT` | 条款已变化 | 显示新旧差异并重新确认 |
| 409 | `IDEMPOTENCY_CONFLICT` | 重试 ID 被用于不同请求 | 停止重试并记录诊断 |
| 422 | `CONTACT_REQUIRED` | 确认前未设置联系人 | 打开联系人设置 |
| 422 | `BLOCKING_FIELDS_UNKNOWN` | 仍有阻断信息未知 | 展示澄清问题 |
| 429 | `RATE_LIMITED` | 请求过于频繁 | 展示重试时间 |
| 503 | `AI_DEGRADED` | AI 暂时不可用 | 明示规则降级并允许继续 |

## 10. 前端信息架构

### 10.1 页面与 URL

本轮保留 Vanilla JS，不迁移框架。使用查询参数实现同会话深链，避免静态服务端路由改造：

```text
/?view=tasks
/?view=task&task=<taskId>
/?view=match&task=<taskId>&match=<matchCaseId>
```

跨用户公开分享不在 v0.7 范围内。当前“分享”只能复制脱敏文字摘要，不能声称链接可在陌生会话或其他设备打开。

### 10.2 任务中心

任务中心必须显示：

- 找房或出租类型。
- active、paused、closed、expired 状态。
- 真实候选数、待澄清数、待本人确认数和等待对方确认数。
- 上次匹配时间、下次或当前重算状态、到期时间。
- 暂停、恢复、关闭、续期入口。

服务端 `GET /api/tasks` 是事实源。localStorage 最多只保存 `activeTaskId`；不存在或无权访问时回退到最新 active 任务。

### 10.3 匹配案例详情

详情页从上到下固定为：

1. 案例真实性与当前状态。
2. 公开房源摘要或租客摘要。
3. 硬条件通过项、软偏好得分和未知项，三者视觉分离。
4. 双方共同看到的公开条款版本。
5. AI 仍需澄清的问题。
6. 本人确认状态与对方确认状态。
7. 联系方式门禁或已授权联系人。
8. 事件时间线与举报入口。

页面不得展示租客 `hardMax`、房东 `minRent`、精确地址或私密材料。价格交集只显示建议公开租金和生成依据的公开说明。

### 10.4 连接与错误状态

将当前模糊的 `serverReady/syncError` 收敛为：

```js
connection: {
  phase: "connecting" | "online" | "degraded" | "offline",
  message: "",
  lastSuccessAt: null
}
```

- 轮询或增量拉取失败时，页面不能继续只显示“持续匹配中”。
- 顶部显示持久连接条、上次成功时间和“立即重试”。
- AI 降级与服务器离线是不同状态。
- 字段错误使用 `aria-invalid`、`aria-describedby` 并聚焦首个错误。
- 关键错误不能只放在 2.2 秒 Toast 中。
- 恢复成功后清除错误，并仅播报一次恢复状态。

### 10.5 弹层与可访问性

现有 bottom sheet 可保留，但必须增加：

- `role="dialog"`、`aria-modal="true"`、`aria-labelledby`。
- 打开时保存触发元素并把背景设为 `inert`。
- 初始焦点、Tab/Shift+Tab 焦点循环、Esc 关闭。
- 关闭后恢复焦点；整体 `render()` 后按稳定 key 恢复。
- 移除整个 `#app` 的 `aria-live`，改用独立状态播报区域。
- 所有交互目标至少 44×44 CSS 像素。
- 尊重 `prefers-reduced-motion`。

### 10.6 真实图片与材料边界

- 内置演示房源使用带 `alt`、宽高和懒加载属性的 `<img>`，不再用 CSS 背景冒充语义图片。
- 用户公开房源照片使用独立 `listing_media.purpose=public_listing`。
- 身份、产权、活体和核验材料使用 `private_evidence`，永不直接进入候选图。
- 用户没有授权公开照片时显示“暂无公开实拍”的中性占位，不能随机套样板房。
- 上传后必须检测魔数、真实解码、重新编码、移除 EXIF/GPS、限制像素和文件大小，公开图只返回处理后的 derivative。

## 11. 安全、隐私与真实性阻断项

| 风险 | 当前问题 | v0.7 修复 | 自动验收 |
| :---: | :---: | :---: | :---: |
| 存储型 XSS | 用户区域、房源标题等进入 `innerHTML` | 按 sink 输出编码；CSP；不在 DB 层预转义 | 恶意供给跨账号显示为纯文本，DOM 无注入节点 |
| 会话泄露 | Bearer token 存 localStorage | HttpOnly、SameSite cookie；TTL、撤销、Origin/CSRF 检查 | 刷新恢复；脚本无法读取 token；跨源写入失败 |
| AI 成本滥用 | 匿名会话与 AI 接口无配额 | IP、会话、账号三级令牌桶与日预算 | 超额返回 429；provider 调用数不增加 |
| 请求体滥用 | JSON 上限约 14 MB | 文本路由 64 KB；上传路由独立上限；超限提前终止 | 超限请求不进入解析器或模型 |
| 伪图片 | 只信 MIME/base64 | 魔数、解码、像素限制、重编码、哈希与隔离目录 | 文本伪装 JPEG 被拒绝；EXIF/GPS 不存在 |
| 假核验 | 上传即显示已核验 | submission 与 verification 分表和文案 | 上传后只能显示“待审核” |
| 私密字段串线 | 原始 payload 与双方底价同库存储 | 最小公开投影、字段可见性、响应 schema | API 快照扫描私密字段泄露为 0 |
| 假候选 | 真实任务与种子市场混合 | 默认 real mode；demo 显式标记；demo 不生成案例 | real mode 种子候选数为 0 |
| 假确认 | 前端布尔值与硬编码联系人 | 服务端条款版本、双方确认、contact grant | 单方确认联系人始终 403 |
| 文件权限 | SQLite 可能为 0644 | 数据目录 0700，DB 与敏感文件 0600 | 启动测试检查权限 |

建议新增基础 CSP：

```text
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
connect-src 'self';
object-src 'none';
base-uri 'none';
frame-ancestors 'none';
```

当前 CSS 变量仍依赖内联 style，因此先保留 `style-src 'unsafe-inline'`。后续把动态样式改为 class/nonce 后再收紧。

## 12. 真实性文案字典

| 系统事实 | 允许文案 | 禁止文案 |
| :---: | :---: | :---: |
| 文件刚上传 | 已上传，待审核 | 已核验、真实房源 |
| 规则检查通过 | 格式与规则检查通过 | 官方认证 |
| AI 提取字段 | AI 已识别，请你确认 | AI 已替你确认 |
| 系统提出价格 | 建议公开租金 | 双方已谈妥 |
| 一方确认 | 你已确认，等待对方 | 双方已确认 |
| 双方同版确认 | 双方已确认版本 N | 已签约 |
| 授权有效 | 已解锁对方联系方式 | 平台担保安全 |
| 任务 active | 正在本平台真实供需池持续匹配 | 正在全网寻找 |
| 没有候选 | 暂无真实符合项 | 用模拟结果填满列表 |
| 非阻断未知 | 可继续比较，仍有信息待确认 | 所有信息完整 |
| 阻断未知 | 需要补充后才能判断是否符合 | 大概率符合 |

## 13. 观测、指标和事件

### 13.1 北极星指标

> **每 100 个激活的真实任务中，7 天内形成的有效双方同版确认数。**

这个指标同时要求有真实供给、有效匹配、足够解释、低沟通成本和双方意愿，比候选卡点击率更接近核心价值。

### 13.2 漏斗指标

```text
任务开始
→ 有效结构化任务
→ 24 小时内获得至少一个真实候选
→ 打开案例详情
→ 完成阻断澄清
→ 形成 terms_ready
→ 任一方确认
→ 双方确认
→ 联系方式读取
→ 看房预约
→ 案例关闭及结果原因
```

### 13.3 质量与安全护栏

- 种子候选混入真实模式：0。
- 硬条件冲突仍进入可确认案例：0。
- 用户确认值被旧 AI 值覆盖：0。
- 私密字段泄露：0。
- 单方确认提前解锁联系人：0。
- 条款版本不一致仍双方确认：0。
- 上传材料被称为已核验：0。
- 确认前自由聊天或联系方式旁路：0。
- XSS 回归：0。
- 同一事件重复处理产生重复案例：0。

### 13.4 事件命名

至少记录：

```text
task.created
task.updated
task.paused
task.resumed
task.expired
match.job_requested
match.job_completed
match.case_created
match.case_invalidated
clarification.requested
clarification.answered
terms.created
terms.invalidated
confirmation.recorded
confirmation.revoked
contact.granted
contact.viewed
contact.revoked
viewing.proposed
viewing.accepted
report.submitted
```

事件 payload 只保存分析所需的 ID、版本、原因码和耗时，不保存联系方式原值、完整原始对话、精确地址或材料路径。

---

## 14. 实施任务总览

以下任务按依赖顺序执行。每个任务都要求先写失败测试、确认失败原因正确、做最小实现、跑局部测试、再跑全量回归。一个任务一个小提交，便于审查与回滚。

| 顺序 | 任务 | 主要交付 | 阻断关系 |
| :---: | :---: | :---: | :---: |
| 0 | 冻结基线与功能开关 | 可复现现状、real/demo 分离 | 无 |
| 1 | 不可信输出与 CSP | 消除跨用户存储型 XSS | 阻断真实双边数据展示 |
| 2 | 会话、限流与输入契约 | 安全会话、成本配额、稳定错误 | 阻断公网/多人测试 |
| 3 | 用户确认字段成为真值 | 修复编辑覆盖、地点语义、字段来源 | 阻断任何真实匹配 |
| 4 | 日期与核验真实性 | 实时时钟、上传与核验分离 | 阻断可信房源发布 |
| 5 | 版本化迁移与领域表 | v0.7 数据基础 | 依赖 0 |
| 6 | 任务对评估与案例服务 | 真实供需形成唯一案例 | 依赖 3、5 |
| 7 | AI 定向澄清 | 阻断未知项闭环 | 依赖 3、6 |
| 8 | 条款版本与双边确认 | 同版确认、自动失效 | 依赖 6、7 |
| 9 | 联系方式授权 | 双方确认后服务端解锁 | 依赖 2、8 |
| 10 | 真实公开图片管线 | 公私媒体分离、图像净化 | 依赖 2、4、5 |
| 11 | Outbox 与增量匹配 | 可靠持续匹配 | 依赖 5、6 |
| 12 | 任务中心与案例 UI | 服务端事实源、多任务、深链 | 依赖 6–11 |
| 13 | 连接状态与无障碍 | 可恢复错误、弹层焦点 | 可与 10–11 并行 |
| 14 | 事件、通知与生命周期 | 真实指标、续期、举报、看房 | 依赖 8–12 |
| 15 | 双账号 E2E 与试点闸门 | 完整验收、发布判定 | 依赖全部 |

## 15. 逐任务实施说明

### Task 0：冻结基线并分离 real/demo 模式

**目标：** 为后续改动建立可重复基线；默认不再把种子市场混入真实结果，同时保留显式演示模式供 README 截图与产品演示使用。

**文件：**

- Create: `src/server/runtime-config.mjs`
- Create: `tests/runtime-config.test.mjs`
- Modify: `.env.example`
- Modify: `server.mjs`
- Modify: `src/server/matching-service.mjs`
- Modify: `src/app.mjs`
- Modify: `package.json`
- Modify: `docs/product-architecture.md`

**Step 1：记录基线。**

先执行：

```bash
npm test
npm run check
npm run eval:marketplace
git status --short
```

预期：当前测试与静态检查通过；若 HTTP 测试因沙箱端口被 skip，只允许在开发机记录，CI 最终闸门必须是 `0 skipped`。将基线测试数、评测摘要和当前版本写入本任务提交说明，不把运行时数据库或 `.env.local` 纳入 Git。

**Step 2：先写失败测试。**

`tests/runtime-config.test.mjs` 至少覆盖：

```js
test("defaults to real market mode", () => {
  const config = readRuntimeConfig({});
  assert.equal(config.marketMode, "real");
});

test("rejects unknown market mode", () => {
  assert.throws(
    () => readRuntimeConfig({ MARKET_MODE: "mixed" }),
    /MARKET_MODE/
  );
});
```

同时在 `tests/server-matching.test.mjs` 增加失败断言：真实模式只有数据库中真实任务能成为候选，语料 `listing-*` 或 `tenant-*` ID 不应出现。

运行：

```bash
node --test tests/runtime-config.test.mjs tests/server-matching.test.mjs
```

预期：因为配置模块和模式分流尚不存在而失败。

**Step 3：实现最小配置边界。**

`src/server/runtime-config.mjs` 统一读取并验证：

```js
{
  marketMode: "real" | "demo",
  demoBanner: boolean,
  databasePath: string,
  uploadDirectory: string,
  aiEnabled: boolean
}
```

规则：

- 默认 `MARKET_MODE=real`。
- 只有 `demo` 模式调用 `buildMarketplace()` 注入语料。
- 页面从 `/api/health` 或 session bootstrap 得到 `marketMode`；demo 模式显示不可关闭的“演示数据”标识。
- demo 候选对象标记 `counterpartyType="fixture"`，后续案例服务直接拒绝。
- `.env.example` 只写变量名和安全示例，不写 SiliconFlow API key；真实 key 继续放 `.env.local` 或系统密钥服务。

**Step 4：通过测试并回归。**

```bash
node --test tests/runtime-config.test.mjs tests/server-matching.test.mjs
npm test
npm run check
```

预期：real 模式 seed candidate 数为 0；demo 模式现有评测不退化；全量测试通过。

**Step 5：提交。**

```bash
git add src/server/runtime-config.mjs tests/runtime-config.test.mjs .env.example server.mjs src/server/matching-service.mjs src/app.mjs package.json docs/product-architecture.md tests/server-matching.test.mjs
git commit -m "feat: separate real and demo marketplaces"
```

**完成定义：** 在未配置环境变量的全新启动中，真实用户看不到任何种子候选；显式 demo 模式仍可运行现有截图流程，且页面明确标识演示数据。

### Task 1：修复不可信输出和基础 CSP

**目标：** 在任何真实跨用户数据进入页面前，消除存储型/反射型 DOM XSS，建立统一输出编码出口。

**文件：**

- Create: `src/ui/safe-markup.mjs`
- Create: `tests/safe-markup.test.mjs`
- Create: `tests/server-security.test.mjs`
- Modify: `src/app.mjs`
- Modify: `server.mjs`
- Modify: `service-worker.js`
- Modify: `package.json`

**Step 1：列出所有不可信 sink。**

重点复核 `src/app.mjs` 中大块 `innerHTML`，特别是：

- 用户自定义区域、标签与 AI 问题。
- 房源标题、位置、站点、地址提示。
- 租客职业、个人简介和展示别名。
- 匹配原因、风险、溯源与 caveat。
- 谈判/案例事件的标题、详情和 actor。
- 举报结果和服务端错误。
- 所有进入 `data-*`、`value`、`aria-label` 的动态值。

不要只搜索现有已知行号；执行：

```bash
rg -n "innerHTML|outerHTML|insertAdjacentHTML|data-.*=|aria-label=.*\\$" src index.html
```

**Step 2：先写失败单元测试。**

`src/ui/safe-markup.mjs` 的预期接口：

```js
export function escapeText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export const escapeAttribute = escapeText;
```

测试文本、属性、单双引号、空值、中文和已经包含 `&` 的值。服务端安全测试创建恶意标题：

```text
<img src=x onerror="globalThis.__storedXss=1">
```

断言 API 保持原始 JSON 值，但 HTML 渲染处只能作为文本出现。

运行：

```bash
node --test tests/safe-markup.test.mjs tests/server-security.test.mjs
```

预期：模块不存在或响应头/边界断言失败。

**Step 3：按输出位置编码。**

- 数据库和 JSON API 保留原始业务值，不提前转义。
- 所有字符串模板 sink 在插入 HTML 时使用 `escapeText` 或 `escapeAttribute`。
- URL 参数使用 `URL`/`URLSearchParams`，不得使用 HTML encoder 代替 URL encoder。
- 事件监听继续基于稳定 ID；不要把整段用户文本塞进 `data-*`。
- 能用 DOM `textContent` 的局部更新优先用 `textContent`。

**Step 4：加入 CSP 与安全响应头。**

HTML 和静态资源响应至少包含：

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(self), geolocation=(), microphone=()
```

如果当前拍照流程需要摄像头，仅为同源保留 camera；没有功能时也应关闭。

**Step 5：补浏览器回归。**

在 Task 12 建立的 Playwright 套件前，可以先用 server 测试验证头部和编码函数；Playwright 建立后补跨账号 UI 用例：房东保存恶意标题，租客打开候选，断言 DOM 无新增 `<img>`、`globalThis.__storedXss` 未定义。

**Step 6：通过测试并提交。**

```bash
node --test tests/safe-markup.test.mjs tests/server-security.test.mjs
npm test
npm run check
git diff --check
```

```bash
git add src/ui/safe-markup.mjs tests/safe-markup.test.mjs tests/server-security.test.mjs src/app.mjs server.mjs service-worker.js package.json
git commit -m "fix: encode untrusted rental content"
```

**完成定义：** 两个独立会话之间传递的所有可编辑字符串都只能显示为文字；CSP 生效；未出现重复编码；现有视觉不因转义损坏。

### Task 2：重做会话、输入契约、频控和 AI 成本边界

**目标：** 删除 localStorage Bearer token 事实源，为真实用户测试建立可撤销的服务端会话、严格请求契约和多层成本保护。

**文件：**

- Create: `src/server/session-service.mjs`
- Create: `src/server/request-guards.mjs`
- Create: `src/server/rate-limit.mjs`
- Create: `src/server/schemas.mjs`
- Create: `tests/session-service.test.mjs`
- Create: `tests/request-guards.test.mjs`
- Create: `tests/server-rate-limit.test.mjs`
- Modify: `src/server/database.mjs`
- Modify: `server.mjs`
- Modify: `src/api-client.mjs`
- Modify: `src/ai/siliconflow-client.mjs`
- Modify: `src/server/intake-service.mjs`
- Modify: `.env.example`

**Step 1：先写会话失败测试。**

覆盖：

- session ID 使用至少 128 bit 随机值，只在哈希后存库。
- `Set-Cookie` 包含 `HttpOnly`、`SameSite=Lax`、`Path=/`；HTTPS 环境包含 `Secure`。
- session 有 `expires_at`、`last_seen_at`、`revoked_at`。
- 过期和撤销后返回 401。
- 登录态刷新不依赖 localStorage。
- 修改请求的 `Origin` 不匹配时返回 403。
- 测试环境允许显式注入时钟，避免 sleep。

本地封闭 alpha 可继续使用匿名 profile，但必须采用安全 cookie。真实试点前在相同 service 接口后接手机 OTP/OIDC；禁止使用前端生成的 owner ID 充当身份。

**Step 2：先写输入与限流失败测试。**

至少覆盖：

- 普通 JSON 文本接口上限 64 KB。
- 文本字段有逐字段长度、Unicode 控制字符和数组数量限制。
- AI intake 每 IP、session、profile 分钟与日级配额。
- 超额返回 429 和 `Retry-After`，且 provider stub 调用次数不增加。
- 模型超时与坏 JSON 映射成稳定错误码，不回传 provider 原始错误。
- 请求完成或连接中断后，内存中的 rate-limit reservation 正确结算。

运行：

```bash
node --test tests/session-service.test.mjs tests/request-guards.test.mjs tests/server-rate-limit.test.mjs
```

预期：测试失败。

**Step 3：实现 schema 与统一错误。**

`src/server/schemas.mjs` 可以先使用无依赖手写解析器；如果分支复杂到难以审查，再引入 Zod。每个 schema 返回规范化值或：

```js
{
  status: 422,
  code: "INVALID_FIELD",
  fieldErrors: {
    "budget.hardMax": "请输入 500–50000 之间的整数"
  }
}
```

禁止把 `error.stack`、provider body、数据库 SQL 或本机路径返回浏览器。

**Step 4：实现分层限流。**

单进程 SQLite 阶段可使用内存令牌桶，但必须把接口封装在 `rate-limit.mjs`，便于生产换 Redis。建议初始配置：

| 维度 | AI intake | 普通写接口 | 会话创建 |
| :---: | :---: | :---: | :---: |
| 单 IP / 分钟 | 10 | 60 | 10 |
| 单 session / 分钟 | 6 | 30 | 不适用 |
| 单 profile / 天 | 100 | 1000 | 不适用 |

数值通过环境变量配置并设硬上限；测试使用更小值。AI 调用还需要全局每日预算熔断，触发时返回 `AI_DEGRADED` 并走规则解析。

**Step 5：收紧模型客户端。**

- 默认超时 20 秒。
- 只对网络错误、429 和可重试 5xx 重试一次，并使用抖动退避。
- schema 失败只允许一次 JSON 修复提示，不重放整个多轮对话三次。
- `calls` 只保留最近必要元数据，不无限增长。
- 日志记录模型、prompt version、延迟、token 和错误码，默认不记录完整输入。

**Step 6：切换 API 客户端。**

- `fetch` 使用 `credentials: "same-origin"`。
- 删除 session token 的 localStorage 读写。
- 统一解析错误码和 `fieldErrors`。
- 所有写操作发同源请求；Task 5 起增加 `Idempotency-Key`。

**Step 7：回归和提交。**

```bash
node --test tests/session-service.test.mjs tests/request-guards.test.mjs tests/server-rate-limit.test.mjs
node --test tests/server-api.test.mjs
npm test
npm run check
```

```bash
git add src/server/session-service.mjs src/server/request-guards.mjs src/server/rate-limit.mjs src/server/schemas.mjs tests/session-service.test.mjs tests/request-guards.test.mjs tests/server-rate-limit.test.mjs src/server/database.mjs server.mjs src/api-client.mjs src/ai/siliconflow-client.mjs src/server/intake-service.mjs .env.example
git commit -m "feat: secure sessions and ai request budgets"
```

**完成定义：** 页面脚本无法读取 session secret；撤销与过期可测试；超限请求不消耗模型调用；错误响应稳定且不暴露内部信息。

### Task 3：让用户确认字段成为唯一匹配真值

**目标：** 修复用户修改预算、通勤、租期、日期、合租和设施后仍可能使用旧 AI 值的问题，同时修复地点语义混淆和多问题展示。

**文件：**

- Create: `src/mandate-builder.mjs`
- Create: `src/field-state.mjs`
- Create: `tests/mandate-builder.test.mjs`
- Create: `tests/field-state.test.mjs`
- Modify: `src/app.mjs`
- Modify: `src/demand-parser.mjs`
- Modify: `src/supply-parser.mjs`
- Modify: `src/server/intake-service.mjs`
- Modify: `server.mjs`
- Modify: `tests/conversational-intake.test.mjs`
- Modify: `tests/server-api.test.mjs`

**Step 1：写用户修改优先的失败测试。**

构造 AI 预填：预算 3500–4000、通勤 30 分钟、租期 12 个月、接受合租、要求厨房。用户修改为：

- 预算 3000–3300。
- 通勤 25 分钟。
- 租期 6 个月。
- 新入住日期。
- 整租。
- 不要求厨房。

断言以下四处完全一致：

1. 客户端确认页。
2. `POST /api/tasks` 请求体。
3. 数据库 `task_fields` 或兼容 payload。
4. `evaluateTaskPair()` 的输入。

当前实现预期至少在部分字段上失败。

**Step 2：写地点语义失败测试。**

输入：

```text
静安寺附近找房，通勤陆家嘴 25 分钟以内，九月初入住。
```

期望：

```js
{
  targetLocations: ["静安寺"],
  commuteDestinations: ["陆家嘴"],
  city: "上海"
}
```

系统不得再询问“请确认租房城市”，也不得把陆家嘴加入可居住区域。再覆盖“住在 A、去 B 上班”“A 或 B 都可住”“离 C 地铁站步行十分钟”等语法。

**Step 3：拆出纯函数 builder。**

```js
buildMandateFromConfirmedAnswers({
  answers,
  selectedLocations,
  city,
  baseMandate
})
```

规则：

- `parsedDemand` 只在 `seedAnswersFromParsed()` 首次预填时使用一次。
- builder 不得读取 `parsedDemand.fields`。
- 找房发布按钮、预览、客户端校验和 API 请求共享同一个 builder 结果。
- `leaseMonths="any"` 可映射为宽匹配区间，但必须显式保留 `leaseFlexible=true`，不得偷偷变成 12 个月承诺。
- 供应草稿不得继承面积 15、楼层 9/18 或租期 12 等演示值；没有输入就是 unknown。

**Step 4：实现字段状态合并。**

`src/field-state.mjs` 提供：

```js
applyFieldProposal(current, proposal)
confirmField(current, userValue)
resolveFieldValue(field)
diffFieldVersions(before, after)
```

`applyFieldProposal` 遇到已经 `user_confirmed` 的字段时只能生成 conflict suggestion，不能覆盖当前值。所有用户编辑增加 field version 和 task `input_version`。

**Step 5：展示最多三个问题。**

- intake 响应保留结构化 `questions[]`。
- UI 同时显示最多三个，不再只取第一个。
- 每个问题与 `fieldKey` 绑定，回答后只更新对应字段。
- 已确认字段不重复提问。

**Step 6：服务端重新验证供给角色和收费风险。**

恶意客户端直接提交“中介代发，服务费 500 元”时，服务端必须独立执行确定性风险检查并返回 422，不能依赖前端拦截或 AI 提示。

**Step 7：运行和提交。**

```bash
node --test tests/mandate-builder.test.mjs tests/field-state.test.mjs tests/conversational-intake.test.mjs tests/server-api.test.mjs
npm test
npm run check
```

```bash
git add src/mandate-builder.mjs src/field-state.mjs tests/mandate-builder.test.mjs tests/field-state.test.mjs src/app.mjs src/demand-parser.mjs src/supply-parser.mjs src/server/intake-service.mjs server.mjs tests/conversational-intake.test.mjs tests/server-api.test.mjs
git commit -m "fix: make confirmed fields authoritative"
```

**完成定义：** 对上述测试输入，用户确认的 25 分钟在页面、API、数据库和匹配器中均保持 25；地点角色正确；未知供给字段没有演示默认值。

### Task 4：修复实时时钟与核验真实性

**目标：** 删除固定模拟日期对生产逻辑的影响；把“已上传材料”和“已经核验”彻底拆开。

**文件：**

- Create: `src/clock.mjs`
- Create: `src/server/verification-service.mjs`
- Create: `tests/clock.test.mjs`
- Create: `tests/verification-service.test.mjs`
- Modify: `src/fixtures.mjs`
- Modify: `src/simulation-engine.mjs`
- Modify: `server.mjs`
- Modify: `src/app.mjs`
- Modify: `tests/simulation-engine.test.mjs`
- Modify: `tests/server-api.test.mjs`

**Step 1：写日期失败测试。**

给服务注入 `now=2026-08-30T00:00:00+08:00`，创建 `availableFrom=2026-08-25` 的房源，期望根据产品规则被拒绝或标记为已可入住，而不是依赖 `SIMULATION_DATE=2026-08-23` 认为是未来日期。

测试还应覆盖：

- 上海时区的自然日边界。
- ISO 日期与时间戳不得混用比较。
- 任务到期时间由服务端时钟生成。
- 测试通过注入 fake clock，不修改全局 Date 或依赖 sleep。

**Step 2：写核验状态失败测试。**

上传四类文件后期望：

```js
{
  submissionStatus: "submitted",
  verificationStatus: "not_reviewed",
  displayLabel: "已上传，待审核"
}
```

不得因为 `evidenceRefs.length > 0` 就产生 `verified=true`、绿色核验徽章或匹配加分。只有测试中的显式人工审核动作才能产生 `manual_review` 记录。

**Step 3：实现可注入时钟。**

```js
export function createClock({ now = () => new Date() } = {}) {
  return {
    now,
    nowIso: () => now().toISOString(),
    todayInShanghai: () => /* timezone-safe YYYY-MM-DD */
  };
}
```

- `SIMULATION_DATE` 只保留在 fixtures/eval 显式传参中。
- server、task lifecycle、matching、verification 全部依赖注入 clock。
- 业务代码禁止直接读取 `new Date()`，由 lint-like `rg` 检查允许列表。

**Step 4：拆分 submission 与 verification。**

- 上传成功只创建 media/submission 记录。
- `verification-service` 接收明确 reviewer、method、result、reviewedAt。
- 用户不能通过普通任务接口写 verification source/status。
- 匹配器只有在真正需要且状态明确时使用核验事实；未审核不能加“已核验”权重。
- UI 采用第 12 节真实性字典。

**Step 5：运行和提交。**

```bash
node --test tests/clock.test.mjs tests/verification-service.test.mjs tests/simulation-engine.test.mjs tests/server-api.test.mjs
rg -n "SIMULATION_DATE|new Date\\(" src server.mjs
npm test
npm run check
```

`rg` 结果必须逐项审查，只允许 clock、fixtures 和测试构造器中的预期使用。

```bash
git add src/clock.mjs src/server/verification-service.mjs tests/clock.test.mjs tests/verification-service.test.mjs src/fixtures.mjs src/simulation-engine.mjs server.mjs src/app.mjs tests/simulation-engine.test.mjs tests/server-api.test.mjs
git commit -m "fix: separate uploads from verification truth"
```

**完成定义：** 所有业务日期依赖服务端实时或注入时钟；上传材料只显示待审核；没有任何布尔 evidence shortcut 能产生“已核验”。

### Task 5：建立版本化迁移和 v0.7 领域表

**目标：** 把 `src/server/database.mjs` 中的内联建表升级为可重复、可回滚验证的版本化迁移，为任务版本、匹配案例、条款、确认、授权和事件提供数据库约束。

**文件：**

- Create: `src/server/migrations.mjs`
- Create: `src/server/migrations/001-baseline.sql`
- Create: `src/server/migrations/002-task-fields-and-outbox.sql`
- Create: `src/server/migrations/003-bilateral-match-cases.sql`
- Create: `tests/database-migrations.test.mjs`
- Modify: `src/server/database.mjs`
- Modify: `package.json`
- Modify: `docs/product-architecture.md`

**Step 1：先做旧库 fixture。**

测试不能只创建空库。用现有 `database.mjs` 的旧结构在临时目录生成 v0.6 fixture，写入：

- 一个 renter task。
- 一个 supply task。
- 各自候选与 audit events。
- 包含中文、日期和 evidence refs 的 payload。

迁移后断言原任务仍可读取、状态不变、候选和事件未丢失。

**Step 2：写迁移失败测试。**

至少覆盖：

1. 全新数据库从 user_version 0 迁移到最新版本。
2. v0.6 有数据数据库安全升级。
3. 重复打开数据库不重复执行迁移。
4. 中途故意失败的迁移整体回滚，`user_version` 不前进。
5. `PRAGMA foreign_keys=ON`。
6. `PRAGMA journal_mode=WAL`。
7. `PRAGMA busy_timeout=5000`。
8. 数据目录权限 0700、SQLite 文件权限 0600。
9. `match_cases(renter_task_id,supply_task_id)` 唯一约束生效。
10. open clarification、confirmation 和 outbox dedupe 唯一约束生效。

运行：

```bash
node --test tests/database-migrations.test.mjs
```

预期：迁移模块不存在而失败。

**Step 3：实现 migration runner。**

`migrations.mjs` 只接受显式有序列表：

```js
const migrations = [
  { version: 1, name: "baseline", sqlFile: "001-baseline.sql" },
  { version: 2, name: "task-fields-and-outbox", sqlFile: "002-task-fields-and-outbox.sql" },
  { version: 3, name: "bilateral-match-cases", sqlFile: "003-bilateral-match-cases.sql" }
];
```

规则：

- 读取到未知更高 user_version 时拒绝启动，防止旧程序破坏新库。
- 每个版本使用一个事务，执行成功后设置 user_version。
- SQL 文件随仓库提交，测试检查版本连续且文件存在。
- 不允许在启动时无版本地 `ALTER TABLE`。
- 数据库公开方法使用 prepared statements；JSON 写入前有 schema，读取后有 parse error handling。

**Step 4：建立 repository 边界。**

本任务不实现业务状态机，但 `database.mjs` 应只负责连接、事务、迁移与通用生命周期。后续新增：

```text
task-repository.mjs
match-case-repository.mjs
media-repository.mjs
outbox-repository.mjs
```

不要继续把所有 SQL 堆进 `database.mjs`。

**Step 5：运行、备份演练和提交。**

```bash
node --test tests/database-migrations.test.mjs
npm test
npm run check
git diff --check
```

使用临时数据库做一次人工演练：复制 v0.6 fixture，运行新 server，确认迁移前备份文件存在、失败时原文件仍可恢复。正式数据目录不得在自动测试中使用。

```bash
git add src/server/migrations.mjs src/server/migrations/001-baseline.sql src/server/migrations/002-task-fields-and-outbox.sql src/server/migrations/003-bilateral-match-cases.sql tests/database-migrations.test.mjs src/server/database.mjs package.json docs/product-architecture.md
git commit -m "feat: add versioned sqlite migrations"
```

**完成定义：** 新库和有数据旧库都能确定地进入同一 schema 版本；失败不留下半迁移状态；文件权限达标；所有关键唯一性不仅依赖应用代码，也由数据库约束。

### Task 6：实现对称任务对评估和权威 match case

**目标：** 让两个不同用户的真实供需任务形成唯一、可审计、服务端权威的匹配案例；种子候选、同 owner 任务和单向脏数据不能形成案例。

**文件：**

- Create: `src/server/task-repository.mjs`
- Create: `src/server/match-case-repository.mjs`
- Create: `src/server/pair-evaluator.mjs`
- Create: `src/server/match-case-service.mjs`
- Create: `tests/pair-evaluator.test.mjs`
- Create: `tests/match-case-repository.test.mjs`
- Create: `tests/match-case-service.test.mjs`
- Modify: `src/server/matching-service.mjs`
- Modify: `src/simulation-engine.mjs`
- Modify: `tests/server-matching.test.mjs`

**Step 1：写纯 pair evaluator 的失败测试。**

矩阵至少包含：

- 城市不同：硬冲突。
- 可住区域与通勤目的地分离，路线符合上限：通过。
- 租客 hard max 小于房东 min authorized rent：硬冲突，但公共解释不暴露双方底价。
- 租期无交集：硬冲突。
- 入住窗口无交集：硬冲突。
- 合租/整租冲突：硬冲突。
- 厨房或洗衣机为必须且房源未知：blocking unknown，不猜 true。
- 水电费用未知可能使总预算超限：blocking unknown。
- 只是不满足采光偏好：eligible，但降低 score。
- 相同输入版本与 `evaluatedAt` 得到相同规范化输出。

不要在纯 evaluator 中读取数据库、当前时间或调用 Qwen。

**Step 2：写案例 repository 失败测试。**

覆盖：

- 创建案例时绑定 renter/supply task 和各自 input version。
- 相同任务对重复或并发创建只得到一行。
- 两个任务 owner 相同被拒绝。
- 任一任务不是 active 被拒绝。
- 非参与 owner 读取返回 null，由 API 映射 404。
- `public_terms_json` 和事件不含私密字段。
- repository 写操作可在外部 transaction 中组合。

**Step 3：写 service 失败测试。**

按真实顺序覆盖：

1. 只有租客真实任务，没有房源：无案例。
2. 加入硬条件冲突房源：无可确认案例。
3. 加入无冲突但有未知项房源：一个 `clarifying` 案例。
4. 未知项解决：同一案例进入 `terms_ready`，不新建重复案例。
5. 重复匹配作业：案例数和 `case_created` 事件数不增加。
6. demo fixture：不生成案例。
7. 同 owner 的 renter/supply 任务：不生成案例。
8. 任一任务暂停、关闭、过期：案例 invalidated/expired。
9. 任务 input version 变化：旧评估标记 stale 并重算。

**Step 4：实现私密/公开双投影。**

pair evaluator 返回：

- `privateDiagnostics`：仅服务端调试和所有者自己的必要提示可用。
- `publicReasons`：可进入双方案例。
- `renterCandidateProjection`：租客视角。
- `supplyCandidateProjection`：房东视角。
- `blockingUnknowns`：明确 target party。

所有投影通过 allowlist 构造，禁止用对象展开后删除敏感字段：

```js
function toPublicTerms(input) {
  return {
    rent: input.proposedPublicRent,
    leaseMonths: input.leaseMonths,
    moveInWindow: input.moveInWindow,
    feeSummary: input.publicFeeSummary,
    approximateLocation: input.approximateLocation
  };
}
```

**Step 5：改造 matching service。**

短期可沿用现有任务触发入口，但一次受影响集合必须按以下顺序提交：

1. 获取固定 task input version。
2. 查询相反类型真实 active 任务。
3. 每个任务对只评估一次。
4. 事务中写双方 candidate projections 和案例状态。
5. 全部成功后更新 `last_matched_at` 与 candidate version。

禁止在写完一方候选、另一方尚未写完时做案例撤销判断。

**Step 6：运行和提交。**

```bash
node --test tests/pair-evaluator.test.mjs tests/match-case-repository.test.mjs tests/match-case-service.test.mjs tests/server-matching.test.mjs
npm test
npm run eval:marketplace
npm run check
```

评测新增 guardrail：private leak count 0、hard conflict promoted count 0、demo-to-case count 0。

```bash
git add src/server/task-repository.mjs src/server/match-case-repository.mjs src/server/pair-evaluator.mjs src/server/match-case-service.mjs tests/pair-evaluator.test.mjs tests/match-case-repository.test.mjs tests/match-case-service.test.mjs src/server/matching-service.mjs src/simulation-engine.mjs tests/server-matching.test.mjs
git commit -m "feat: create authoritative bilateral match cases"
```

**完成定义：** 两个真实账号的匹配任务只产生一个案例；刷新和重复调度不重复；seed 不产生案例；任务失效后案例不能继续确认。

### Task 7：实现 AI 定向澄清闭环

**目标：** 当任务对没有硬冲突但存在阻断未知项时，只向能回答的一方提出少量、高价值、不重复的问题，并把回答写回字段版本后自动重算。

**文件：**

- Create: `src/server/clarification-service.mjs`
- Create: `src/ai/clarification-prompt.mjs`
- Create: `src/ai/clarification-schema.mjs`
- Create: `tests/clarification-service.test.mjs`
- Create: `tests/ai-clarification-contract.test.mjs`
- Modify: `src/ai/prompts.mjs`
- Modify: `src/ai/siliconflow-client.mjs`
- Modify: `src/server/match-case-service.mjs`
- Modify: `server.mjs`
- Modify: `src/api-client.mjs`
- Modify: `src/app.mjs`

**Step 1：写问题选择器失败测试。**

输入包含五个未知项时，断言每轮只返回三个，并按以下顺序：合法性/安全、硬条件、价格/租期/费用、高沟通成本事实、软偏好。测试还需覆盖：

- 同一 open field 不重复建问题。
- 已回答问题不重复问。
- 用户已确认字段不被 AI 重问。
- 问题指向正确 party。
- 问题文本不泄露对方底价、预算或原始输入。
- 模型不可用时，用模板问题降级，case 仍可继续。

**Step 2：写回答处理失败测试。**

`POST /api/matches/:id/clarifications/:clarificationId/answers`：

- 非目标方返回 404。
- 已关闭问题重复提交相同 answer 幂等返回 200。
- 同一 ID 不同 answer 返回 409。
- answer 先经过 schema 和确定性范围校验。
- 成功写入 `counterparty_answer` 字段、新 field version 和 task input version。
- 在同一事务写 `clarification.answered` 与 outbox event。
- 重算后可能保持 clarifying、进入 terms_ready 或变为硬冲突 invalidated。

**Step 3：实现 Qwen 提示契约。**

提示只接收必要的公开上下文、unknown key、允许答案 schema 和禁泄露规则，不发送另一方私密底价。模型输出：

```js
{
  question: "水电燃气费用是包含在月租中，还是按账单另付？",
  fieldKey: "fees.utilitiesPolicy",
  expectedAnswerType: "enum",
  options: ["included", "actual_bill", "fixed_extra", "unknown"],
  reasonCode: "TOTAL_COST_BLOCKING_UNKNOWN"
}
```

服务端检查 fieldKey 和 expected type 必须与规则引擎要求一致；模型不能自行添加新的敏感字段。

**Step 4：实现 UI。**

- 案例详情中展示最多三个本人待回答问题。
- 单选、数值、日期、短文本分别使用合适控件。
- 提交后显示“正在重新匹配”，直到服务端事件完成。
- 对方待回答的问题只显示数量和不泄密的类别，不展示对方未公开答案。
- AI 降级时显示“已切换规则问题”，不阻塞回答。

**Step 5：运行真实 Qwen 契约冒烟。**

自动测试默认使用 stub，避免 CI 花费。显式环境下执行：

```bash
npm run eval:ai
```

新增 case 至少包括：静安寺/陆家嘴语义、费用未知、租期冲突、用户修正值保护。评测报告不得包含 API key 或完整 session cookie。

**Step 6：回归和提交。**

```bash
node --test tests/clarification-service.test.mjs tests/ai-clarification-contract.test.mjs
npm test
npm run check
```

```bash
git add src/server/clarification-service.mjs src/ai/clarification-prompt.mjs src/ai/clarification-schema.mjs tests/clarification-service.test.mjs tests/ai-clarification-contract.test.mjs src/ai/prompts.mjs src/ai/siliconflow-client.mjs src/server/match-case-service.mjs server.mjs src/api-client.mjs src/app.mjs
git commit -m "feat: resolve blocking match unknowns"
```

**完成定义：** 有未知项时没有假通过；问题少而准；回答写入可审计字段版本；回答后自动重算；模型失败有诚实降级路径。

### Task 8：建立公开条款版本和双方同版确认

**目标：** 让双方确认的是同一份不可歧义、可哈希、可失效的公开条款，而不是各自页面上的一个本地按钮状态。

**文件：**

- Create: `src/server/terms-service.mjs`
- Create: `src/server/confirmation-service.mjs`
- Create: `tests/terms-service.test.mjs`
- Create: `tests/confirmation-service.test.mjs`
- Create: `tests/server-match-case-api.test.mjs`
- Modify: `src/server/match-case-repository.mjs`
- Modify: `src/server/match-case-service.mjs`
- Modify: `server.mjs`
- Modify: `src/api-client.mjs`
- Modify: `src/app.mjs`
- Modify: `src/app.css`

**Step 1：写规范化与哈希失败测试。**

`terms-service` 必须：

- 只允许 allowlist 公共字段。
- 对 object key 排序、金额转整数分或明确整数元、日期使用 ISO、数组去重排序。
- 同语义不同 key 顺序得到相同 hash。
- 任一公开条款变化得到不同 hash。
- 私密字段输入即抛出开发期错误，不能静默删除后继续。
- 相同 case + hash 复用版本；新 hash 创建 `version+1`。

```js
const canonicalJson = canonicalizePublicTerms(publicTerms);
const termsHash = `sha256:${createHash("sha256")
  .update(canonicalJson)
  .digest("hex")}`;
```

**Step 2：写确认状态机失败测试。**

至少覆盖：

1. renter 确认当前版本，case 仍是 awaiting confirmations。
2. supply 确认相同 version/hash，状态变 mutually confirmed。
3. stale version/hash 返回 409。
4. 相同确认重放不增加版本、不重复写事件。
5. 任一方 decline 后不能继续确认该版本。
6. 条款变化自动设置旧 confirmation `revoked_at`。
7. 任务 input version 变化也撤销确认。
8. 第三方 GET/POST 返回 404。
9. confirmation payload 与事件中无联系人和私密价格。

**Step 3：实现 API。**

```text
GET  /api/tasks/:taskId/matches
GET  /api/matches/:matchCaseId
POST /api/matches/:matchCaseId/confirm
POST /api/matches/:matchCaseId/decline
```

案例响应按当前会话投影：

```js
{
  id,
  status,
  myParty,
  myDecision,
  otherDecision,
  currentTerms: {
    version,
    hash,
    publicTerms,
    nonBlockingUnknowns
  },
  contactUnlocked: false,
  updatedAt
}
```

`otherDecision` 只返回 `pending/confirmed/declined`，不返回对方内部时间、设备或身份信息。

**Step 4：实现前端状态。**

删除 `contactUnlocked=true`、固定演示联系人和任何本地“对方已确认”定时器。详情页显示：

- `待你确认`
- `你已确认，等待对方`
- `对方已确认，等待你`
- `双方已确认`
- `条款已变化，需要重新确认`
- `匹配已失效`

确认按钮上方展示条款版本和最后更新时间。版本变化时显示字段差异，焦点移到变更摘要，不能自动替用户重新确认。

**Step 5：运行和提交。**

```bash
node --test tests/terms-service.test.mjs tests/confirmation-service.test.mjs tests/server-match-case-api.test.mjs
npm test
npm run check
rg -n "zhunaer_demo|contactUnlocked *= *true" src
```

最后一条预期无结果。

```bash
git add src/server/terms-service.mjs src/server/confirmation-service.mjs tests/terms-service.test.mjs tests/confirmation-service.test.mjs tests/server-match-case-api.test.mjs src/server/match-case-repository.mjs src/server/match-case-service.mjs server.mjs src/api-client.mjs src/app.mjs src/app.css
git commit -m "feat: require same-version bilateral consent"
```

**完成定义：** 刷新页面后双方状态完全从服务端恢复；任何条款变化都需要重新确认；两个会话只有确认相同 hash 才进入 mutually confirmed。

### Task 9：实现服务端联系人门禁与授权撤销

**目标：** 双方确认只是授权前提，真正的联系方式读取必须经过服务端 `contact_grant`；任务或条款失效后立即重新锁定。

**文件：**

- Create: `src/server/contact-service.mjs`
- Create: `src/server/contact-grant-service.mjs`
- Create: `tests/contact-service.test.mjs`
- Create: `tests/contact-grant-service.test.mjs`
- Modify: `tests/server-match-case-api.test.mjs`
- Modify: `src/server/match-case-repository.mjs`
- Modify: `src/server/confirmation-service.mjs`
- Modify: `server.mjs`
- Modify: `src/api-client.mjs`
- Modify: `src/app.mjs`
- Modify: `.env.example`

**Step 1：确定本地与生产加密边界。**

v0.7 本地受控 alpha 至少使用应用层加密：

- `CONTACT_ENCRYPTION_KEY` 从环境/密钥服务读取，长度和格式启动时校验。
- AES-256-GCM，每条联系人使用随机 nonce，保存 version、nonce、ciphertext、auth tag。
- API 列表只返回 `masked_value`。
- key 不写 README、fixture、测试快照或 Git。
- 测试使用临时 key；密钥缺失时 real mode 拒绝启动，demo mode 可使用固定假联系人但仍不生成案例。

生产环境应迁移到 KMS 包络加密或独立 secrets 服务，不能长期依赖单个环境变量。

**Step 2：写联系人服务失败测试。**

- 支持 phone、wechat、email 的规范化和长度限制。
- 列表/任务/案例接口只出现 masked，不出现原值。
- 密文相同明文两次保存不同。
- 错 key 或篡改 auth tag 解密失败并记录安全错误码。
- 普通日志、事件和异常不包含原值。

**Step 3：写授权失败测试。**

使用 renter、supply、outsider 三个会话：

1. 没有联系人时不能确认，返回 422 `CONTACT_REQUIRED`。
2. 单方确认时双方 GET contact 均为 403 `CONTACT_LOCKED`。
3. 双方同版确认后自动创建一个 grant。
4. renter 只能得到 supply 联系方式，反之亦然。
5. outsider 返回 404。
6. 重复读取不重复建 grant，只写不含原值的 `contact.viewed`。
7. 条款更新、任务暂停、关闭、过期、case invalidated 后 grant revoked。
8. 撤销后即使前端持有旧 case JSON，GET contact 仍返回 403。
9. 一个 case 的 grant 不能读取另一个 case 联系人。

**Step 4：实现授权事务。**

第二方确认的同一事务中：

1. 锁定 case/当前 terms。
2. 再次检查两方 active、版本、hash、联系人存在。
3. 写第二方 confirmation。
4. 设置 case mutually confirmed。
5. 写 contact grant 与 `contact.granted`。

如果任一步失败，全部回滚。读取联系人时再次检查 grant、case、terms 和任务，不只信 `grant.revoked_at IS NULL`。

**Step 5：前端只通过 API 解锁。**

- 双方确认后仍先显示“点击查看联系方式”。
- 点击时调用 contact API，并在错误时保留锁定 UI。
- 联系方式不写 localStorage、不拼进分享文本、不写 history state。
- 页面离开或 grant 失效后从内存清除原值。

**Step 6：运行和提交。**

```bash
node --test tests/contact-service.test.mjs tests/contact-grant-service.test.mjs tests/server-match-case-api.test.mjs
npm test
npm run check
rg -n "zhunaer_demo|contact_value|CONTACT_ENCRYPTION_KEY" README.md docs src tests .env.example
```

逐项审查 `rg`：测试/schema 中允许出现字段名，真实 key 和固定联系人值必须为 0。

```bash
git add src/server/contact-service.mjs src/server/contact-grant-service.mjs tests/contact-service.test.mjs tests/contact-grant-service.test.mjs tests/server-match-case-api.test.mjs src/server/match-case-repository.mjs src/server/confirmation-service.mjs server.mjs src/api-client.mjs src/app.mjs .env.example
git commit -m "feat: gate contact exchange on mutual consent"
```

**完成定义：** 单方确认、第三方、过期授权和旧条款都无法读取联系方式；只有双方同版确认后的有效案例可以按当前会话获取对手方联系人。

### Task 10：建立真实公开房源图片管线

**目标：** 分离公开房源照片和私密核验材料；拒绝 MIME 伪装，移除 EXIF/GPS，结果页只展示经过授权和处理的真实图片。

**文件：**

- Create: `src/server/media-repository.mjs`
- Create: `src/server/media-service.mjs`
- Create: `tests/media-service.test.mjs`
- Create: `tests/server-media-api.test.mjs`
- Modify: `server.mjs`
- Modify: `src/api-client.mjs`
- Modify: `src/marketplace-corpus.mjs`
- Modify: `src/app.mjs`
- Modify: `src/app.css`
- Modify: `service-worker.js`
- Modify: `tests/marketplace-corpus.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Step 1：引入并锁定图片解码依赖。**

```bash
npm install sharp
```

提交 lockfile；CI 与目标 macOS/Linux 环境都运行一次安装和图片测试。不要用 MIME 名称或文件扩展名代替真实解码。

**Step 2：写恶意文件失败测试。**

覆盖：

- `data:image/jpeg;base64,` 后跟纯文本或 SVG 脚本：拒绝。
- 文件头与声明 MIME 不一致：拒绝。
- 解码失败、超大像素、动画炸弹、超过路由大小限制：拒绝。
- JPEG 含 EXIF GPS：处理后 derivative 不含 metadata。
- 同一内容哈希重复上传：按产品规则复用 blob 或明确拒绝重复，不重复占空间。
- 路径 traversal 文件名：服务端忽略用户文件名并生成随机 ID。
- `private_evidence` 不能由公开 media endpoint 读取。
- 删除任务后公开 derivative 不再可访问，并进入清理队列。

测试 fixture 应放在 `tests/fixtures/media/`，只包含最小、安全、自有测试图。

**Step 3：实现隔离目录与图像净化。**

目录语义：

```text
data/uploads/private-originals/   # 0700，不由静态服务器暴露
data/uploads/public-derivatives/ # 由受控 ID 路由读取，不直接目录映射
```

流程：

1. 路由先执行字节上限。
2. base64 严格解码；后续可迁移 multipart。
3. `sharp` 读取 metadata，拒绝不支持格式与超大像素。
4. 自动旋转，限制最长边，例如 2000 px。
5. 重新编码为 JPEG/WebP，去除全部 metadata。
6. 计算原始和 derivative SHA-256。
7. 原始文件进入私密目录；公开路由只读取 derivative。
8. 只有 `purpose=public_listing` 且 `public_consent_at` 存在才可出现在候选。

**Step 4：修复内置与用户图片 UI。**

为 `marketplace-corpus.mjs` 的内置演示房源增加：

```js
photos: [{
  src: "./assets/room-sunlit.jpg",
  alt: "朝南卧室实拍，窗边有书桌和自然采光",
  width: 1200,
  height: 800
}]
```

- 卡片和详情用 `<picture>/<img>`，不要再用 `.room-one` 等 CSS 背景类表达内容图。
- 首个首屏候选可 `fetchpriority="high"`；其他 `loading="lazy"`。
- 用户房源没有公开图时显示中性占位和“暂无公开实拍”。
- 私密 evidence ID、路径和缩略图不进入 candidate API。

**Step 5：修复 service worker。**

- 更新 APP_SHELL 与 cache version。
- 只缓存 allowlist 静态资源和 `response.ok` 响应。
- 不缓存联系人、任务、案例、上传、session 或任意 `/api/` 私密响应。
- 对图片失败使用中性本地占位，不使用另一套房源实拍。

**Step 6：运行和提交。**

```bash
node --test tests/media-service.test.mjs tests/server-media-api.test.mjs tests/marketplace-corpus.test.mjs
npm test
npm run check
```

人工打开处理后的测试图，确认方向、色彩和尺寸正常；用 metadata 检查工具确认 GPS 已移除。

```bash
git add src/server/media-repository.mjs src/server/media-service.mjs tests/media-service.test.mjs tests/server-media-api.test.mjs server.mjs src/api-client.mjs src/marketplace-corpus.mjs src/app.mjs src/app.css service-worker.js tests/marketplace-corpus.test.mjs package.json package-lock.json tests/fixtures/media
git commit -m "feat: add privacy-safe listing media"
```

**完成定义：** 文本伪图片被拒绝；公开候选只显示用户明确授权的净化 derivative；私密核验材料没有任何公开读取路径。

### Task 11：用 Transactional Outbox 驱动增量持续匹配

**目标：** 把每 10 秒全量扫描改为“业务事务写事件—单进程幂等 Worker 增量处理—scheduler 补偿”的可靠模型，并保持未来替换队列的边界。

**文件：**

- Create: `src/server/outbox-repository.mjs`
- Create: `src/server/matching-worker.mjs`
- Create: `tests/outbox-repository.test.mjs`
- Create: `tests/matching-worker.test.mjs`
- Modify: `src/server/task-repository.mjs`
- Modify: `src/server/matching-service.mjs`
- Modify: `src/server/database.mjs`
- Modify: `server.mjs`
- Modify: `tests/server-matching.test.mjs`

**Step 1：写原子性失败测试。**

- 创建任务与 `task.match_requested` event 在同一事务；故意让 outbox insert 失败时任务也回滚。
- 更新任务 input version 与新 dedupe event 同一事务。
- 暂停、关闭、过期写相应 invalidate event。
- 相同 `taskId + inputVersion` 只能有一个 event。
- API 首次响应丢失后，使用相同 clientRequestId 重放不会多写 event。

**Step 2：写领取与重试失败测试。**

- Worker 使用短事务领取一个或一批 event。
- 两个 worker 实例竞争时，同一 event 只被一个领取。
- 处理成功标记 completed。
- 可重试失败增加 attempts 并设置 `available_at`。
- 进程崩溃留下的 processing event 超过 lock TTL 后可被重新领取。
- 达到最大次数进入 failed 并产生告警事件，不无限热循环。
- fake clock 驱动 backoff，无 sleep。

SQLite 单进程阶段可使用 `BEGIN IMMEDIATE` 与 `locked_at` 实现租约；不要声称它已经支持多机高吞吐。生产迁移时 repository 接口后换队列。

**Step 3：实现受影响集合查询。**

不是每次扫描全市场。先按以下粗过滤缩小集合：

- 相反 kind。
- 同 city。
- active 且未过期。
- 粗粒度位置存在潜在交集，或 commute destination 可计算。
- 租金区间可能相交。

粗过滤只能排除确定不可能项，不能因为未知而错误排除；最终仍由 pair evaluator 判断。

**Step 4：定义 job 幂等 key。**

```text
pair:<renterTaskId>:<renterInputVersion>:<supplyTaskId>:<supplyInputVersion>:<evaluatorVersion>
```

如果在处理期间任一任务版本变化，丢弃旧结果并让新 event 处理；不能把旧版本结果覆盖到新任务。

**Step 5：把 scheduler 降为补偿器。**

定时任务只做：

- 重新领取超时 processing event。
- 处理到期任务。
- 发现长期未匹配但无 pending event 的异常任务并补 event。
- 清理过期 grant、session 和 media tombstone。

`/api/health` 应分别报告 DB、worker 最近成功时间、pending/failed 数和 AI 状态；只要 HTTP 进程活着不能一概返回 healthy。

**Step 6：性能测试。**

构造 200 renter × 50 supply 的临时库，修改一个任务后断言只评估受影响集合，不重新跑 10,000 对。记录：

- event enqueue 延迟。
- time-to-first-match。
- pair evaluation 数。
- job P50/P95。
- stale result discard 数。

**Step 7：运行和提交。**

```bash
node --test tests/outbox-repository.test.mjs tests/matching-worker.test.mjs tests/server-matching.test.mjs
npm test
npm run check
```

```bash
git add src/server/outbox-repository.mjs src/server/matching-worker.mjs tests/outbox-repository.test.mjs tests/matching-worker.test.mjs src/server/task-repository.mjs src/server/matching-service.mjs src/server/database.mjs server.mjs tests/server-matching.test.mjs
git commit -m "feat: drive matching with transactional outbox"
```

**完成定义：** 创建/修改任务不会出现“任务保存了但匹配事件丢了”；重复和崩溃恢复不产生重复案例；调度器不再全量重算全部 active 任务。

### Task 12：建立关键 UI 回归、任务中心和案例深链

**目标：** 让多个持续任务可管理，候选/案例详情可刷新和前进后退，并用真实浏览器锁住关键安全与业务回归。

**文件：**

- Create: `playwright.config.mjs`
- Create: `tests/helpers/start-test-server.mjs`
- Create: `tests/ui-critical.spec.mjs`
- Create: `src/ui/router.mjs`
- Create: `src/ui/task-center.mjs`
- Create: `src/ui/match-detail.mjs`
- Create: `tests/router.test.mjs`
- Modify: `src/app.mjs`
- Modify: `src/api-client.mjs`
- Modify: `src/app.css`
- Modify: `service-worker.js`
- Modify: `package.json`
- Modify: `package-lock.json`

**Step 1：增加浏览器测试依赖和临时服务。**

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

`start-test-server.mjs` 必须：

- 使用临时 SQLite、临时上传目录和 fake/stub AI。
- 监听随机可用端口。
- 测试结束关闭 server、worker 和数据库连接。
- 不访问项目 `data/` 或真实 `.env.local`。
- 失败时保存 trace/screenshot，但不包含真实 key、cookie 或联系人。

新增脚本：

```json
{
  "test:e2e": "playwright test",
  "test:e2e:headed": "playwright test --headed"
}
```

**Step 2：先写关键失败用例。**

初始套件覆盖：

- 恶意区域名和恶意房源标题只能显示为文本。
- 修改 AI 预填后，POST body 使用修改值。
- 两个不同会话形成同一个 match case。
- 多任务列表、切换、暂停、恢复。
- 案例详情刷新、浏览器返回和前进。
- 非 owner 的 URL 不泄露数据。
- 单方确认联系人锁定；双方确认后解锁。
- 用户房源没有公开照片时不显示样板房。

**Step 3：实现任务中心状态。**

`src/app.mjs` 顶层状态改为：

```js
{
  tasks: [],
  activeTaskId: null,
  activeTaskSnapshot: null,
  activeMatchId: null,
  connection: {},
  fieldErrors: {}
}
```

- `GET /api/tasks` 为权威列表。
- Profile 中“我的任务”进入 task center。
- 卡片展示类型、状态、候选/澄清/确认计数、最后匹配、到期。
- active 可暂停，paused 可恢复，closed/expired 只读。
- 只轮询或订阅当前选中任务 UI；后端 worker 继续处理其他 active 任务。
- 刷新时 localStorage 的 task ID 只作偏好，服务端无权访问则丢弃。

**Step 4：实现同会话 router。**

`router.mjs` 只负责解析和构造允许参数：

```js
parseRoute(locationUrl)
buildTaskRoute(taskId)
buildMatchRoute(taskId, matchCaseId)
pushRoute(route)
replaceRoute(route)
```

- 使用 `URL` 与 `URLSearchParams`。
- `popstate` 恢复 task/match。
- 初始化顺序：建立 session → 取 tasks → 校验 URL owner → 取 snapshot。
- 无权访问、已失效或非法 ID 时回任务中心并显示持久提示，不白屏。
- 外部分享只复制文字摘要，不复制 owner-only URL。

**Step 5：逐步拆出视图函数。**

本轮不迁移 React/Vue，也不要求彻底拆完 97 KB CSS。只拆三块高变区域，并保持纯渲染接口：

```js
renderTaskCenter(viewModel)
renderMatchDetail(viewModel)
bindTaskCenterActions(root, handlers)
bindMatchDetailActions(root, handlers)
```

所有新模块加入 service worker APP_SHELL 和 `npm run check`。

**Step 6：运行和提交。**

```bash
node --test tests/router.test.mjs
npm run test:e2e
npm test
npm run check
```

```bash
git add playwright.config.mjs tests/helpers/start-test-server.mjs tests/ui-critical.spec.mjs src/ui/router.mjs src/ui/task-center.mjs src/ui/match-detail.mjs tests/router.test.mjs src/app.mjs src/api-client.mjs src/app.css service-worker.js package.json package-lock.json
git commit -m "feat: add task center and match deep links"
```

**完成定义：** 两个任务可切换、暂停和恢复；案例 URL 在同一会话刷新/前进/后退可恢复；浏览器自动测试覆盖用户修改值、XSS 和双边确认门禁。

### Task 13：完成连接状态、字段错误和弹层无障碍

**目标：** 让断线、AI 降级、字段错误和弹层操作对所有用户都可感知、可恢复，不再用短暂 Toast 或全页 live region 掩盖关键状态。

**文件：**

- Create: `src/ui/focus-manager.mjs`
- Create: `tests/focus-manager.test.mjs`
- Modify: `index.html`
- Modify: `src/app.mjs`
- Modify: `src/ui/task-center.mjs`
- Modify: `src/ui/match-detail.mjs`
- Modify: `src/app.css`
- Modify: `tests/ui-critical.spec.mjs`

**Step 1：写连接状态失败用例。**

Playwright 拦截当前 task snapshot/事件请求：

1. 首次连接显示 connecting。
2. 成功后显示 online 并保存 lastSuccessAt。
3. AI 失败但规则 parser 可用显示 degraded，不显示 offline。
4. 持续匹配接口失败显示持久 offline 条、上次成功时间和重试按钮。
5. 相同错误不会每轮重复播报。
6. 恢复后自动清除并只播报一次“连接已恢复”。

**Step 2：写字段错误失败用例。**

- 空预算、非法日期、过短联系人等返回 fieldErrors。
- 对应控件有 `aria-invalid=true` 和 `aria-describedby`。
- 错误文本持续存在直到修复。
- 提交失败后焦点移到第一个错误控件。
- Toast 只用于“复制成功”等短暂成功，不承载必须处理的错误。

**Step 3：移除全页 live region。**

`index.html` 中 `#app` 不再有 `aria-live`。新增视觉隐藏：

```html
<div id="app-live-region" class="sr-only" aria-live="polite" aria-atomic="true"></div>
```

只播报关键状态变化，不把每次完整 `innerHTML` 替换朗读给屏幕阅读器。

**Step 4：实现焦点管理器。**

现有 sheet 可保留，但统一使用：

```js
openModal({ modal, trigger, initialFocus })
closeModal({ modal })
restoreFocus(focusKey)
trapTab(event, modal)
```

对 create、location、photo、share、report、confirm、contact、map 弹层逐一满足：

- `role=dialog`、`aria-modal=true`、唯一标题 ID。
- 背景主内容与底部导航 `inert`。
- 打开时焦点进入弹层。
- Tab/Shift+Tab 不逃出。
- Esc 关闭。
- 关闭后回原触发按钮。
- 选择项触发整体 render 后仍恢复到对应稳定 key。

**Step 5：视觉与动作检查。**

- 交互目标至少 44×44。
- 所有 `outline:none` 都有可见 `:focus-visible` 替代。
- 320、375、430 px 无横向溢出。
- `prefers-reduced-motion: reduce` 关闭扫描、弹层和骨架屏非必要动画。
- 4.1 秒脚本扫描进度删除；显示真实 job phase，未知进度使用非百分比 loading。

**Step 6：运行和提交。**

```bash
node --test tests/focus-manager.test.mjs
npm run test:e2e
npm test
npm run check
```

```bash
git add src/ui/focus-manager.mjs tests/focus-manager.test.mjs index.html src/app.mjs src/ui/task-center.mjs src/ui/match-detail.mjs src/app.css tests/ui-critical.spec.mjs
git commit -m "fix: surface failures and accessible dialogs"
```

**完成定义：** 仅键盘可完成核心链路；断线不再显示虚假的持续匹配；字段错误可定位；页面刷新/重渲染不造成焦点和屏幕阅读器灾难。

### Task 14：补全事件指标、任务生命周期、通知和最小看房动作

**目标：** 用真实事件代替“节省沟通条数”等前端公式；让持续匹配任务具备续期、过期、举报和最小下一步动作，并为受控试点提供可观测性。

**文件：**

- Create: `src/server/event-service.mjs`
- Create: `src/server/notification-service.mjs`
- Create: `src/server/viewing-service.mjs`
- Create: `tests/event-service.test.mjs`
- Create: `tests/notification-service.test.mjs`
- Create: `tests/viewing-service.test.mjs`
- Create: `scripts/metrics-summary.mjs`
- Modify: `src/task-lifecycle.mjs`
- Modify: `src/server/task-repository.mjs`
- Modify: `src/server/match-case-service.mjs`
- Modify: `server.mjs`
- Modify: `src/api-client.mjs`
- Modify: `src/app.mjs`
- Modify: `package.json`

**Step 1：定义事件 schema 和隐私 allowlist。**

每类 event 在 `event-service.mjs` 有明确 schema：

```js
{
  type: "confirmation.recorded",
  aggregateId: matchCaseId,
  actorOwnerId,
  payload: {
    party: "renter",
    termsVersion: 2,
    latencyMs: 18342
  }
}
```

写失败测试：payload 出现 `contact`, `hardMax`, `minRent`, `exactAddress`, `rawText`, `evidencePath`, `sessionToken` 任一 key 或嵌套值时拒绝写入。

**Step 2：删除虚构指标。**

移除 `src/app.mjs` 中按公式生成的“减少沟通条数”。可展示的效率指标只能由事件推导，例如：

- 首次输入到有效 mandate 的轮次。
- AI 自动填充且用户未修改的字段数。
- 被定向澄清取代的预计问题数，需要有明确计算方法和版本。
- 从 case created 到 terms ready、单方确认、双方确认的时间。

如果没有可信计算依据，UI 就不显示该指标。

**Step 3：完善任务生命周期。**

- active task 默认 TTL 明确，例如 14 天。
- 到期前 48 小时产生 `task.expiring` 通知。
- 用户可 renew，增加 input version 或 lifecycle version，写事件并重算。
- pause 不删除数据，但撤销当前联系人授权。
- close 是用户明确终止，案例进入 invalidated/closed。
- expired 只读，可复制条件创建新任务；不能静默自动续期。

**Step 4：实现站内通知。**

v0.7 先实现持久化站内通知，不依赖外部短信/推送：

- 新真实候选。
- 需要本人澄清。
- 条款已准备。
- 对方已确认。
- 联系方式已解锁/已撤销。
- 任务即将到期。

通知写入与业务状态变化同一事务/outbox，重复 job 不产生重复通知。前端 badge 来自服务端未读数，不用固定数字。

**Step 5：实现最小看房提议。**

只在有效 contact grant 后允许：

- 一方提出一个 ISO 时间。
- 对方接受或拒绝。
- 任务或 grant 失效后未完成 appointment 取消。

不做日历同步、地图导航或复杂排期；这个动作只用于衡量“双方确认是否推进到真实下一步”。

**Step 6：举报改为服务端事件。**

当前前端本地举报必须改为持久化接口。至少保存 case ID、reporter、原因码、用户说明、状态、createdAt；不把被举报方私密数据复制进 payload。受控 alpha 可先人工在 SQLite/脚本查看，不必本轮做后台 UI。

**Step 7：生成指标摘要。**

`scripts/metrics-summary.mjs` 从结构化事件输出：

```text
activatedRealTasks
tasksWithCandidateWithin24h
clarificationCompletionRate
oneSidedConfirmationRate
mutualConfirmationRate
contactViewRate
viewingProposalRate
privateLeakCount
prematureUnlockCount
```

脚本只输出聚合统计，不导出原始用户文本。

**Step 8：运行和提交。**

```bash
node --test tests/event-service.test.mjs tests/notification-service.test.mjs tests/viewing-service.test.mjs tests/task-lifecycle.test.mjs
npm test
npm run check
node scripts/metrics-summary.mjs --database ./tests/fixtures/pilot-metrics.sqlite
```

```bash
git add src/server/event-service.mjs src/server/notification-service.mjs src/server/viewing-service.mjs tests/event-service.test.mjs tests/notification-service.test.mjs tests/viewing-service.test.mjs scripts/metrics-summary.mjs src/task-lifecycle.mjs src/server/task-repository.mjs src/server/match-case-service.mjs server.mjs src/api-client.mjs src/app.mjs package.json
git commit -m "feat: measure the real matching lifecycle"
```

**完成定义：** UI 不再展示公式伪指标；任务到期/续期/暂停有真实状态；通知可恢复且不重复；双方确认后可发起一个可度量的看房动作。

### Task 15：完成双账号 E2E、故障演练与试点发布闸门

**目标：** 用自动化和人工两种方式证明完整链路真实可用，并以数据闸门决定是否进入小范围试点，而不是凭演示观感上线。

**文件：**

- Create: `scripts/bilateral-smoke-test.mjs`
- Create: `tests/bilateral-e2e.spec.mjs`
- Create: `docs/pilot-runbook.md`
- Create: `docs/security-checklist.md`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/product-architecture.md`
- Modify: `docs/test-matrix.md`
- Modify: `docs/iteration-log.md`

**Step 1：写 API 级双账号 smoke。**

脚本启动临时 SQLite 服务并完成：

1. 创建 renter、supply、outsider 三个独立会话。
2. renter/supply 分别设置测试联系人。
3. renter 创建一个真实需求任务。
4. 断言无真实供给时返回空结果而非 seed。
5. supply 创建符合条件的真实房源并上传公开测试图。
6. 断言双方任务返回同一个 `matchCaseId`。
7. 若有阻断未知项，目标方回答并等待重算。
8. 断言双方看到同一个 terms version/hash。
9. renter 确认。
10. 断言双方联系人仍锁定。
11. supply 确认。
12. 断言双方分别得到对方联系人。
13. outsider 读取 case/contact 均为 404。
14. supply 修改月租或暂停任务。
15. 断言旧确认 revoked、旧 grant 锁定、新 terms 需重新确认。
16. 扫描所有公共 JSON，私密字段泄露为 0。

成功输出固定机器可读摘要：

```json
{
  "caseCreated": true,
  "clarificationResolved": true,
  "sameTermsVersion": true,
  "singlePartyContactLocked": true,
  "mutualContactUnlocked": true,
  "outsiderDenied": true,
  "changedTermsRevokedGrant": true,
  "privateLeakCount": 0,
  "seedCandidateCount": 0
}
```

**Step 2：写浏览器级双账号 E2E。**

使用两个 browser context，覆盖：

- 租客自然语言 intake、修改预填、提交。
- 房东自然语言 intake、未知字段、照片上传、提交。
- 空结果到候选出现的真实状态变化。
- 澄清回答。
- 双方对比同一版条款。
- 单方确认锁定。
- 双方确认解锁。
- 页面刷新后状态恢复。
- 条款变化后显示差异并撤销。
- 键盘完成关键链路。
- 320、375、430 px 三种移动视口无阻断。

**Step 3：故障演练。**

在测试环境逐项模拟：

- Qwen 超时、429、坏 JSON。
- Worker 处理到一半进程退出。
- SQLite busy/locked。
- 创建任务响应丢失后客户端重试。
- 图片解码器拒绝恶意文件。
- Cookie 过期和 session 撤销。
- 条款确认并发冲突。
- 任务在联系人读取前刚好暂停。

每个故障必须有明确用户状态、稳定错误码、可安全重试策略和审计事件；不能留下假“匹配中”或越权联系人。

**Step 4：人工探索清单。**

- macOS Chrome/Safari 最新稳定版。
- 320、375、430 px；横竖屏切换。
- 鼠标、触摸、仅键盘、VoiceOver 基础路径。
- `prefers-reduced-motion`。
- 慢速网络、离线、恢复。
- 中文长文本、emoji、单双引号、HTML 字符。
- 两个账号交叉恶意标题和错误 URL。
- real/demo 模式标识与空结果。

截图重新生成并只使用 demo mode，README 必须说明截图中的演示数据；不得把真实联系人、cookie、API key、数据库路径或未脱敏材料带入图片。

**Step 5：更新文档。**

README 和架构文档必须明确：

- “真实双边”指服务端状态真实，不代表官方核验。
- demo fixture 永不生成可确认案例。
- Qwen 的职责边界与降级方式。
- 双方同版确认和联系人门禁。
- 本地启动的密钥配置只引用变量名，不引用用户的 key 文件路径或实际 key。
- 数据目录、备份、删除和受控 alpha 限制。

**Step 6：最终命令。**

```bash
npm run check
npm test
npm run test:e2e
npm run eval:marketplace
npm run smoke:bilateral
git diff --check
git status --short
```

期望：

- 全部测试通过，HTTP/E2E 在 CI 中 `0 skipped`。
- marketplace eval 的 hard conflict、private leak、seed-to-case 均为 0。
- smoke 摘要所有布尔护栏为 true，计数护栏为 0。
- `git status --short` 只包含计划内预期文件。

**Step 7：提交。**

```bash
git add scripts/bilateral-smoke-test.mjs tests/bilateral-e2e.spec.mjs docs/pilot-runbook.md docs/security-checklist.md package.json README.md docs/product-architecture.md docs/test-matrix.md docs/iteration-log.md
git commit -m "test: verify real bilateral matching end to end"
```

**完成定义：** 自动化可以从空市场走到真实双方确认，再证明失效后重新锁定；人工测试没有阻断级问题；所有发布闸门有数据证据。

## 16. 建议交付节奏与并行方式

以下是依赖顺序，不是不可调整的日历承诺。估算假设为两名全栈工程师、产品/测试每天可参与验收；若只有一名工程师，建议保持顺序并将周期按约 1.8–2.2 倍规划，不能通过删掉安全和真实性测试压缩时间。

| 阶段 | 建议时段 | 主任务 | 可以并行 | 阶段出口 |
| :---: | :---: | :---: | :---: | :---: |
| A：真实性地基 | 第 1 周 | Task 0、1、2、3、4 | 1 与 3；2 与 4 | real/demo 分离；XSS 阻断；用户修改值不丢；会话和核验文案可信 |
| B：双边领域核心 | 第 2 周 | Task 5、6 | migration fixture 与 pair evaluator 测试可并行 | 两个真实任务形成唯一案例；无 seed/私密字段泄露 |
| C：无聊天闭环 | 第 3 周 | Task 7、8、9 | 澄清 UI 与条款 repository 可并行 | 阻断未知项可解决；双方同版确认；联系人服务端门禁 |
| D：持续与媒体 | 第 4 周 | Task 10、11 | media 与 outbox 完全可并行 | 真实图片可用；任务变更可靠触发增量重算 |
| E：可用性与运营 | 第 5 周 | Task 12、13、14 | 无障碍与事件服务可并行 | 多任务、深链、错误恢复、通知和真实指标完成 |
| F：受控试点准备 | 第 6 周 | Task 15 | E2E、故障演练和文档可分工 | 全部门槛通过，才允许邀请试点用户 |

关键路径：

```text
Task 0
  ↓
Task 3 → Task 5 → Task 6 → Task 7 → Task 8 → Task 9
                    │                         │
                    └──── Task 11 ───────────┤
Task 1 → Task 2 → Task 10 ──────────────────┤
                                              ↓
                                     Task 12 / 13 / 14
                                              ↓
                                           Task 15
```

每完成一个阶段都应部署到独立的受控测试环境，用两个新账号从头走链路。不要等所有代码完成后才第一次联合调试。

## 17. 阶段闸门

### 17.1 Internal Gate：允许团队内部使用

必须全部满足：

- 用户编辑字段保存正确率 100%。
- 供应未知字段不再继承 demo 默认值。
- real mode seed candidate 数为 0。
- 双方确认与联系人门禁无客户端旁路。
- 存储型 XSS 自动用例通过。
- 上传与核验文案完全分离。
- API key、cookie、联系人和材料路径未进入 Git、截图和日志。

### 17.2 Alpha Gate：允许邀请受控熟人用户

| 指标 | 门槛 | 采样方式 |
| :---: | :---: | :---: |
| 关键字段结构化准确率 | ≥ 95% | 100 条人工标注 intake 样本 |
| 用户确认值丢失 | 0 | E2E + 事件审计 |
| 私密字段泄露 | 0 | API allowlist 扫描 + 恶意用例 |
| 提前联系人解锁 | 0 | 三会话并发测试 |
| 增量重算 P95 | ≤ 30 秒 | task.updated 到 match.job_completed |
| 重复任务/案例 | 0 | 幂等重放与崩溃恢复测试 |
| XSS | 0 | 跨用户 Playwright 用例 |
| 假核验文案 | 0 | UI 文案快照与人工检查 |

### 17.3 Pilot Gate：允许小范围真实供需试点

| 指标 | 初始门槛 | 解释 |
| :---: | :---: | :---: |
| 24 小时候选覆盖率 | ≥ 40% | 激活任务中 24 小时内至少一个真实候选 |
| 值得继续的候选率 | ≥ 60% | 用户认为候选至少值得查看详情 |
| 单方确认率 | ≥ 30% | terms_ready 案例中至少一方确认 |
| 双方确认率 | ≥ 10% | terms_ready 案例中双方同版确认 |
| 双方确认到看房提议 | ≥ 50% | 判断联系人解锁是否产生真实行动 |
| 误导/失实投诉率 | < 5% | 试点案例举报与人工回访 |
| 单房源运营耗时 | < 10 分钟 | 材料/异常人工处理耗时 |
| 重大隐私或授权事故 | 0 | 阻断指标，发生即暂停试点 |

这些阈值是第一版假设。达到门槛后也不能只看总量扩张；需要连续观察至少三周，北极星指标不下降且安全护栏为 0 才进入扩大阶段。

### 17.4 Expand Gate：允许扩大区域或用户量

- 北极星指标连续三周不下降。
- 供需密度足以让核心价格带 24 小时覆盖率稳定达标。
- 举报处置、联系人撤销、数据删除和备份恢复有运行记录。
- 手机号/OIDC 登录、真实核验服务、生产数据库隔离和 KMS 已完成。
- 已完成容量测试、故障恢复目标和安全评审。

## 18. 小范围试点方案

### 18.1 选择区域

不要一开始做“全上海”或全国。建议选上海 2–3 个相邻、通勤路径较清晰、租赁需求密集的微区域，例如一个大学/产业园及相邻地铁沿线。选择标准：

- 地理边界和通勤目的地容易标注。
- 租金价格带相对集中。
- 能定向招募真实房东或转租供给。
- 团队可以人工回访并处理失实信息。
- 不依赖中介批量数据才能形成供给。

最终区域必须在招募前由供给渠道决定，不能只根据产品团队偏好。

### 18.2 冷启动密度

建议首批：

- 30–50 套 active 真实房源。
- 100–200 个租客候补/任务。
- 每个核心价格带至少 8–10 套可比较房源。
- 房源 TTL 不超过 14 天，过期必须由房东续期。
- 先验证供给真实性和字段完整度，再分批开放租客。

如果某价格带不足，不要用 demo 补齐。产品应明确显示当前真实供给密度，并把用户加入持续匹配等待列表。

### 18.3 试点日常 SOP

每日检查：

1. worker failed/pending、DB/WAL、备份状态。
2. 新房源的提交/核验状态和过期时间。
3. 硬冲突误入案例、私密字段、提前解锁和重复案例护栏。
4. 澄清问题是否重复、含糊或泄露对方信息。
5. terms_ready、单方确认、双方确认和看房转化。
6. 举报、联系人撤销和用户退出请求。

每周复盘：

- 随机抽取 20 个无候选任务，区分“真实无供给”“解析错误”“规则过严”“通勤数据错误”。
- 随机抽取 20 个候选，人工检查硬条件与解释一致性。
- 访谈未确认的双方，判断是信息不足、结果不可信、条件不合适还是确认动作不清楚。
- 更新澄清问题优先级和真实字段缺失率，不直接以更多 AI 对话作为默认解法。

### 18.4 暂停试点条件

出现任一项立即暂停新增用户并保全事件证据：

- 联系方式在双方确认前被读取。
- 跨账号读取到任务、精确地址、底价或私密材料。
- 上传材料被错误标为官方核验并造成用户决策。
- 数据库损坏且备份无法恢复。
- 同一条款版本在双方页面显示不同内容。
- 发生可执行存储型 XSS。
- 未授权真实数据进入公开截图、README 或日志。

## 19. 测试矩阵

### 19.1 单元测试

| 模块 | 必测内容 |
| :---: | :---: |
| `safe-markup` | 文本/属性编码、空值、引号、中文 |
| `field-state` | 来源优先级、用户确认保护、冲突 diff |
| `mandate-builder` | 用户修改后唯一真值、灵活租期语义 |
| `pair-evaluator` | 硬冲突、未知、软偏好、私密/公开解释 |
| `terms-service` | canonical JSON、hash、allowlist、版本复用 |
| `confirmation-service` | 同版确认、幂等、冲突、撤销 |
| `contact-service` | 规范化、加密、mask、篡改检测 |
| `media-service` | 魔数、解码、像素、EXIF、访问目的 |
| `outbox` | 原子写、领取、租约、重试、dead event |
| `router/focus` | URL 解析、非法 ID、Tab trap、焦点恢复 |

### 19.2 服务集成测试

- 每个 owner 只能看到自己的 task 和参与的 case。
- 三方越权访问统一 404。
- 创建/更新/回答/确认的幂等和 version conflict。
- 任务状态与 case/grant 联动失效。
- AI stub 成功、schema 失败、超时、限流和规则降级。
- 图片上传与受控读取。
- worker 崩溃恢复和旧版本结果丢弃。
- health 反映 DB、worker 和 AI 的真实状态。

### 19.3 浏览器 E2E

- renter、supply 两个 browser context 走完整链路。
- outsider context 做 URL 枚举和联系人越权。
- 修改 AI 预填字段的 POST/DB/结果一致性。
- XSS、断线、恢复、刷新、前进、后退。
- 多任务切换、暂停、恢复、过期。
- 单方/双方确认和条款变化。
- 照片、占位和私密材料不串线。
- 键盘、焦点、live region 和移动视口。

### 19.4 AI 评测

数据集按语义类别分桶：

- 居住区域与通勤目的地。
- 预算目标与硬上限。
- 入住日期窗口。
- 固定租期与灵活租期。
- 整租、合租与室友偏好。
- 设施 must-have 与 nice-to-have。
- 房东本人、中介、代发与收费风险。
- 费用、押付方式和未知项。
- 用户改口、纠错和冲突。
- 恶意提示注入与越权索取信息。

每个评测输出字段级 precision/recall、语义角色正确率、用户确认值保护率、问题重复率、私密信息泄露率和降级成功率。不要只给一个综合分数。

### 19.5 当前测试文档联动

实施时同步更新[现有测试矩阵](../test-matrix.md)，保留 v0.6 测试并新增 v0.7 分组。不得用删除旧测试来让新实现变绿；确实改变产品语义时，先在本计划和[产品架构](../product-architecture.md)记录决策，再更新测试预期。

## 20. 风险登记表

| 风险 | 概率 | 影响 | 早期信号 | 缓解方案 | Owner |
| :---: | :---: | :---: | :---: | :---: | :---: |
| 真实供给不足导致空结果 | 高 | 高 | 24 小时候选覆盖率低 | 缩小区域、先供给后需求、等待列表；绝不混 seed | 产品/运营 |
| AI 地点语义错误 | 中 | 高 | 目标区/通勤地纠错率高 | 语义角色 schema、规则解析、确认页和评测集 | AI/后端 |
| 用户修改值被覆盖 | 中 | 阻断 | diff 中值回退 | builder 单一真值、字段版本、E2E guardrail | 前端/后端 |
| 条款双方视图不一致 | 低 | 阻断 | hash 相同但 JSON 不同 | canonical JSON、同版 hash、服务端投影 | 后端 |
| 联系方式提前泄露 | 低 | 阻断 | 未确认 contact.viewed | 服务端 grant、三方测试、即时二次检查 | 安全/后端 |
| SQLite 锁竞争 | 中 | 高 | busy、worker 延迟升高 | WAL、短事务、busy timeout、outbox、容量闸门 | 后端 |
| 模型成本或长尾 | 高 | 中 | token/日预算、P95 上升 | 配额、20s timeout、一次重试、规则降级 | AI/后端 |
| 图片炸弹或 GPS 泄露 | 中 | 高 | 解码失败/metadata 告警 | sharp 解码重编码、像素限制、公私目录 | 后端 |
| 核验文案过度承诺 | 中 | 高 | 用户投诉“平台说已认证” | 状态字典、UI 测试、人工审查 | 产品/设计 |
| 全页渲染造成焦点丢失 | 高 | 中 | 键盘/读屏失败 | 独立 focus manager、关键视图模块化 | 前端 |
| Worker 重复处理 | 中 | 高 | 重复案例/通知 | dedupe key、DB 唯一约束、幂等事件 | 后端 |
| 日志/截图带出真实数据 | 中 | 阻断 | repo 扫描命中 key/联系人 | demo-only 截图、脱敏 logger、secret scan | 全员 |

Owner 是职责建议，不是当前实际人员安排；执行开始时必须给每项风险指定具体负责人和响应时限。

## 21. 数据生命周期、备份和删除

### 21.1 最小保留策略

受控 alpha 建议：

- active/paused 任务：用户保留期间或最长 90 天，具体值在隐私说明中公开。
- closed/expired 任务：30 天后删除或不可逆去标识化。
- 原始对话：只保留形成字段所需的最短期限；优先保留结构化字段和必要 evidence span。
- 私密原始图片：审核完成后按政策尽快删除；公开 derivative 随房源关闭撤下。
- session：过期后 7 天清除服务端记录。
- contact grant：失效后保留最小审计事实，不保留解密后的访问缓存。
- 聚合指标：只保留去标识统计。

具体天数在真实试点前由法律/隐私要求确认；代码必须配置化，不能把保留变成“永久”。

### 21.2 用户删除

提供服务端删除流程，顺序：

1. 撤销 session、任务、confirmation 和 contact grant。
2. 标记 media 删除并阻止访问。
3. 删除或去标识化联系人、原始文本与材料。
4. 保留必要安全/审计事件时，移除可反查用户的字段。
5. 写不含私密内容的 deletion completed 事件。

删除流程必须可重试并有自动测试。不要直接用递归 shell 删除整个数据根目录。

### 21.3 备份恢复

- SQLite 使用在线 backup API 或受控 checkpoint 后备份，不直接复制正在变化的 WAL 主文件组合。
- 备份加密并限制权限。
- 至少每周做一次恢复演练到临时目录。
- 记录 RPO/RTO；受控 alpha 可先定 RPO 24 小时、RTO 4 小时，扩大前需收紧。
- 恢复后运行 migration check、foreign key check 和最小 smoke。

## 22. 生产迁移边界

v0.7 先证明领域语义，不在本轮提前重写全部基础设施。下列接口与不变量应保持稳定，便于替换实现。

| SQLite/本地 alpha | 生产替换 | 保持不变的语义 |
| :---: | :---: | :---: |
| 匿名安全 cookie | 手机 OTP/OIDC、设备风控、撤销 | owner authorization、session TTL |
| SQLite owner 检查 | PostgreSQL + RLS | 非参与者 404、最小投影 |
| 环境变量应用加密 | KMS 包络加密/秘密服务 | 联系人只在有效 grant 下解密 |
| 本地私密上传目录 | 私有对象存储、病毒扫描 | public/private purpose 和授权 |
| 单进程 outbox worker | 托管队列 + 幂等 worker | dedupe key、旧版本丢弃 |
| SQLite event 表 | 集中审计和指标管线 | 事件名、隐私 allowlist |
| 轮询 | SSE/WebSocket/Push | server source of truth、恢复语义 |
| 字符串位置/模拟通勤 | 地理索引与路线矩阵 | 居住目标与通勤目的地分离 |
| 受控人工审核 | 第三方身份/产权核验 | submitted 与 verified 分离 |
| 30–50 套试点供给 | 多区域真实供给系统 | seed 永不混入 real case |

公网发布前的强制阻断项：

- 手机号/OIDC 等真实身份入口与账号恢复。
- PostgreSQL 多租户隔离或等价生产数据边界。
- KMS 联系人加密和密钥轮换。
- 私有对象存储、恶意文件扫描和正式核验服务。
- 分布式限流、成本预算和告警。
- 安全评审、隐私说明、用户删除和事件响应流程。
- TLS、反向代理、安全 cookie、备份和灾备验证。

禁止把当前 server 直接绑定 `0.0.0.0` 并以“已通过本地测试”为由公开给真实用户。

## 23. Definition of Done

v0.7 只有同时满足以下产品、技术、数据和运营标准才算完成。

### 23.1 产品完成

- 两个独立真实会话能完成从创建任务到联系人解锁。
- 无真实候选时诚实空结果，之后新任务能触发持续匹配。
- AI 只问阻断/高价值问题，不要求双方自由聊天才能判断。
- 用户能看懂硬条件、软偏好、未知项、条款版本和双方状态。
- 多任务可查看、暂停、恢复和续期。

### 23.2 技术完成

- 任务、案例、条款、澄清、确认、授权、通知、图片都有服务端持久化。
- 所有关键写操作幂等并处理版本冲突。
- worker 崩溃后可恢复，不重复案例。
- 前端刷新后从服务端恢复全部业务状态。
- `npm run check`、unit/integration/E2E/eval/smoke 全部通过。

### 23.3 安全与真实性完成

- XSS、越权、私密字段、提前联系人解锁自动护栏为 0。
- localStorage 无 session secret 或业务授权真值。
- 上传图片真实解码、重编码和去 metadata。
- “上传”不等于“核验”，demo 不等于 real，建议不等于同意。
- secret、真实联系人、cookie、材料和数据库未进入 Git/截图/普通日志。

### 23.4 数据完成

- 北极星和漏斗事件能从服务端真实事件计算。
- “节省沟通”不再使用无依据前端公式。
- 试点护栏、转化和失败原因可按周复盘。
- 数据保留、删除和恢复有脚本/流程并完成演练。

### 23.5 运营完成

- 试点区域、供给规模、招募顺序和暂停条件明确。
- 举报、撤销、失实信息和安全事故有人负责。
- README、架构、测试矩阵、runbook 与实际实现一致。
- 团队能在不查看源代码的情况下按 runbook 判断系统是否健康。

## 24. 最终验收命令清单

局部任务完成后跑局部测试；每个阶段结束至少执行：

```bash
npm run check
npm test
npm run test:e2e
npm run eval:marketplace
npm run smoke:bilateral
git diff --check
git status --short
```

有 Qwen 凭据且明确允许产生调用成本时，再执行：

```bash
npm run eval:ai
```

验收人员还要检查：

```bash
rg -n "zhunaer_demo|contactUnlocked *= *true" src
rg -n "SIMULATION_DATE|new Date\\(" src server.mjs
rg -n "localStorage.*session|session.*localStorage" src
rg -n "verified.*evidence|evidence.*verified" src
rg -n "hardMax|minRent|exactAddress|contact_value" src/server src/app.mjs tests
```

这些命令的命中不能机械要求为 0：schema、测试和服务端私密计算中可能合理存在字段名。必须逐项确认它们没有进入公共投影、日志、前端硬编码或错误核验逻辑。

## 25. 执行时的决策检查点

### Checkpoint 1：Task 4 完成后

确认：

- 用户修改真值、XSS、会话和核验真实性已解决。
- 如果这些基础仍不稳定，暂停案例开发，先修地基。

### Checkpoint 2：Task 9 完成后

用两个独立会话做第一次完整人工链路。确认：

- case 唯一。
- 澄清问题有价值。
- 双方看到同一条款。
- 单方确认无法读取联系人。
- 条款变化撤销旧确认。

这个检查点通过，才说明“核心目标的技术闭环”已经成立。

### Checkpoint 3：Task 15 完成后

用阶段闸门判断：

- 只通过技术闭环但供给密度不足：保持 internal/alpha，不扩大。
- 有覆盖率但候选质量低：优先修字段/规则，不增加对话层。
- 候选质量高但双方确认低：研究条款信任、解释和操作，不先做自由聊天。
- 双方确认高但看房低：研究供给真实性、时间安排和联系人质量。
- 任一安全护栏不为 0：暂停试点，先修复并复盘。

## 26. 相关文档

- [项目 README](../../README.md)
- [现有产品架构](../product-architecture.md)
- [现有测试矩阵](../test-matrix.md)
- [匹配案例手册](../matching-casebook.md)
- [迭代记录](../iteration-log.md)
- [产品事实边界](../product-facts.md)

实施过程中，本计划负责“下一步做什么和怎么验收”；产品架构记录最终采用的长期结构；测试矩阵记录实际覆盖；迭代记录记录每个阶段完成情况。四者必须同步，避免计划与实现长期漂移。

## 27. 推荐的开始方式

先执行 Task 0–4，不要一上来同时修改匹配状态机和 UI。第一个可交付里程碑应当是：

> real/demo 已分离，跨用户数据安全，用户修改值不丢失，AI 与上传状态不再过度承诺。

随后按 Task 5–9 建立最小真实闭环。到 Checkpoint 2 时，如果两个独立会话能在无 seed、无本地假状态的前提下完成双方同版确认并安全解锁联系人，就已经实现了本轮最重要的产品跃迁。Task 10–15 再把它变成可持续、可使用、可观测和可试点的版本。

执行可采用两种方式：

1. 当前任务内按 Task 顺序逐项实现，每个 Task 完成后做代码审查和回归，再进入下一项。
2. 新建独立实施任务，以本文件为唯一计划源，按阶段并行开发，但所有分支必须在 Checkpoint 1、2、3 汇合验收。

无论采用哪种方式，都不应跳过先失败的测试、隐私 allowlist、条款版本冲突和双账号 E2E；它们正是“看起来能用”与“核心目标真的实现”之间的边界。
