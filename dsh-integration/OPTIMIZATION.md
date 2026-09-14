# OPTIMIZATION.md — 中间层与集成适配的进阶方向

**定位**：本文只谈**修完缺陷之后的进阶空间**；已存在的缺陷见 `FRAGILITY.md`（P0-0 读路径围栏、错误映射、门禁缺失等），不在此重复。
**口径**：每条给出**现状（含证据锚点）→ 目标形态 → 关键实现环节 → 代价/前置**，不写"可以更好"这类空话。
**快照**：2026-09-14

## 〇 结论摘要

中间层（`vendor/bridge` + worker 适配层）当前是**「能跑通的最小闭环」**：单进程一问一答、无并发上限、无中间进度、事件载荷 4 个字段、跨语言契约手写双份。进阶空间集中在六个主题：

| 主题 | 最大收益 | 主要代价 | 前置 |
|---|---|---|---|
| **A 传输与并发** | 批量延迟 ↓（省去每请求进程启动） | 常驻内存 + 崩溃影响面扩大 | `interactive` 实跑（P3-3） |
| **B 观测与可诊断** | 首次获得可量化视图 | 无（低代价，收益最高） | 无 |
| **C 契约/配置单一真源** | 消除跨语言漂移整类问题 | 需建生成/校验链 | 无 |
| **D 安全策略面** | 把"单点守卫"变"分层策略" | 需定义策略语义 | P0-0 先修 |
| **E 批量语义与流式** | 长批次可控、可恢复 | 协议扩展 | A 之后 |
| **F 工程化** | 消除"双副本不同步"类复发 | 建基线耗时 | 无 |

---

## 一 A 传输与并发 — 收益最大，也最需要前置

| # | 现状（证据） | 目标形态 | 关键实现环节 | 代价/前置 |
|---|---|---|---|---|
| A-1 | **`collect` 每请求 spawn 一个 Python 进程**：`buildSpec():164-166` argv = `python -m markitdown_bridge.single`；每请求付一次解释器启动 + markitdown 导入（~1-3s 量级） | 长驻 worker 复用（`interactive`）为默认；`collect` 降为隔离回退 | ① 先实跑 `interactive`（P3-3）② 定"何时必须回退 collect"（如 OCR 崩溃隔离）③ profile 默认值切 `interactive` | **前置：P3-3 实跑**；常驻内存 + 单点崩溃 |
| A-2 | **`maxConcurrent` 在 `collect` 下完全不生效**：仅 `InteractiveTransport.buildSpec():273` 用作 argv；collect 路径不读该键 | 两种传输**并发语义统一**：`collect` = 最多 N 个并发进程轮转；`interactive` = 进程内 N 线程 | 在 Transport 抽象层引入**容量闸**（信号量/令牌桶），两种实现共用同一 `maxConcurrent` 语义 | 无（先定义语义） |
| A-3 | **无并发上限、无背压**：worker 无 semaphore/队列；并发度 = 宿主并发工具调用数 → N 个调用 = N 个 Python 进程 | 有界队列 + 可观测深度；超限排队而非无限起进程 | ① 加容量闸（与 A-2 同一处）② 队列深度进 `health.pending` ③ 排队超时策略 | 依赖 A-2 的语义定义 |
| A-4 | **批量超时线性放大**：`timeoutMs * max(1, sources.length)`（`:231`）→ 20 源 × 120s = **40 分钟** | 分层预算：`perItem` 超时 + `batchTotal = min(上限, perItem × N)`，并**与宿主工具超时对齐** | ① 拆出 `perItemTimeoutMs` / `batchTimeoutMs` 两个配置 ② 逐项超时不终止整批（当前 terminate 会杀整进程） | 无 |
| A-5 | **重启预算 = 1 且只有 interactive 消费**（`:287-292`，见 `FRAGILITY.md` F-13） | 统一策略：`restartOnCrash` + 冷却 + 半开探测；`collect` 下语义改为"本请求失败后是否换进程重试一次" | ① 统一配置语义 ② 或显式声明"collect 模式不支持重启"并在 `description` 写明 | 需决策（语义取舍） |

---

## 二 B 观测与可诊断 — 代价最低，建议最先做

| # | 现状（证据） | 目标形态 | 关键实现环节 |
|---|---|---|---|
| B-1 | **事件载荷只有 4 个字段**：`{source, chars, title?, ocr}`（`dsh-markitdown/src/index.ts:78-84`）——无耗时、无格式、无字节、无尝试次数 | 载荷含 `durationMs / format / bytes / attempts / transport` | ① 扩 `MarkitdownConvertedPayload` ② worker 侧计时（spawn→exit）③ bridge 回传 `format` 与真实字节数 |
| B-2 | **事件无任何消费者**（`FRAGILITY.md` F-15）：只 emit，无人订阅 | 至少一处消费者：metrics 或结构化日志 | ① 决策落在 worker 内订阅还是独立观测插件 ② 若不需要，删除声明以免误导 |
| B-3 | **`ocr` 字段语义偏弱**：`ocr: Boolean(options?.ocr)`（`:467`）= "是否传入了 OCR 选项"，**不表示 OCR 真的生效** | 语义改为"OCR 是否实际参与"：由 bridge 回传 `ocrApplied` | ① bridge payload 加 `ocrApplied` ② worker 传递 ③ 注意 OCR 静默降级已被 P0-1 消除，此项是"如实上报"而非补漏 |
| B-4 | **health 语义粗**：`collect` 的 health = 跑一次完整 `init` 探针（贵且重）；`interactive` = `request('health')` | 分层健康：`liveness`（进程/通道）与 `readiness`（依赖+版本+格式可用性）分开 | ① 定义两级返回 ② 把 `VENDORED_VERSION` 与依赖可用性纳入 readiness |
| B-5 | **无性能基线**：无任何 p50/p95 记录 | 建基准（单文件 / 批量 N / OCR 各一条），据数据决定 A-1 默认值与 A-4 阈值 | ① 固定素材集（`Test/` + `ocr_test_data/`）② 脚本化跑分 ③ 结果入库为回归基线 |

---

## 三 C 契约与配置单一真源 — 消除"跨语言漂移"整类问题

| # | 现状（证据） | 目标形态 | 关键实现环节 |
|---|---|---|---|
| C-1 | **跨语言契约手写双份**：错误码在 Python 定义 6 个（`service.py:28-33`），TS 侧**只显式映射 3 个**（`src/index.ts:97-110`）；`capabilities` 亦是 Python 单方声明（`service.py:147`） | **一份 schema 生成两侧**：错误码/op 列表/payload 字段单点定义 → 生成 TS 常量 + Python 常量，CI 比对 | ① 选载体（JSON Schema 或 TS 常量 + 生成器）② 生成 `bridge-protocol.ts` / `bridge_protocol.py` ③ 加门禁（不一致即 exit 1） |
| C-2 | **`Config` 键三处手工同步**：`Schema.object({})` / 包内 `cordis.yml` / profile `cordis.patch.yml`（`FRAGILITY.md` F-8） | 由 Schema **生成** yml 默认值块；CI 检查键集一致 | ① 写生成脚本（读 Schema → 输出 yml 片段）② 接入 `TESTPLAN` T0-8 ③ patch 覆盖"全键重述"改为生成式重述 |
| C-3 | **`PLUGIN_INTERFACE_VERSION` 双真源**：Python 锚点文件 vs TS 常量（`:42`）（F-5） | 随 C-1 一起收敛进协议 schema；启动自检读同一来源 | 同 C-1；另加"锚点 ↔ 代码常量"一致性断言 |
| C-4 | **`api-plus` 只覆盖"文档↔代码"**（bridge 14 / ocr 9 / core 34 符号，实测 `[OK] 无漂移`） | 扩展为**跨语言契约 manifest**：把 op / error code / payload 字段纳入同一检查面 | ① 在 `api_manifest.json` 基础上加 protocol 段 ② `--check` 比对 TS 侧常量 |

---

## 四 D 安全与策略面 — 从"单点守卫"到"分层策略"

前置：**先修 `FRAGILITY.md` P0-0（F-1/F-2）**，否则下面的策略层建在空中。

| # | 现状 | 目标形态 | 关键实现环节 |
|---|---|---|---|
| D-1 | 读控制是**单一 TS 守卫**且可被短路；真正执行 `open()` 的是 Python 侧，**它不做任何校验** | 显式 `SourcePolicy`（盘符路径 / URI scheme / 网络开关 / 大小上限 / 扩展名白名单），**在 bridge 侧再执行一次**（双层，defense in depth） | ① 定义 policy 结构并从 TS 透传到 bridge ② bridge 在 `_convert_one` 前 assert ③ 双层的拒绝形状保持一致（便于模型理解） |
| D-2 | **网络面未声明**：bridge 直接支持 `http(s)` 抓取（`_markitdown.py:569` `urlparse(response.url)`） | `allowNetwork` 开关，**默认关**（Fail-Closed），并在工具 `description` 显式声明 | ① 加配置项 ② bridge 侧拦截非 allow 的 scheme ③ 工具描述同步 |
| D-3 | `data:` URI 无大小限制，可注入任意内联内容 | 纳入 `SourcePolicy` 上限（与 D-1 同一处） | 同 D-1 |
| D-4 | `workerEnv` 可注入**任意**环境变量（如 `PYTHONPATH`）（F-27） | 白名单化允许的键（如仅 `PYTHONUTF8`/代理类） | ① 定义允许键集 ② 非法键在 `apply` 期 fail loud |

---

## 五 E 批量语义与流式 — 长批次的可控与可恢复

| # | 现状（证据） | 目标形态 | 关键实现环节 |
|---|---|---|---|
| E-1 | **20 条硬限**：`src/index.ts:227-229` 抛 `at most 20 sources per call` | 预算制（条数 + 总字节 + 总时长），可配；硬限降为"默认上限" | ① 配置化 ② 超预算时明确的错误码而非泛化 `Error`（当前抛的是裸 `Error`，会落 `default` 映射） |
| E-2 | **整批单进程、无 per-item 重试**：per-item 隔离只在**单进程内**生效（`service.py:191-196`），进程崩溃即整批失败（F-26） | 分片为多个进程批次 + per-item 重试计数（仅对可重试错误码） | ① 定义"可重试"错误码集（与 C-1 的错误契约联动）② 分片策略 ③ 重试预算 |
| E-3 | **协议有 `event` 通道但只发 `ready`**：TS 解析处已支持 `event`（`:141`、`:339` 只处理 `ready`），Python 侧仅 `__main__.py:31` 发一次 | `event: item-done` 逐项事件 → 进度与部分结果 | ① 定义事件类型 ② interactive 下逐条回 ③ collect 下退化为不支持（能力探测） |
| E-4 | 结果**一次性全量**返回；tool 侧靠 `deferContext` 发一条汇总通知（`dsh-tool-markitdown/src/index.ts:236-246`） | 配合 E-3 做**分片通知**：每完成一批发一条结果附加指令 | ① 依赖 E-3 ② 注意 `deferContext` 是"本次执行结果之后追加"，分片数需与模型容忍度平衡 |

---

## 六 F 工程化 — 消除复发类问题

| # | 现状（证据） | 目标形态 | 关键实现环节 |
|---|---|---|---|
| F-1 | **`lib/` 产物入库且无新鲜度门禁**（F-6）：`src` 改了忘 `build:lib` → profile 拷旧产物，而 `dump-config` **不执行 `apply`** → 仍全绿 | 门禁：`src` mtime/hash 新于 `lib` 即失败 | ① 加校验脚本 ② 接入 `dev-reload.ps1` 前置 ③ 接入 `TESTPLAN` |
| F-2 | **测试靠临时探针**（Step 11/12 用完即删）；无 fixture、无可注入 fake | bridge 协议提成**可注入接口**（mock `SubprocessHandle`），L2 覆盖传输全路径 | 见 `TESTPLAN` T2-4~T2-6；把"临时探针"固化为持久用例 |
| F-3 | **vendored 同步无上游比对**：锚点只记版本号，无 upstream commit/tag；无升级差异报告 | 锚点记 upstream commit；同步时产出"上游 diff 报告"；CI 演练 | ① `VENDORED_VERSION` 加 commit 字段 ② 同步报告生成 ③ 接 `TESTPLAN` T4-10 |
| F-4 | **MCP 过渡路径未启用**（预留 P3-1） | `markitdown-mcp` 作兜底，**必须 `disabled: true`**（否则与现有提供者构成同能力双路径） | ① 挂载并标 disabled ② 定义切换开关 ③ 能力对齐表（哪些格式/能力重叠） |

---

## 七 G 定义包与可替换性 — 让"接缝"真的可替换

| # | 现状 | 目标形态 | 关键实现环节 |
|---|---|---|---|
| G-1 | 接缝已解耦（Consumer 不 import provider），但**只有单提供者**，无选择逻辑 | 完成"替换提供者演练"（P2-2）→ 形成多提供者选择策略（按能力/成本/可用性排序） | ① 演练：挂第二个同接缝提供者，旧行 `disabled: true` ② 定义选择契约（能力探测 + 优先级） |
| G-2 | 工具输出靠 `maxOutputChars` 截断 + `presentationMeta` | 结构化输出：分页/分块/引用锚点（`locations`）；`meta` 扩展（页数/格式/耗时） | ① 扩 `render`/`presentationMeta` ② **注意 replay 安全**：`schema.ts:594-597` 明确 `presentationMeta` 可能在 REPLAY 时以旧 schema 的 args 调用 → **必须永不抛错**，否则日志回放崩毁 |
| G-3 | `MarkitdownResult` 只有 `markdown/title?/meta{chars,source}` | 结果模型化：`pages[]`、`warnings[]`、`truncated`、`format` | ① 与 C-1 协议 schema 联动定义 ② 保持向后兼容（新增可选字段） |

---

## 八 建议路线图

**阶段 1 — 低代价高收益（无前置，建议立刻排期）**

| 序 | 项 | 理由 |
|---|---|---|
| 1 | B-1 / B-3（事件载荷 + `ocrApplied`） | 只改声明与透传；不做等于"盲飞" |
| 2 | A-4（批量分层超时） | 纯配置 + 常量改动；直接消除 40 分钟悬挂 |
| 3 | F-1（`lib` 新鲜度门禁） | 消除"全绿但产物陈旧"这一类复发 |
| 4 | C-2（Config 键集一致性检查） | 已有 `TESTPLAN` T0-8 用例，落地成本低 |

**阶段 2 — 需前置或决策**

| 序 | 项 | 前置 |
|---|---|---|
| 1 | A-1 / A-2 / A-3（传输与并发统一） | 先完成 `interactive` 实跑（P3-3） |
| 2 | D-1 / D-2（SourcePolicy 双层 + 网络开关） | 先修 `FRAGILITY.md` P0-0 |
| 3 | B-4 / B-5（分层健康 + 性能基线） | 基线可先做，健康分层待 A-1 |
| 4 | E-1（批量预算制） | 无 |

**阶段 3 — 工程化收口**

| 序 | 项 | 说明 |
|---|---|---|
| 1 | C-1 / C-3 / C-4（跨语言契约单一真源） | 一次投入，长期消除漂移类问题 |
| 2 | E-2 / E-3（分片 + 流式事件） | 依赖 C-1 的错误契约 |
| 3 | F-2 / F-3（测试固化 + 同步演练） | 依赖 `TESTPLAN` 的 L1/L2 落地 |
| 4 | F-4 / G-1（MCP 兜底 + 提供者替换演练） | 按过渡期需要启用 |

> 判据口径：每条落地后须能在 `TESTPLAN.md` 找到对应可复现用例，否则视为未完成（与 `FRAGILITY.md` 的处理纪律一致）。
