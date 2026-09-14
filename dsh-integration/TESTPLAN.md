# TESTPLAN.md — markitdown × DSH 集成 统一测试大纲

**本文是测试大纲**：给出用例编号、测试项、方法与判定判据，**不含测试代码**。
代码在 L1/L2 落地时另行编写（见「五」的归属）。

- 配套文档：`CAPABILITY.md`（能力矩阵与复现命令）｜`README.md`（安装 / 开发循环 / 已知坑）｜`ISSUES.md`（故障记录）
- 执行原则：**一次性统一验收** —— 按 L0 → L4 顺序跑完，全部通过方可结项
- 快照：2026-09-14

---

## 〇 分层总览

| 层 | 名称 | 执行环境 | 需要 profile | 需要外部端点 | 现状 |
|---|---|---|---|---|---|
| L0 | 静态与契约门禁 | 仓库根 + venv | 否（仅 T0-6/R 需） | 否 | 全部可立即执行 |
| L1 | Python 单元（pytest） | venv | 否 | 否 | 用例待编写 |
| L2 | TS 单元（vitest） | dsh-integration | 否 | 否 | 用例待编写 |
| L3 | 协议级集成（bridge 探针） | venv | 否 | 否 | 可直接执行（探针形态已验） |
| L4 | 端到端与人工 | DSH 运行时 | 是 | T4-6 需要 | 需人工/实机 |

**失败即阻断**：L0 任一失败不得进入 L1；L1/L2 失败不得进入 L3；L3 失败不得进入 L4。
**负例必须真失败**：每个「负例」用例都要在修复前复现失败（防止写出永真断言）。

---

## 一 L0 静态与契约门禁

| ID | 测试项 | 方法 | 期望判据 |
|---|---|---|---|
| T0-1 | 三包 TypeScript 编译 | 三包各跑 `pnpm run build:lib`（tsc strict） | 三包 exit=0，无 TS 错误 |
| T0-2 | bridge 契约防漂移 | `api-plus --check markitdown_bridge` | `[OK] 无漂移`；符号 14；错误 0；exit=0 |
| T0-3 | ocr-plugin 契约防漂移 | `api-plus --check markitdown_ocr` | `[OK] 无漂移`；符号 9；错误 0；exit=0 |
| T0-4 | markitdown-core 契约防漂移 | `api-plus --check markitdown` | `[OK] 无漂移`；符号 34；错误 0；exit=0 |
| T0-5 | vendored diff 可干净重放 | 纯上游副本上 `python scripts/apply-vendor-patches.py --root <副本树> --check <diff>` | 全部文件段通过、无失败、exit=0；**负例**：篡改一行上下文 → 该项判失败且 exit=1（证明非永真） |
| T0-6 | profile 配置合成 | `dsh --profile web --dump-config` | exit=0；warn/error 行数 = 0；三包条目齐全 |
| T0-7 | 包名无 registry 冲突 | 三包按 `@kiwifruit/` scope 命名；`pnpm why <无 scope 旧名>` | 无输出（无第三方同名包被解析） |
| T0-8 | yml 键集与 Schema 一致 | 比对 `cordis.yml` / 包内 `cordis.patch.yml` / profile `cordis.patch.yml` 的键 与 `Schema.object({...})` | 三处键集完全一致（patch 覆盖须全键重述） |
| T0-9 | 陈旧锁检测 | 检查 `$DSH_HOME/profiles/node_modules.lock` 是否存在且持有者 PID 已退出 | 无锁文件；或锁内 PID 不存在（需清除） |

> T0-1 / T0-2 / T0-3 / T0-4 / T0-6 的完整命令见 `README.md`「Python 侧 API 契约文档」与「开发循环」。

---

## 二 L1 Python 单元（bridge + markitdown_ocr）

判定范围：`vendor/bridge/markitdown_bridge`、`vendor/markitdown/markitdown_ocr`。

| ID | 测试项 | 方法 | 期望判据 |
|---|---|---|---|
| T1-1a | `init` 版本门 · 匹配 | 传正确 `pluginInterfaceVersion` | `ok:true`，返回 `capabilities` 五项 + `vendoredVersion` |
| T1-1b | `init` 版本门 · 不匹配 | 传 `pluginInterfaceVersion` 与锚点不符 | `ok:false`；`MARKITDOWN_VERSION_MISMATCH`（消息含 `client=` / `vendored=`） |
| T1-2 | 错误映射四类 | 构造 `MissingDependencyException` / `UnsupportedFormatException` / `MarkItDownException` / `OSError` 四条输入 | 分别映射为 `MARKITDOWN_DEPENDENCY` / `UNSUPPORTED_FORMAT` / `CONVERSION_FAILED` / `CONVERSION_FAILED` |
| T1-3 | `title` 为 `None` | 转换无标题文档 | 结果**不含 `title` 键**（绝不为 `null`） |
| T1-4 | 批量逐项隔离 | `convert_batch` 混入 1 个成功 + 1 个失败源 | 整批 `ok:true`；失败项带 `{"error":{code,message}}`；成功项带 markdown |
| T1-5 | `cancel` 语义 | 对不存在 / 排队中 / 运行中三种 targetId 调用 | 分别返回 `cancelled` / `wasRunning` 的对应组合 |
| T1-6 | OCR 参数校验 | OCR 请求缺 `baseUrl` / `apiKey` / `model` 任一 | `MARKITDOWN_INVALID_PARAMS`（消息指明缺哪个） |
| T1-7 | OCR 失败**不静默** | 让 `extract_text` 返回 `error`（坏端点） | 异常**向上传播**为 `MARKITDOWN_CONVERSION_FAILED`；**不得**返回空文本/占位符 |
| T1-8 | 显式 OCR 时内置 handler 已移除 | 对含内嵌图 PDF 显式启用 OCR 且端点不可达 | 失败；消息含 `after 1 attempts`（证明未降级到内置 `PdfConverter`） |
| T1-9 | 扫描件整页回退可达 | 无文本层、无内嵌图 PDF + OCR | 走到整页渲染 OCR 分支（`has_text_content` 判定生效），非静默跳过 |

> 对应历史缺陷：T1-3（null 契约）、T1-7/T1-8/T1-9（OCR 四处 Fail-Open）。双向证据见 `CAPABILITY.md` #3 与 `ISSUES.md`。

---

## 三 L2 TS 单元（三包）

判定范围：`dsh-markitdown` / `dsh-markitdown-worker` / `dsh-tool-markitdown`。框架：vitest。

| ID | 测试项 | 方法 | 期望判据 |
|---|---|---|---|
| T2-1 | value schema 编译 · 正例 | `defineTool` 载入两个工具的 `output.schema` | 不抛错 |
| T2-2 | value schema 编译 · 负例 | 在属性上加入非法键 `optional: true` | 抛 `UNSUPPORTED_SCHEMA`，violations 指向该键 |
| T2-3 | 值校验三态 | 校验器直调：缺键 / `undefined` / `null` / 合法 string | 缺键 PASS；`undefined` FAIL（根路径 lossless 错误）；`null` FAIL（`value.title must be a string`）；string PASS |
| T2-4 | 传输 · 超时 | mock `ctx.subprocess`，令进程永不退出 | 到 `timeoutMs` 抛 `MarkitdownUnavailableError`（消息含超时毫秒） |
| T2-5 | 传输 · 中止 | 传入已 abort 的 `AbortSignal` | 抛 `AbortError`；进程被终止 |
| T2-6a | 崩溃重启预算 | 连续两次崩溃 | 第一次惰性重启；第二次抛 `MarkitdownUnavailableError`（不形成崩溃循环） |
| T2-6b | `restartOnCrash: false` | 崩溃后请求 | 立即抛错，**不重启** |
| T2-7 | `resolveOcr` · 显式 + 未配置 | `ocr: true` 且 `ocrBaseUrl`/`ocrModel` 为空 | 抛 `MarkitdownDependencyError` |
| T2-8 | `resolveOcr` · 默认启用 + 未配置 | `ocr` 未传、`ocrEnabledByDefault: true`、端点为空 | 返回 `undefined`（静默关闭 = 配置意图） |
| T2-9a | `assertPathAllowed` · 白名单内 | 路径在 `allowedReadRoots` 下 | 通过 |
| T2-9b | `assertPathAllowed` · 白名单外 | 路径不在白名单 | 抛 `MarkitdownConversionFailedError`（`[sandbox: file access denied outside allowed read roots]`）⚠️ 仅当**路径形式能到达该守卫**（见 T2-9d） |
| T2-9c | `assertPathAllowed` · 空数组 | `allowedReadRoots: []` | **拒绝一切**本地路径（Fail-Closed，无 open-mode 放行） |
| **T2-9d** | **`SCHEME_RE` 短路守卫（回归锁定）** | 断言 `SCHEME_RE.test('D:/x')` 与 `SCHEME_RE.test('file:///C:/x')` **均为 false**（即盘符与 file URI 必须走白名单） | 当前**预期 FAIL**（`FRAGILITY.md` F-1）；修复后转 PASS，防止回归 |
| T2-10 | 错误码 → 错误类映射 | 六类错误码逐一输入 | 正确映射到 4 个错误类；未知码落 `MarkitdownUnavailableError` |
| T2-11 | 工具注册名与导出名 | 检查三个导出 | `name` / `inject` / `Config`（worker 亦为 `Config`，非别名）原名导出 |

> 对应历史缺陷：T2-2（`optional` 键回归）、T2-3（null/undefined 判别）、T2-6b（`restartOnCrash` 死配置）、T2-7（`resolveOcr` 静默降级）、T2-11（`Config` 导出名导致 Schema 校验被静默跳过）。

---

## 四 L3 协议级集成（bridge single-shot 探针）

形态：向 `python -m markitdown_bridge.single` 的 stdin 灌一条 JSON 请求，读 stdout。
**不经过 DSH**，可在纯终端复现。

| ID | 测试项 | 期望判据 |
|---|---|---|
| T3-1 | 单文件转换 | `ok:true`；`markdown` 非空；`meta.chars` 与 markdown 长度一致 |
| T3-2 | 批量逐项隔离 | 同 T1-4，但走完整 JSON 协议（含 envelope 的 `pluginInterfaceVersion`） |
| T3-3a | 内嵌图 PDF + OCR + 坏端点 | `ok:false` + `MARKITDOWN_CONVERSION_FAILED`（**不得** `ok:true`） |
| T3-3b | 纯扫描件 + OCR + 坏端点 | `ok:false` + `MARKITDOWN_CONVERSION_FAILED` |
| T3-3c | 纯文本，无 OCR | `ok:true` |
| T3-3d | 有文本 PDF，无 OCR | `ok:true`（非 OCR 路径不受影响） |
| T3-4 | 版本握手错配 | `ok:false` + `MARKITDOWN_VERSION_MISMATCH` |
| T3-5 | `health` op | `ok:true`；`{ok:true, pending:0}` |
| T3-6 | 畸形请求 | 非法 JSON / 缺 `op` | `MARKITDOWN_INVALID_PARAMS` 或 `MARKITDOWN_INTERNAL`，进程不崩 |
| T3-7 | stdout 超限 Fail-Closed | 令回复超出 `collectStdoutBytes` | 明确报错，**不得**静默截断协议回复 |

> 素材：`Test/`（白名单目录）。testdata 全集在 `packages/markitdown-ocr/tests/ocr_test_data/`（27 个，含 5 个扫描版 PDF），**使用前须先拷入白名单目录**。
> 命令模板见 `CAPABILITY.md`「三 复现命令」。

---

## 五 L4 端到端与人工

| ID | 测试项 | 方法要点 | 期望判据 | 前置 |
|---|---|---|---|---|
| T4-1 | 启动与工具面板 | `pnpm dsh web` | 打印 `http://127.0.0.1:3080/?token=...`；工具面板出现 `markitdown_convert` / `markitdown_convert_batch` | — |
| T4-2 | Agent 会话 · 单文件 | 会话内调用 `markitdown_convert`（`Test/sample.txt`） | 返回 markdown；`tool/result` 落库 | — |
| T4-3 | Agent 会话 · 批量 | 传 1 正常 + 1 不存在路径 | 正常项成功；异常项 per-item error；**不整批失败**；末尾出现 deferred 通知 | — |
| T4-4 | 白名单负例 | 传 `Test/` **外**路径 | 报 `[sandbox: file access denied outside allowed read roots]` ⚠️ **必须用相对路径或 POSIX 形式**（`./x`、`/mnt/...`），因为 `D:/...` 被 `SCHEME_RE` 短路 → **不会报错**（`FRAGILITY.md` F-1）。修复 F-1 后 `D:/...` 形式才应被拒 | — |
| T4-5 | OCR 端到端 · 未通电 | 显式 `ocr: true`，端点未配置 | 报 `MARKITDOWN_DEPENDENCY`（**不得**静默出非 OCR 结果） | — |
| T4-6 | 真实 OCR | 配置 `ocrBaseUrl` + `ocrModel` + `credentials` 键后转换扫描件 | 提取出文本；与"非 OCR 结果"对比判定降采样精度 | **外部视觉端点** |
| T4-7 | 热重载无残留 | 改 lib → 触发重载 | 无残留 python 子进程（`ctx.effect` 清理生效） | — |
| T4-8 | 替换提供者演练 | 挂第二个同接缝提供者 | 旧行须 `disabled: true`，否则双路径冲突报错 | — |
| T4-9 | `interactive` 传输 | `transportMode: 'interactive'` → 重启 → 连续转换 → 连续两次杀 worker | 首请求后 python 常驻；杀一次自愈；再杀报 `MarkitdownUnavailableError`；`Ctrl+C` 后无残留 | — |
| T4-10 | vendored 同步演练 | 跑 `scripts/sync-vendor.ps1` | 备份 → 覆盖纯上游 → **重放 diff 恢复改动** → 锚点更新；跑完 `--check` exit=0 | 终端可写 vendor |
| T4-11 | 事件发射观察 | 订阅 `markitdown/converted` | 每次成功转换后收到一次广播（`@mode emit`，不参与决策） | — |

---

## 六 回归重点（历史缺陷 → 锁定用例）

| 历史缺陷 | 根因 | 锁定用例 |
|---|---|---|
| 输出校验 `title` 报错 | Python `None` → JSON `null`，校验器跳过缺键但拒 `null` | T1-3 / T2-3 / T3-1 |
| 启动即崩 `UNSUPPORTED_SCHEMA` | 属性上写了非法键 `optional: true` | T2-2 |
| worker Schema 校验与默认值被静默跳过 | 导出名为 `WorkerPluginConfig` 而非 `Config` | T2-11 / T0-6 / T4-1 |
| `restartOnCrash` 声明后零消费点 | 配置存在但代码不读 | T2-6b |
| OCR 静默降级（4 处 Fail-Open + 1 不可达分支） | 异常被吞 / 未检查 `.error` / 只抢占不移除内置 handler | T1-7 / T1-8 / T1-9 / T3-3a / T3-3b / T4-5 |
| 依赖被解析到 npm 同名第三方包 | 无 scope 包名 + semver 范围 | T0-7 |
| `dump-config` 全绿但启动失败 | `--dump-config` 不执行 `apply`，抓不到 `defineTool` 编译错误 | T0-6 **不足以**替代 T4-1；schema 类改动必须走 T4-1 |
| 陈旧锁致启动失败 | 非优雅终止残留 `node_modules.lock` | T0-9 |
| `remove` 成功 + `add` 失败致包从 profile 消失 | pnpm 交换目录 EPERM 中断 | T0-6 / T0-8 / `dev-reload.ps1` 重试 |

---

## 七 环境前置与已知限制

| 项 | 说明 |
|---|---|
| Python 解释器 | `dsh-integration/.venv/Scripts/python.exe`（隔离 venv） |
| **无外部 `patch` 依赖** | 本机 `patch.exe` 只随 Git Bash 的 MSYS 提供（`/usr/bin/patch.exe`），**不在 Windows PATH 上** → `pwsh`/cmd 下不可见。补丁重放统一由 `scripts/apply-vendor-patches.py`（Python，项目硬依赖）完成；T0-5 / T4-10 均不依赖 `patch` |
| 白名单 | profile 生效 `allowedReadRoots: ['D:/Git/github/markitdown-main/Test']`；**Fail-Closed**，该目录外一律拒绝 |
| 测试素材 | 先拷入 `Test/`；全集在 `packages/markitdown-ocr/tests/ocr_test_data/`（27 个） |
| 外部端点 | 仅 T4-6 需要（OpenAI 兼容 + 视觉，协议契约见 `CAPABILITY.md` §二） |
| 启动类用例 | 必须在**自有终端**执行。限制：`node-safe-delete-shim` 会在单轮累计删除超阈值时拦截（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`），使 dsh 启动 / `pnpm add` / `sync-vendor.ps1` 无副作用或失败 —— 属验证环境限制，非插件缺陷 |
| 退出方式 | 用 `Ctrl+C`，勿用 `Terminate batch job (Y/N)? y` 强杀（残留锁 → 下次启动失败） |
| 改动生效 | web profile 未启用 `cordis-plugin-hmr`；改代码后必须 `dev-reload.ps1` + 重启进程 |

---

## 八 通过判据与记录模板

**结项判据**：L0 / L1 / L2 / L3 全部通过；L4 除 T4-6（依赖外部端点）外全部通过。
T4-6 未执行时须显式标注 `BLOCKED: 缺外部视觉端点`，不得计为通过。

**单条记录模板**：

```
[用例 ID] 状态：PASS | FAIL | BLOCKED
  命令/操作：
  原始输出（节选）：
  判定依据：
  备注（环境/偏差）：
```

**缺陷登记**：FAIL 项 → 记入 `ISSUES.md`（现象 / 根因 / 修复 / 双向证据），并回填本表状态。

**归属**：L1 用例落 `vendor/bridge/tests`（pytest）与 `vendor/markitdown/markitdown_ocr/tests`；L2 用例落 `dsh-integration/tests`（vitest，需先装 devDependency）；L3 探针建议固化为脚本（Step 11/12 的临时探针即其前身）。
