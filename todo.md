# markitdown × DSH 集成与中间层适配 · todo

> **决策基线（2026-09-14 锁定，未明确变更前不重开）**：方案 A 三包约定 + Python Worker 桥 ｜ Python 走宿主隔离 venv（不污染系统）｜ OCR 走 `ctx.credentials` + OpenAI 兼容端点（`ctx.llm` 无 OpenAI facade，直桥已否决）｜ **Vendoring**：markitdown 一方源码 vendor 进集成树，不依赖 PyPI ｜ **双模传输**：`collect`（默认，每请求单进程）/ `interactive`（长驻 NDJSON，配置开启）｜ **不做 `ctx.jobs` 后台化**（内联并发 + 上限 + 截断三层限流已够）｜ 验收用**行为断言**，不锚定 `fiber.state` 字符串 ｜ **未发布 npm 前不采用 npm 方式加载插件**（三包间一律 `link:` 本地引用）｜ **补丁重放不依赖外部 `patch`**（`patch.exe` 只在 Git Bash MSYS 内，不在 Windows PATH）
> **约束基线**：`约束/00-总纲`（三包约定、接缝四元素、patch 整行替换、Waterfall `next()`、Fail-Closed）+ `约束/示例`（工具十四步、避坑清单）
> **测试策略**：按全局约定，实现过程跳过测试，集中到 `dsh-integration/TESTPLAN.md` 统一验收

**文档分工（勿重复记录）**

| 文档 | 职责 |
|---|---|
| **本文件** | **计划**：加固 + 进阶 + 验证，唯一执行清单 |
| `dsh-integration/FRAGILITY.md` | 缺陷清单（P0/P1/P2，含证据锚点）——**本文件的 H 系列即其落地** |
| `dsh-integration/OPTIMIZATION.md` | 进阶清单（A–G 主题）——**本文件的进阶段即其落地** |
| `dsh-integration/TESTPLAN.md` | 用例与判据（L0–L4）——**本文件的 V 系列即其实机部分** |
| `dsh-integration/CAPABILITY.md` | 能力现状（三态矩阵） |
| `dsh-integration/ISSUES.md` | 故障记录与根因订正 |

---

## 阅读约定（防"逻辑跳跃"）

本文档中**每一个待办项都必须自带"关键实现环节"**，且满足：

1. **不允许以目标代替步骤**——不能只写"实现 X"，必须写出「改哪个文件的哪个函数 → 依赖什么前置 → 如何验证」。
2. **每一步都要有落点**：`文件:行` / 函数名 / 可复现命令。
3. **验收判据必须可执行**：给出命令 + 期望输出（或明确标注"需人工观察 + 观察什么"）。
4. **凡涉及"改动会连带影响的地方"，必须显式列出**（见「五、改动纪律」，违反即产生隐患）。
5. **不重复记录**：缺陷的完整机理写在 `FRAGILITY.md`，进阶的完整取舍写在 `OPTIMIZATION.md`；本文件只写**怎么做 + 怎么验**。

**状态标记**：`[ ]` 待办 ｜ `[x]` 完成 ｜ `[!]` 阻塞（缺外部输入）｜ `[-]` 已撤销

---

## 〇、现状快照（事实，供定位；非计划）

### 0.1 已交付物

| 位置 | 内容 |
|---|---|
| `dsh-integration/dsh-markitdown/` | 定义包 `@kiwifruit/dsh-markitdown`：抽象类 + 4 类错误子类 + `markitdown/converted` 事件 + 类型 |
| `dsh-integration/dsh-markitdown-worker/` | 提供者包 `@kiwifruit/dsh-markitdown-worker`：`CollectTransport` / `InteractiveTransport` + 14 键 Config |
| `dsh-integration/dsh-tool-markitdown/` | 消费者包 `@kiwifruit/dsh-tool-markitdown`：`markitdown_convert` / `markitdown_convert_batch` + 5 键 Config |
| `vendor/markitdown/` | vendored 一方源码（核心 + `markitdown_ocr`），`VENDORED_VERSION` 锚点 |
| `vendor/bridge/markitdown_bridge/` | 薄壳 worker：`service.py`（共享）/ `__main__.py`（长驻）/ `single.py`（单发） |
| `dsh-integration/docs/{bridge,markitdown-core,ocr-plugin}/` | api-plus 契约文档 + `api_manifest.json` |
| `dsh-integration/.venv/` | 隔离 venv（按 `vendor/bridge/requirements.lock`） |
| `scripts/sync-vendor.ps1` | 上游同步：备份 → 刷新 → **`--check` 预校验** → 重放 `scripts/vendor-patches/*.diff` → 更新锚点 |
| `scripts/apply-vendor-patches.py` | unified diff 校验/重放器（**无外部 `patch` 依赖**） |
| `dsh-integration/scripts/dev-reload.ps1` | 开发循环：`build:lib` → `remove`+`add` → `dump-config` 校验（含重试/残骸清理） |
| `dsh-integration/scripts/fix-paths.ps1` | 跨机重写 2 处 `link:` + `tsconfig.base.json` 的 `paths`（幂等，`-DryRun` 可预演） |
| `dsh-integration/{CAPABILITY,FRAGILITY,OPTIMIZATION,TESTPLAN}.md` | 能力矩阵 / 脆弱面 / 进阶方向 / 测试大纲 |

### 0.2 profile `web` 当前生效值（`C:\Users\kiwif\.dsh\profiles\web\`）

```yaml
# cordis.patch.yml —— worker 行（14 键全量重述，符合"整行替换无深度合并"）
pythonPath: D:/Git/github/markitdown-main/dsh-integration/.venv/Scripts/python.exe
vendorPath: D:/Git/github/markitdown-main/vendor
transportMode: collect
allowedReadRoots: [D:/Git/github/markitdown-main/Test]   # 名义 Fail-Closed —— ⚠️ 实际被 SCHEME_RE 短路，见 H-1
expectedVendorVersion: ''                                 # 锚点未接线，见 H-5
# tool 行（5 键）：ocrBaseUrl: ''  ocrModel: ''  →  OCR 处于「接线就绪、未通电」
```

### 0.3 已知盲区与环境坑（都是踩过的）

| # | 事实 | 含义 |
|---|---|---|
| 1 | `dsh --dump-config` **不执行 `apply`** | 捕获不到 `defineTool` 的 schema 编译错误 → schema/注册类改动**必须实机启动**验证 |
| 2 | 校验器对 `null` / `undefined` / 缺键三种处理不同 | 缺键 PASS ／ `undefined` 使**整对象**报 `must be a lossless JSON object` ／ `null` 报属性级 `must be a string`（`json-schema.ts:568-571,607`） |
| 3 | 非优雅终止留锁 | `$DSH_HOME/profiles/node_modules.lock`（内容=持有者 PID）；确认 PID 已死后删锁即恢复 |
| 4 | WorkBuddy Bash 内无法启动 dsh | `node-safe-delete-shim` 拦截（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）→ 启动类验证须在 K 的终端做 |
| 5 | 测试素材不在 `vendor/` | OCR 样本在 `packages/markitdown-ocr/tests/ocr_test_data/`（27 个）；白名单只允许 `Test/` → 实测前须先拷贝 |
| 6 | `dsh plugin add file:` 是**目录拷贝** | 改代码后必须 `build` + `remove`+`add` 才生效；同版本不自动刷新 |
| 7 | `patch.exe` 不在 Windows PATH | 只在 Git Bash MSYS（`/usr/bin/patch.exe`）→ 一切脚本/文档**禁用 `patch`**，用 `apply-vendor-patches.py` |
| 8 | pnpm 交换目录偶发 `EPERM` | `remove` 成功 + `add` 失败 → **该包从 profile 消失**（`dependencies` 与 `bundles` 双失） |
| 9 | `SCHEME_RE` 匹配盘符 | `/^[a-zA-Z][a-zA-Z0-9+.-]*:/` 匹配 `D:` → 白名单守卫对 `D:/...` **不触发**（`FRAGILITY.md` F-1） |
| 10 | 沙箱 `read-only` **限写不限读** | bwrap `--ro-bind / /`、landlock `readOnly:['/']` → 白名单是唯一读控制面，**无补偿层** |

### 0.4 覆盖矩阵（保证「一步到位」，无遗漏、无重复）

**每一行的右侧就是它的唯一落点**；同一件事不在两处立项。

| 来源 | 条目 | 落点 |
|---|---|---|
| `FRAGILITY.md` | F-1 白名单被 `SCHEME_RE` 短路 / F-2 `file://` 读本地 | **H-1** |
| | F-3 错误码→错误类映射丢语义 | **H-2** |
| | F-4 vendor 版本锚点未接线 | **H-5** |
| | F-5 `PLUGIN_INTERFACE_VERSION` 双真源 | **C-3** |
| | F-6 `lib/` 无新鲜度门禁 / F-7 目录拷贝静默陈旧 / F-9 `Config` 导出名无门禁 / F-19 包从 profile 消失 | **H-3** |
| | F-8 配置键三处手工同步 | **H-4** |
| | F-10 批量超时线性放大 | **H-6**（= `OPTIMIZATION` A-4） |
| | F-11 collect 协议"非协议行"被跳过 / F-12 `collectStdoutBytes` 超限 | **H-7** |
| | F-13 `restartOnCrash` 仅 interactive 消费 | **H-8**（= `OPTIMIZATION` A-5） |
| | F-14 `interactive` 未实跑 | **V-3** |
| | F-15 事件无消费者 | **B-2** |
| | F-16 `meta.source` 泄露完整路径 | **H-9** |
| | F-17 `patch` 不在 PATH | ✅ 已修（归档 A-6） |
| | F-18 陈旧锁 | **H-10** |
| | F-20 机器相关路径 / F-22 无 `prepare` | **H-11** |
| | F-21 包名被 registry 劫持 | ✅ 已修（归档 A-7） |
| | F-23 热重载残留 | **V-6** |
| | F-24 profile 根 `_tmp_*` 残骸 / F-28 `__pycache__` 扩散 | **H-10** |
| | F-25 网络面未声明 | **D-2** |
| | F-26 批量无进程级 per-item 重试 | **E-2** |
| | F-27 `workerEnv` 任意注入 | **D-4** |
| `OPTIMIZATION.md` | A-1 长驻 worker 为默认 | **A-1** |
| | A-2 并发语义统一 / A-3 容量闸与背压 | **A-2**、**A-3** |
| | A-4 分层超时预算 → H-6 ｜ A-5 重启语义统一 → H-8 | （同上） |
| | B-1 事件载荷扩展 | **B-1** |
| | B-2 事件消费者 / B-3 `ocrApplied` / B-4 分层健康 / B-5 性能基线 | **B-2**、**B-3**、**B-4**、**B-5** |
| | C-1 跨语言协议 schema / C-2 由 Schema 生成 yml / C-3 接口常量收敛 / C-4 api-plus 扩展 | **C-1**、**C-2**、**C-3**、**C-4** |
| | D-1 SourcePolicy 双层（含 D-3 `data:` 上限） / D-2 网络开关 / D-4 env 白名单 | **D-1**、**D-2**、**D-4** |
| | E-1 批量预算制 / E-2 分片 + 重试 / E-3 流式事件 / E-4 分片通知 | **E-1**、**E-2**、**E-3**、**E-4** |
| | F-1 `lib` 门禁 → H-3 ｜ F-2 测试固化 → V-2 ｜ F-3 上游溯源 → **H-12** ｜ F-4 MCP 兜底 → **F-4** | （同上） |
| | G-1 提供者替换与选择 / G-2 结构化输出（replay 安全） / G-3 结果模型化 | **G-1**、**G-2**、**G-3** |
| 历史遗留 | P0-2 `title` 复测 / P1-1 OCR 实测 / P1-3 运行时断言 / P2-1 热重载 / P2-2 替换演练 / P2-3 测试补齐 / P2-4 同步演练 / P3-2 docstring / P3-3 interactive / P3-4 乐享核对 | **V-4**、**V-5**、**V-1**、**V-6**、**V-7**、**V-2**、**V-8**、**F-5**、**V-3**、**V-9** |

---

## 一、加固（H 系列 —— 消除缺陷与静默降级）

### [ ] H-1 读路径围栏：先判盘符、再判 scheme（含 `file:` 归一）

**为什么**：`SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/`（`dsh-markitdown-worker/src/index.ts:43`）**同样匹配 Windows 盘符**（`D:` = 字母+冒号），导致 `:461`（单文件）与 `:477`（批量，经 `assertLocalPaths:131-134`）的白名单守卫对 `D:/...` **不触发**；且 `file:` 被当 URI 放行，而 markitdown 会把它解析成真实路径去读（`vendor/markitdown/markitdown/_markitdown.py:486-498`）。补偿层不存在——沙箱 `read-only` **限写不限读**（`packages/sandbox/sandbox-local/src/profiles.ts:17,30-35`）。完整机理见 `FRAGILITY.md` F-1/F-2。

**关键实现环节**

1. **判定顺序改为「先盘符、再 scheme」**：新增 `const DRIVE_RE = /^[a-zA-Z]:[\\/]/`；`DRIVE_RE.test(s)` 为真 → **必走白名单**（不因包含 `:` 而被当 scheme）
2. **收紧 scheme 正则**：要求 `//` 或 scheme 长度 ≥2（如 `/^[a-zA-Z][a-zA-Z0-9+.-]+:/`），避免单字母误判；两处使用点（`:461`、`assertLocalPaths:133`）统一走同一个新谓词 `isLocalPath(s)`
3. **`file:` 归一后同过白名单**：在 worker 侧把 `file://` 解析为路径再 `assertPathAllowed`；或在 `SourcePolicy`（D-1）里声明 `file:` 为禁止/需白名单，二者择一并在 `description` 写明
4. **同步加固 bridge 侧**（真正的 `open()` 执行者）：见 D-1 的双层校验；H-1 只修 TS 侧短路
5. **补可触发负例**：`TESTPLAN.md` T2-9d（断言 `SCHEME_RE.test('D:/x') === false`）与 T4-4（须用相对/POSIX 形式书写才可触发）

**验收判据**：① `isLocalPath('D:/x')===true` 且 `isLocalPath('file:///C:/x')===true`；② 传 `D:/Git/.../Test` **外**路径 → 报 `[sandbox: file access denied outside allowed read roots]`；③ T2-9d 由 FAIL 转 PASS
**前置**：无 ｜ **连带影响**：`TESTPLAN.md` T2-9b/T2-9c/T4-4 判据、`CAPABILITY.md` #8 状态（已改标 ⚠️）

---

### [ ] H-2 错误契约补全与分层

**为什么**：bridge 定义 6 个错误码（`vendor/bridge/markitdown_bridge/service.py:28-33`），TS 侧只显式映射 3 个（`dsh-markitdown-worker/src/index.ts:97-110`）→ `MARKITDOWN_INVALID_PARAMS` 与 `MARKITDOWN_INTERNAL` 落 `default` → `MarkitdownUnavailableError`，**参数错误被报成"服务不可用"**。另：批量超 20 抛裸 `Error`（`dsh-tool-markitdown/src/index.ts:227-229`），同样落 `default`。

**关键实现环节**

1. 定义包新增 `MarkitdownInvalidParamsError`（继承 `MarkitdownError`），或明确"参数类错误复用 `MarkitdownConversionFailedError`"——**必须二选一并写进定义包 JSDoc**
2. `failFromBridge` 补 `case 'MARKITDOWN_INVALID_PARAMS'`；`MARKITDOWN_INTERNAL` 独立分支（保留 `Unavailable` 但消息前缀区分）
3. `default` 分支改为**不再静默归为 Unavailable**：保留兜底，但附原始 `code`（避免未来新增码再次被误分类）
4. tool 侧把裸 `Error` 换成 `MarkitdownInvalidParamsError`（依赖第 1 步）
5. 与 C-1 联动：错误码集合将来由协议 schema 生成，本项先落地行为

**验收判据**：`TESTPLAN.md` T2-10 覆盖 6 码逐一断言类别；实跑"批量传 21 条"→ 期望 `INVALID_PARAMS` 类别而非 Unavailable
**前置**：无 ｜ **连带影响**：定义包类型导出、`CAPABILITY.md` #10、四次转换的错误文案

---

### [ ] H-3 产物与 profile 完整性门禁

**为什么**：三类"全绿但实际是旧的/缺的"：① `src` 改了忘 `build:lib` → profile 拷的是旧 `lib`，而 `dump-config` **不执行 `apply`**（`FRAGILITY.md` F-6）；② `dsh plugin add file:` 是目录拷贝，不重装即静默陈旧（F-7）；③ `Config` 导出名一旦被改，Schema 校验与默认值填充**静默跳过**（F-9）；④ EPERM 中断会让包**从 profile 消失**（F-19）。

**关键实现环节**

1. 新增 `dsh-integration/scripts/check-artifacts.py`（或并入 dev-reload）：逐包比对 `src/**/*.ts` 与 `lib/**/*.js|d.ts` 的 **mtime**（`src` 新于 `lib` 即 exit 1）
2. 同一脚本加**导出名断言**：从 `lib/index.d.ts` 提取 `name` / `inject` / `Config` 三个导出名，缺任一即 exit 1（把"铁律"变成门禁）
3. 同一脚本加 **profile 完整性断言**：`dsh --profile web --dump-config` 输出中三个 id 是否齐（`markitdown-worker`、`tool-markitdown` 各有 1 条；定义包为 library 不进树）——不齐则提示"某包已从 profile 消失，需重装"
4. 接入 `dev-reload.ps1` 前置（`-SkipVerify` 可跳过）与 `TESTPLAN.md` 新用例
5. 与 C-2/H-4 联动：键集一致性检查用同一脚本承载

**验收判据**：① 故意改 `src` 不 build → 脚本 exit 1 且指出具体包；② 从 `d.ts` 删掉 `Config` 导出（临时）→ exit 1；③ 手工移除 profile 某包 → exit 1；④ 正常状态 exit 0
**前置**：无 ｜ **连带影响**：`dev-reload.ps1`、`README` 开发循环小节

---

### [ ] H-4 配置键集一致性门禁

**为什么**：`Config` 键分布三处——`Schema.object({})` / 包内 `cordis.yml` / profile `cordis.patch.yml`；patch 覆盖**无深度合并**（整行替换），漏键即丢配置（`FRAGILITY.md` F-8）。当前靠人工比对。

**关键实现环节**

1. 写脚本：解析三包的 `Config = Schema.object({...})` 键集 → 与包内 `cordis.yml` 键集比对 → 与 profile `cordis.patch.yml` 对应行键集比对
2. 三处键集必须**完全一致**（含注释掉的键不计）；不一致打印差集并 exit 1
3. 并入 H-3 的脚本（同一入口 `check-artifacts.py`），或独立 `check-config-keys.py`
4. 与 C-2 联动：后续由 Schema **生成** yml 默认块，门禁保留为兜底

**验收判据**：`TESTPLAN.md` T0-8 转绿；故意删 profile 某键 → exit 1 且列出缺键名
**前置**：无 ｜ **连带影响**：三包 `cordis.yml`、profile `cordis.patch.yml`

---

### [ ] H-5 vendor 版本锚点接线

**为什么**：`expectedVendorVersion: ''`（profile）→ 仅 `PLUGIN_INTERFACE_VERSION` 被强制，**上游同步导致的 vendor 版本漂移不会被检测**（`FRAGILITY.md` F-4）。锚点文件已存在（`vendor/markitdown/VENDORED_VERSION` → `markitdown@0.1.8b1+ocr@0.1.1b1`），只是未接线。

**关键实现环节**

1. profile `cordis.patch.yml` 的 `worker` 行把 `expectedVendorVersion` 填为锚点值（**该行 14 键全量重述**）
2. 明确失败形态：锚点不符时 bridge 在 `init` 阶段报 `MARKITDOWN_VERSION_MISMATCH` → worker 映射为 `MarkitdownUnavailableError`（已具备）
3. 与 `sync-vendor.ps1` 联动：同步后锚点会变 → 提示"需同步更新 profile 该键"（脚本末尾已有类似提示，补精确键名）
4. 与 C-3 联动：`PLUGIN_INTERFACE_VERSION` 收敛为单一来源后，此键值也应由同一来源生成

**验收判据**：① 填对 → `init` 通过、转换正常；② 故意填错版本 → 明确 `MARKITDOWN_VERSION_MISMATCH`（而非静默继续）
**前置**：无（可选增强） ｜ **连带影响**：profile 该行、`CAPABILITY.md` #9 状态

---

### [ ] H-6 超时模型：分层预算（替代线性放大）

**为什么**：`timeoutMs * max(1, sources.length)`（`dsh-markitdown-worker/src/index.ts:231`）→ 20 源 × 120s = **40 分钟**；且超时会 `terminate()` **整个进程**，逐项超时无法隔离（= `OPTIMIZATION.md` A-4）。

**关键实现环节**

1. Config 拆两个键：`perItemTimeoutMs`（默认 = 现 `timeoutMs`）与 `batchTimeoutMs`（默认取上限，如 300000）
2. `convertBatch` 有效超时 = `min(batchTimeoutMs, perItemTimeoutMs * N)`
3. 逐项超时**不终止整批**：需 E-2 的分片或 bridge 侧逐项计时配合；本项先落地"整批上限"，逐项隔离留 E-2
4. 三处 yml + Schema 同步（纪律 3）
5. 与宿主工具超时对齐：确认宿主对单次工具调用的超时上限，`batchTimeoutMs` 不得超过

**验收判据**：20 源批量在 `batchTimeoutMs` 到点即返回明确超时错误（而非挂 40 分钟）；`TESTPLAN.md` T2-4 扩充批量场景
**前置**：需先查宿主工具超时上限（`packages/core/tools`） ｜ **连带影响**：worker Config 14→16 键、三处 yml、profile 行

---

### [ ] H-7 collect 协议鲁棒性

**为什么**：① 解析从末尾向前找含 `ok` 的行（`src/index.ts:137-151`），"非协议行"被 `continue` 跳过 → 上游库 `print`/warning 污染 stdout 时**可能吞掉真实错误行**（F-11）；② `collectStdoutBytes` 超限即 Fail-Closed（已决策），但错误文案未说明"是输出过大"（F-12）。

**关键实现环节**

1. 明确"非协议行"的处置：**要么**记录到 stderr 诊断供排查，**要么**计入"跳过的行数"并在最终失败时一并报告——不得静默丢弃
2. 超限错误改为可识别文案：从 `Unavailable` 拆出"输出超过 `collectStdoutBytes`"的明确消息（含限制值与来源）
3. 边界：bridge 崩溃前已有部分 stdout → 明确"无 `ok` 行即 `bridge produced no protocol reply`"（现行为），补上已读字节数
4. 加 Python 侧护栏：确认 `__main__/single` 不向 stdout 打非 JSON 内容（`single.py:41-54` 已统一 emit_json；补一条 grep 断言进 CI）

**验收判据**：`TESTPLAN.md` T3-6（畸形请求）扩充"stdout 混入杂质行"场景 → 期望不吞错；T3-7（超限）文案含限制值
**前置**：无 ｜ **连带影响**：错误文案、`CAPABILITY.md` #4 备注

---

### [ ] H-8 传输模式语义统一（`restartOnCrash`）

**为什么**：`restartOnCrash` 只被 `InteractiveTransport` 消费（`src/index.ts:287-292`）；`collect` 每请求新进程 → 该配置在 collect 下**无任何效果**，用户以为设了就有用（F-13 = `OPTIMIZATION.md` A-5）。

**关键实现环节**

1. 二选一并写进 `Schema` 的 `.description()` 与 README：
   - **方案甲（推荐）**：`collect` 下语义定义为"本请求失败后是否重试一次新进程"
   - **方案乙**：显式声明"collect 模式不支持重启"，并在启动/配置校验时对"collect + restartOnCrash=true"给出可诊断提示
2. 若选甲：在 `CollectTransport.runOnce` 失败分支接入一次重试（受 `restartOnCrash` 门控，且只重试一次）
3. 三处 yml 描述同步；`CAPABILITY.md` #5 状态更新

**验收判据**：`collect` + `restartOnCrash: false` 时失败不重试；`true` 时重试一次（可用坏端点 OCR 触发）；`TESTPLAN.md` T2-6c
**前置**：方案决策（需 K 确认甲/乙） ｜ **连带影响**：worker Config 描述、README、CAPABILITY #5

---

### [ ] H-9 模型可见信息脱敏

**为什么**：`meta.source` 原样回传模型与 UI（`vendor/bridge/markitdown_bridge/service.py:165-168`），含完整本地路径（用户名/目录结构）；对比 bridge 在 `OSError` 分支刻意只留 `errno`（`:163-164`）——**同一模块两种不一致的信息暴露口径**（F-16）。

**关键实现环节**

1. 决策口径：`meta.source` 保留原样（模型需知道转换的是哪个文件）**还是**改为"basename + 可配置前缀脱敏"
2. 若脱敏：新增 worker Config `redactSourcePaths: boolean`（默认 `false` 保持兼容），在 worker 侧对 `meta.source` 处理，**不改 bridge**（避免 vendored 改动 + diff 归档成本）
3. 与 G-3（结果模型化）联动：新增 `meta.displaySource`
4. 文档：`README` 安全边界小节

**验收判据**：开启后模型可见的 `meta.source` 不含绝对路径；关闭时行为与现状逐字一致
**前置**：口径决策（需 K 确认） ｜ **连带影响**：worker Config、工具输出 schema（`meta.properties.source` 描述）

---

### [ ] H-10 环境韧性（锁 / 残骸 / 缓存）

**为什么**：`FRAGILITY.md` F-18（陈旧锁致启动失败）、F-24（profile 根 `_tmp_*` 堆积 30+）、F-28（`__pycache__` 随 vendored 目录扩散并干扰 `diff -rq` 判定）、F-19（EPERM 中断）。

**关键实现环节**

1. `dev-reload.ps1` 增加**锁预检**：发现 `profiles/node_modules.lock` 时打印持有者 PID，并在 PID 不存在时提示可删（**不自动删**，避免误删活锁）
2. `dev-reload.ps1` 已有的 `*_tmp_*` 残骸清理扩展到 profile 根（当前只清 `node_modules/@scope/`）
3. `sync-vendor.ps1` 在复制前排除 `__pycache__`（或复制后清理），使 `diff -rq` 结果干净
4. 在 `README` 记录"验证环境限制"与"退出用 `Ctrl+C`"

**验收判据**：`dev-reload.ps1 -DryRun` 输出包含锁检查结果；同步后 `diff -rq` 无 `__pycache__` 噪音
**前置**：无 ｜ **连带影响**：两个脚本、README

---

### [ ] H-11 可移植性：机器相关路径的单一来源

**为什么**：`FRAGILITY.md` F-20（2 处 `link:` 绝对路径 + `tsconfig.base.json` 的 `paths` 指向 profile 的 node_modules；`fix-paths.ps1` 自身也含机器相关默认值）、F-22（无 `prepare`，`github:` 安装路径会失败）。

**关键实现环节**

1. `fix-paths.ps1` 的默认值改为**从当前环境推导**（`$HOME`/`$env:DSH_HOME`/脚本位置），机器相关字符串集中到一个 `$defaults` 块并显式注释
2. 增加 `-Verify` 模式：只报告"哪些文件含机器相关路径"，不改写（供 CI 用）
3. `tsconfig.base.json` 的 `paths` 决策：改为指向 `dsh-integration/node_modules`（若可解析）或保留并在 README 标注为"已知跨机成本"
4. `package.json` 的 `files`/`scripts` 复审：确认无 `prepare` 依赖（`file:` 安装不触发），并在 README 写明 `github:` 路径不受支持

**验收判据**：`fix-paths.ps1 -DryRun` 在当前机器上 3 文件全部 `unchanged`（幂等）；`-Verify` 在伪造的机器相关路径上报告命中
**前置**：无 ｜ **连带影响**：`tsconfig.base.json`、两包 `package.json`、README

---

### [ ] H-12 vendored 上游溯源与升级报告

**为什么**：锚点只记版本号，无 upstream commit/tag；同步时无"上游改了什么"的报告（`OPTIMIZATION.md` F-3）。

**关键实现环节**

1. `VENDORED_VERSION` 增加 `UPSTREAM_COMMIT=` 字段（取自 vendoring 时的上游来源），并让 `sync-vendor.ps1` 的锚点重发逻辑包含该字段
2. `sync-vendor.ps1` 在刷新前后各算一次 `vendor/markitdown` 的哈希清单，输出"本次同步变更了哪些文件"（即上游 diff 报告）
3. 报告落盘 `vendor/.sync-report-<stamp>.txt`（与该次的 `vendor/.backup-*` 对应）
4. 与 P3-2（docstring 覆盖率）共用 `api-plus` 报告输出

**验收判据**：跑一次同步 → 产出报告且列出变更文件；无变更时报告为空
**前置**：V-8（实跑同步） ｜ **连带影响**：`sync-vendor.ps1`、锚点文件格式（`VENDORED_VERSION`）

---

## 二、进阶（A–G 系列 —— 与 `OPTIMIZATION.md` 同编号）

### A 传输与并发

| ID | 项 | 关键实现环节 | 验收判据 | 前置 |
|---|---|---|---|---|
| **A-1** | `interactive` 长驻 worker 为默认 | ① 先完成 V-3 实跑 ② 定"何时必须回退 collect"（如 OCR 崩溃隔离）③ profile `transportMode` 切 `interactive` ④ README 更新默认值说明 | 连续 3 次转换后仅 1 个常驻 python 进程；`Ctrl+C` 无残留 | **V-3** |
| **A-2** | 并发语义统一（`maxConcurrent` 两模式生效） | ① 在 Transport 抽象层引入**容量闸**（信号量/令牌桶）② `collect` = 最多 N 个并发进程；`interactive` = 进程内 N 线程 ③ 两种实现共用同一 `maxConcurrent` 语义 | 并发 5 个调用时 collect 下 python 进程数 ≤ N；`TESTPLAN.md` 新用例 | A-1（语义先定） |
| **A-3** | 容量闸与背压可观测 | ① 队列深度进 `health.pending` ② 超限排队而非无限起进程 ③ 排队超时策略 | `health` 返回真实 pending；并发超限时不 OOM | A-2 |

> A-4（分层超时）已归 **H-6**；A-5（重启语义）已归 **H-8**。

### B 观测与可诊断（代价最低，建议最先做）

| ID | 项 | 关键实现环节 | 验收判据 | 前置 |
|---|---|---|---|---|
| **B-1** | 事件载荷扩展 | ① 扩 `MarkitdownConvertedPayload`（`dsh-markitdown/src/index.ts:78-84`）加 `durationMs`/`format`/`bytes`/`attempts`/`transport` ② worker 侧计时（spawn→exit）③ bridge 回传 `format` 与真实字节数 | 一次转换后事件含全部新字段且 `durationMs > 0` | 无 |
| **B-2** | 事件消费者 | ① 决策：worker 内订阅 or 独立观测插件 ② 落 metrics 或结构化日志 ③ **若决定不需要 → 删除声明**（F-15：避免死面） | 至少一处消费者可见；或声明被移除并记录决策 | 决策 |
| **B-3** | `ocrApplied` 如实上报 | ① bridge payload 加 `ocrApplied`（区别于"传了 OCR 选项"，`src/index.ts:467` 现语义偏弱）② worker 传递 | `ocr: true` 但端点未配置时报错（H-2/P0-1 已保证）；正常 OCR 时 `ocrApplied === true` | 无 |
| **B-4** | 分层健康 | ① 拆 `liveness`（进程/通道）与 `readiness`（依赖+版本+格式可用性）② `readiness` 纳入 `VENDORED_VERSION` 与依赖可用性 ③ collect 的 health 不再跑完整 `init` 探针 | `health` 返回两级；依赖缺失时 `readiness=false` 且有原因 | A-1（collect 侧先简化） |
| **B-5** | 性能基线 | ① 固定素材集（`Test/` + `ocr_test_data/`）② 脚本化跑分（单文件 / 批量 N / OCR）③ 结果入库为回归基线，据此定 A-1 默认值与 H-6 阈值 | 产出 p50/p95 记录文件；后续改动可比对 | 无 |

### C 契约与配置单一真源

| ID | 项 | 关键实现环节 | 验收判据 | 前置 |
|---|---|---|---|---|
| **C-1** | 跨语言协议 schema | ① 单点定义 op 列表 / 错误码 / payload 字段（JSON Schema 或 TS 常量 + 生成器）② 生成 `bridge-protocol.ts` 与 `bridge_protocol.py` ③ CI 门禁：不一致 exit 1 | 改一侧不改另一侧即门禁失败；Python 6 码与 TS 映射一一对应 | 无 |
| **C-2** | 由 Schema 生成 yml 默认块 | ① 写生成器（读 `Schema.object({})` → 输出 yml 片段）② 接入三包 `cordis.yml` ③ 与 H-4 门禁互为兜底 | 手工改 yml 后门禁报错；重新生成即恢复 | H-4 |
| **C-3** | `PLUGIN_INTERFACE_VERSION` 收敛 | ① 随 C-1 进协议 schema ② 启动自检从同一来源读 ③ 加"锚点 ↔ 代码常量"一致性断言（现双真源：`vendor/markitdown/VENDORED_VERSION` vs `dsh-markitdown-worker/src/index.ts:42`） | 两侧不一致时门禁失败 | C-1 |
| **C-4** | api-plus 扩展为协议 manifest | ① 在 `api_manifest.json` 加 protocol 段 ② `--check` 增比对 TS 侧常量 | `--check` 同时覆盖文档↔代码与跨语言契约 | C-1 |

### D 安全与策略面（前置：H-1）

| ID | 项 | 关键实现环节 | 验收判据 | 前置 |
|---|---|---|---|---|
| **D-1** | `SourcePolicy` 双层校验 | ① 定义策略结构：盘符路径 / URI scheme 白名单 / 网络开关 / **大小上限（含 `data:` URI，D-3）** / 扩展名白名单 ② TS 侧透传到 bridge ③ **bridge 在 `_convert_one` 前 assert**（真正的 `open()` 执行者）④ 双层拒绝文案保持一致 | 绕过 TS 层直调 bridge 仍被拒；`data:` 超限被拒 | **H-1** |
| **D-2** | `allowNetwork` 开关（默认关） | ① 加 worker Config，默认 `false` ② bridge 侧拦截非 allow 的 `http(s)` ③ 工具 `description` 显式声明边界（现 bridge 直接支持 `http(s)`，`_markitdown.py:569`） | 默认关闭时 `http(s)` 源被明确拒绝；开启后可用 | H-1 |
| **D-4** | `workerEnv` 白名单化 | ① 定义允许键集（如 `PYTHONUTF8`、代理类）② 非法键在 `apply` 期 fail loud | 传入非法键启动即报错；合法键生效 | 无 |

### E 批量语义与流式

| ID | 项 | 关键实现环节 | 验收判据 | 前置 |
|---|---|---|---|---|
| **E-1** | 批量预算制（替代 20 硬限） | ① 三维预算：条数 + 总字节 + 总时长，配置化 ② 硬限降为默认上限 ③ 超预算抛 `MarkitdownInvalidParamsError`（依赖 H-2） | 可配 50 条；超字节预算被明确拒绝 | H-2 |
| **E-2** | 分片 + per-item 重试 | ① 全批分片为多个进程批次（解决"整批单进程，崩溃即全败"，`service.py:191-196` 的隔离仅在进程内）② 仅对**可重试错误码**重试 ③ 重试预算可配 | 单进程崩溃只影响该分片；可重试错误自动重试一次 | C-1（可重试码集合）、H-6 |
| **E-3** | 流式逐项事件 | ① 定义事件类型（`event: item-done`）；协议已支持 `event` 字段（`src/index.ts:141,339`，Python 侧现仅发 `ready`，`__main__.py:31`）② interactive 下逐条回 ③ collect 下能力探测后声明不支持 | interactive 下 20 源批次可见 ≥19 条进度事件 | A-1 |
| **E-4** | 分片结果通知 | ① 依赖 E-3 ② 每完成一批用 `exec.deferContext` 发一条结果附加指令（现只在末尾发一条汇总，`dsh-tool-markitdown/src/index.ts:236-246`）③ 分片数需与模型容忍度平衡（勿刷屏） | 长批次按分片产出通知，且 `tool/result` 顺序正确 | E-3 |

### F 工程化

| ID | 项 | 关键实现环节 | 验收判据 | 前置 |
|---|---|---|---|---|
| **F-1** | `lib` 新鲜度门禁 | 已归 **H-3** | — | — |
| **F-2** | 测试固化（原 P2-3） | 已归 **V-2** | — | — |
| **F-3** | 上游溯源与升级报告 | 已归 **H-12** | — | — |
| **F-4** | MCP 兜底路径（原 P3-1） | ① 挂载 `markitdown-mcp`，**必须 `disabled: true`**（否则与现有提供者构成同能力双路径）② 定义切换开关 ③ 能力对齐表 | 挂载后默认不生效；显式启用可用；同能力不双路径 | 过渡期需要时 |
| **F-5** | bridge docstring 覆盖率（原 P3-2） | 给 `service.py` 模块级常量与私有函数补 docstring → 重跑 `api-plus --check` | 覆盖率自 35.7% 上升且 `--check` EXIT=0（**非阻塞**） | 无 |

### G 定义包与可替换性

| ID | 项 | 关键实现环节 | 验收判据 | 前置 |
|---|---|---|---|---|
| **G-1** | 提供者替换与选择（原 P2-2 深化） | ① 演练：写 mock 提供者（继承 `MarkitdownService`），把原 `markitdown-worker` 行 `disabled: true` 再插入 mock 行 ② 验证消费者**零修改** ③ 定义选择契约（能力探测 + 优先级/成本排序） | mock 生效且消费者源码 diff 为空；选择契约有文档 | 无 |
| **G-2** | 结构化输出（replay 安全） | ① 扩 `render`/`presentationMeta`：分页/分块/引用锚点 ② **`presentationMeta` 必须永不抛错**——`schema.ts:594-597` 明确它可能在 **REPLAY** 时以**旧 schema 的 args** 调用，抛错会使日志回放崩毁 ③ 加 replay 用例 | 旧 schema args 传入时返回 `undefined` 而非抛错 | 无 |
| **G-3** | 结果模型化 | ① `MarkitdownResult` 扩 `pages[]`/`warnings[]`/`truncated`/`format`（与 C-1 协议 schema 联动）② **保持向后兼容**（新增可选字段） | 旧 bridge 送来的结果仍通过输出校验（缺键 PASS） | C-1 |

---

## 三、验证（V 系列 —— 实机与人工，统一验收）

> 用例判据与分层见 `dsh-integration/TESTPLAN.md`（L0–L4）；本节只列**必须在此勾选记录**的动作。

| ID | 项 | 动作 | 判据 | 前置 |
|---|---|---|---|---|
| **V-1** | 运行时行为断言 5 项（原 P1-3） | ① 工具面板出现两工具 ② Agent 会话调 `markitdown_convert`（`Test/sample.txt`）③ 批量 1 正常 + 1 不存在 ④ 传 `Test/` **外**路径（**须用相对/POSIX 形式**，`D:/` 形式当前不触发，见 H-1）⑤ 长任务中途取消观察进程 | 5 项逐条粘贴实测输出 | 无 |
| **V-2** | 测试固化（原 P2-3；= `OPTIMIZATION` F-2） | ① vitest：`output.schema` 编译正/负例、**值校验三态**、transports（超时/中止/崩溃重启/`restartOnCrash:false`）、`resolveOcr`、`SCHEME_RE` 短路（T2-9d）② pytest：`init` 版本门、错误映射四类、`title` 键缺席、`cancel`、批量逐项隔离、OCR 不静默 | `pnpm test` + `pytest` 全绿；**负例确实因被测行为失败** | H-1/H-2 之后写断言才稳定 |
| **V-3** | `interactive` 实测（原 P3-3；A-1 前置） | `transportMode: 'interactive'` → 重启 → 连续多次转换 → 连续两次杀 worker → 卸载 | 首请求后常驻；杀一次自愈；再杀报 `MarkitdownUnavailableError`；`Ctrl+C` 无残留 | 无 |
| **V-4** | `title` 修复复测（原 P0-2） | **`Ctrl+C` 退出** → （若报锁超时先按 0.3-3 删锁）→ 启动 → 用 `Test/sample.txt` 调 `markitdown_convert` | 返回 markdown 且**无** `"value.title" must be a string`；另用 `pdf_scanned_minimal.pdf` 复验无标题路径 | 无 |
| **V-5** | OCR 端到端实测（原 P1-1） | ① 素材入 `Test/` ② **脱离 dsh 的连通探针**（按 `_ocr_service.py:86-100` 真实契约）③ key 存 `ctx.credentials` 的 `markitdown/ocr`（**严禁写进 patch**）④ profile 填 `ocrBaseUrl`+`ocrModel`（5 键全量重述）⑤ 同件对比 `ocr:false/true` ⑥ 检查**关键字段**可读性 | 探针 3 断言全过；`ocr:true` 输出含可读关键字段；`ocr:false` 为空或占位 | `[!]` **需 K 提供端点** |
| **V-6** | 热重载残留（原 P2-1；F-23） | 启动 → 记录 python 进程数 → 改 profile 触发 `patchReload: live` → 再记录 | collect 空闲无 python 进程；改过 interactive 时卸载后 worker 被回收 | 无 |
| **V-7** | 替换提供者演练 | 已归 **G-1** | — | — |
| **V-8** | vendor 同步完整演练（原 P2-4） | 在有写权限的终端跑 `scripts/sync-vendor.ps1`，观察 4 步 | diff `--check` 通过后被重放；锚点 10 行注释头仍在；`--check` EXIT=0；`grep -c ocr_result.error .../_pdf_converter_with_ocr.py` = 6；`diff -rq` 对备份无源码差异 | 无 |
| **V-9** | 乐享知识库交叉核对（原 P3-4） | 用 lexiang 检索 DSH 接缝/子进程约束条目，与 `约束/` 及 host 源码三方比对 | 产出差异清单；冲突以 **host 源码**为准并回填 `约束/漂移修正提案` | 无 |
| **V-10** | 门禁全绿基线 | 依次跑：三包 `build:lib` → `api-plus --check` ×3 → `apply-vendor-patches.py --check` → `check-artifacts.py`（H-3）→ `dump-config` | 全 EXIT=0；记录为验收基线 | H-3/H-4 |

---

## 四、已完成（归档，勿重开）

| ID | 项 | 关键证据 |
|---|---|---|
| **A-6** | 消除 `patch` 外部依赖（`FRAGILITY.md` F-17） | `patch.exe` 只在 Git Bash MSYS；改用 `scripts/apply-vendor-patches.py`；`--check` 5 文件段全通过、重放后与 `vendor/` **逐文件 sha256 一致（5/5）**、单文件篡改负例 exit=1 |
| **A-7** | 三包 scope 化消除包名劫持（F-21） | 无 scope 名实测拉到第三方 `dsh-markitdown@0.1.1`；现三包为 `@kiwifruit/*`，`pnpm why` 无第三方残留 |
| **A-8** | OCR 四处 Fail-Open + 1 不可达分支（原 P0-1） | 双向证据：修复前 `ok:true` 图片静默消失 → 全修后 `ok:false` + `MARKITDOWN_CONVERSION_FAILED` + `after 1 attempts`；四场景回归 |
| **A-9** | `title` 双层修复（`null` 根因） | bridge 省略键（`service.py:174-175`）+ tool `typeof === 'string'` 防御；三态探针：缺键 PASS / `undefined` FAIL / `null` FAIL |
| **A-10** | 集成层合规修复 8 项（原 Step 9） | `Config` 原名导出 / `restartOnCrash` 接入 / 硬编码提配置 / `.description()` / files 修正 / build scripts / `name` 统一 / 删死代码 |
| **A-11** | `allowedReadRoots` 改 Fail-Closed + `deferContext` + `fix-paths.ps1`（原 Step 10） | 运行树 `open mode` 计数 = 0；`deferContext` 落位；路径脚本 `-DryRun` 幂等 ⚠️ 但白名单被 `SCHEME_RE` 短路 → **H-1 接手** |
| **A-12** | 能力矩阵 / 脆弱面 / 进阶 / 测试大纲四文档 | `CAPABILITY.md`（11 行三态）、`FRAGILITY.md`（P0×2/P1×13/P2×9）、`OPTIMIZATION.md`（A–G）、`TESTPLAN.md`（L0–L4） |
| **A-13** | 开发循环 `dev-reload.ps1`（原 P2-5） | `-DryRun` 零副作用；真实执行一轮 `SCRIPT_EXIT=0`；含 UTF-8 / 残骸清理 / EPERM 重试 |
| **A-14** | `sync-vendor.ps1` 改造 | 改调 Python 重放 + `--check` 前置 + 锚点 10 行注释头 + 无 BOM/LF |

---

## 五、改动纪律（跨项元规则 —— 违反即埋隐患，是本项目"逻辑跳跃"的高发点）

| # | 规则 | 违反后果 | 依据 |
|---|---|---|---|
| 1 | 改 vendored 代码 → **必须**产出 `scripts/vendor-patches/NNN-*.diff` | 下次上游同步静默冲掉改动 | `scripts/sync-vendor.ps1:33-42` |
| 2 | 改 vendored 后的重放校验 → **必须**用 `apply-vendor-patches.py --check`，不得用 `patch` | `patch` 不在 Windows PATH，脚本在 `pwsh` 下直接失败 | 0.3-7 |
| 3 | 改 profile 层 config → **必须全量重述该行所有键** | 未重述的键回退默认值/丢键 | 补丁整行替换无深度合并 |
| 4 | 改 schema / 注册逻辑 → **必须实机启动**验证 | `--dump-config` 不执行 `apply`，抓不到 | 0.3-1 |
| 5 | 改包名 / 依赖声明 / 任一包源码 → **必须 `remove` + `add`**（或跑 `dev-reload.ps1`） | 同版本 file: 不刷新，跑的还是旧产物 | 0.3-6 |
| 6 | 凭证只走 `ctx.credentials` → **禁止写入 patch 文件** | 全局可读配置泄露机密 | 07-陷阱 17 |
| 7 | 新增可选能力 → **必须 Fail-Closed**：显式请求而依赖缺失时抛错，不得静默降级 | 模型误判结果来源，静默错误 | 17-fail-closed |
| 8 | 接缝载荷 → **仅 lossless JSON**；"无值"用**缺键**表达，禁用 `null` / `undefined` | `null` 与 `undefined` 均校验失败且文案不同 | `json-schema.ts:568-571,607` |
| 9 | 校验类改动 → 报告必须给**双向证据**（修复后 PASS + 复现原报错） | 无法区分"真的修好了"与"恰好没触发" | Step 11/12 实践 |
| 10 | 新增包 → **必须加 `@kiwifruit/` scope** | 无 scope 名会被 registry 同名包静默劫持 | 0.3 + A-7 |
| 11 | 新增 Config 键 → **必须同步三处**（`Schema.object` / 包内 `cordis.yml` / profile patch），并跑 `check-artifacts.py` | 静默用默认值 / 丢配置 | H-4 |
| 12 | 新增脚本依赖 → **不得引入 Windows PATH 之外的外部 CLI**（如 `patch`），优先用 Python/Node | 在 `pwsh`/cmd 下 `CommandNotFound` | 0.3-7 |
| 13 | 改动 `presentationMeta` / `render` → **必须 replay 安全**（旧 schema args 不得抛错） | 日志回放崩毁 | `schema.ts:594-597` |

---

## 六、已归档里程碑（Step 1–12，详细记录见对应文档）

| Step | 内容 | 记录位置 |
|---|---|---|
| 1–2 | 定义包 + Python bridge（vendoring / 版本锚点 / 双入口 / 异常映射） | 本文档历史 + `dsh-integration/docs/bridge/` |
| 3–4 | 提供者包（双模传输 / Fiber 清理 / 白名单）+ 消费者包（两工具 / 信号转发 / 卡片） | 同上 |
| 5 | 三包 `cordis.yml` / `cordis.patch.yml` / `package.json` / profile 安装 | 已于 Step 8/8-A 验收通过 |
| 5.5 | api-plus 契约文档 + `--check` 门禁（EXIT=0） | `dsh-integration/docs/` |
| 6 / 6b | 交叉核对 + **host 源码实证**（SubprocessHandle / env 语义 / credentials / FiberState 六态） | `约束/漂移修正提案-2026-09-14.md` |
| 8 / 8-A | 7 阶段 21 检查点验收审计 | 本文件历史 + 下方遗留项 |
| 9 | 集成层合规修复 8 项 | A-10 |
| 10 | scope 化 + `allowedReadRoots` Fail-Closed + `exec.deferContext` + `fix-paths.ps1` | A-11 |
| 11 | 启动崩溃修复（`optional` 非法键）+ **验收盲区暴露**（`--dump-config` 不跑 `apply`） | `README.md` |
| 12 | `title: null` 根因 + 双层修复 | `ISSUES.md`（含订正记录） |

**已作废的旧状态（勿再引用）**：Step 5/6 的未勾选项实为残留（其工作已在 Step 8/8-A/6b 完成）；Step 9 的"P0 待决"已由 Step 10 解决；Step 9 中关于"问题 2 = 未重启进程"的判断已由 Step 12 订正；`CAPABILITY.md` #8 原标"✅ 白名单已通电"已改标 ⚠️（H-1）。

---

## 附：推荐执行顺序

| 阶段 | 项 | 说明 |
|---|---|---|
| **1（无前置，先做）** | **H-1** → H-2 → H-3 → H-4 → H-6 → B-1 → B-3 | H-1 是唯一安全级；H-2~H-4 是门禁类（一次投入长期受益）；H-6/B-1/B-3 改动小、消除"盲飞" |
| **2（需实机/决策）** | V-3 → A-1/A-2/A-3 ｜ V-4/V-1/V-6 | 先在 K 的终端把实机项跑掉（V-3 是 A 段全部前置） |
| **3（结构性收口）** | H-5 → H-7 → H-8 → H-9 ｜ C-1 → C-2/C-3/C-4 ｜ D-1/D-2/D-4 ｜ E-1~E-4 ｜ H-10~H-12 ｜ G-1~G-3 ｜ F-4/F-5 | 其中 C-1 是 D/E/G 多条的前置 |
| **4（统一验收）** | V-2 → V-10 | 用例固化后跑门禁全绿基线，作为结项证据 |

**结项判据**：H 系列全部完成；A/B/C/D/E/G 段完成或明确记录"不做 + 理由"；V-1~V-9 除 V-5（需外部端点）外全部粘贴实测输出；V-10 门禁全 EXIT=0。
