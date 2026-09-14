# FRAGILITY.md — 中间层与集成的脆弱面清单

**范围**：`dsh-integration/` 三包（定义/提供者/消费者）+ `vendor/bridge`（中间层）+ `vendor/markitdown`(含 `markitdown_ocr`) + profile 组合与脚本。
**口径**：每条给出可复现证据锚点；**明确区分「已实证」与「待实机验证」**，不写推断式结论。
**快照**：2026-09-14

## 〇 结论摘要

| 级别 | 数量 | 归类 |
|---|---|---|
| **P0** | **2** | **读路径围栏实际失效**（白名单被正则绕过 + `file://` 设计性放行，且**无补偿层**） |
| P1 | 13 | 语义丢失 / 双真源 / 无门禁 / 静默陈旧 |
| P2 | 9 | 环境与运维（多为 Windows/pnpm 特性） |

一句话根因归类：**「本该拦住的地方没有被拦住（P0）」，以及「本该报错的地方静默降级（P1）」。**

---

## 一 P0 — 读路径围栏实际失效【已实证】

### F-1 白名单被 `SCHEME_RE` 绕过（连盘符路径都绕过）

**机理**：`SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/`（`dsh-markitdown-worker/src/index.ts:43`）本意是"识别 URI scheme 以便放行 http/https/data"，
但它**同样匹配 Windows 盘符**（`D:` 满足「字母 + 冒号」）：

```ts
:461  if (source && !SCHEME_RE.test(source)) assertPathAllowed(source, this.config.allowedReadRoots)  // 单文件
:477  assertLocalPaths(sources, this.config.allowedReadRoots)                                          // 批量
```

**实测**（node 直跑同一正则）：

| 输入 | 判定 |
|---|---|
| `D:/Git/github/markitdown-main/Test/sample.txt` | **SKIP 白名单** ← 本机最常见的路径写法 |
| `C:/Windows/win.ini` | **SKIP 白名单** |
| `file:///D:/...` | **SKIP 白名单** |
| `http://example.com/a.pdf` | SKIP 白名单（设计意图） |
| `relative/path.txt` / `./rel.txt` / `/mnt/d/x.txt` | CHECK 白名单 |

⇒ **只有相对路径与 POSIX 风格路径会真正走白名单。** `allowedReadRoots` 对本机主流输入形态**等于未生效**。

**补偿层核查：不存在。** `ctx.sandbox.confine(argv, { mode: 'read-only', workspaceRoot: bridgeDir })`（`:170`,`:274`）在 read-only 模式下只是把**整个文件系统挂成只读**：

- bwrap：`['--ro-bind', '/', '/', ...]`（`packages/sandbox/sandbox-local/src/profiles.ts:17`）
- landlock：`landlockGrantArgs({ readOnly: ['/'], readWrite })`（`profiles.ts:30-35`）

即 **限制写、不限制读**。白名单是唯一的读控制面。

**影响**：模型可读本机任意文件（含 `C:/Windows/...`），只要用盘符或 `file://` 形式书写。

**建议**（按代价从低到高）

1. 收紧正则：要求 scheme 后跟 `//` 或长度 ≥2，且**显式排除单字母盘符**（`/^[a-zA-Z][a-zA-Z0-9+.-]{1,}:/` 仍不够，需再判 `^[a-zA-Z]:[\\/]` 优先当盘符）。
2. 把「是否本地路径」的判定改为**先判盘符、再判 scheme**：
   `isDrivePath = /^[a-zA-Z]:[\\/]/` → 走白名单；否则若匹配 scheme → 按 scheme 策略处理。
3. 对 `file:` 单独设策略：**要么禁止**，要么把它归一成路径后**同样过白名单**。
4. 补一条运行时负例（见 `TESTPLAN.md` T2-9d）。

### F-2 `file://` URI 直接读取本地文件（设计性放行，非 bug）

**机理**：中间层把 `file:` 当 URI 放行，而 markitdown 会把它解析成真实路径去读：

```python
# vendor/markitdown/markitdown/_markitdown.py:486-498
if scheme == "file":
    netloc, path = file_uri_to_path(uri)      # 解析为本地路径
    return self.convert_local(path, ...)       # 读本地文件
```

**实测**（bridge single-shot，源在白名单**之外**）：

```
输入：{"op":"convert","params":{"source":"file:///D:/Git/github/markitdown-main/README.md"}}
输出：{"ok": true, "result": {"markdown": "# MarkItDown\n\n[![PyPI]..."}}
```

⇒ 即使 F-1 被修好，`file://` 仍会按当前设计绕过白名单。

**建议**：`file:` 必须与本地路径**同策**（归一后过白名单）；若业务上确需放行，须在文档与工具描述中**显式声明该边界**，而不是靠隐含行为。

---

## 二 P1 — 结构与语义脆弱面

| # | 脆弱面 | 证据锚点 | 影响 | 现状 |
|---|---|---|---|---|
| F-3 | **错误码→错误类映射丢语义**：bridge 定义 6 码，TS 只显式映射 3 码；`MARKITDOWN_INVALID_PARAMS`/`MARKITDOWN_INTERNAL` 落 `default` → `MarkitdownUnavailableError` | `dsh-markitdown-worker/src/index.ts:97-110`；`vendor/bridge/markitdown_bridge/service.py:28-33` | **参数错误被报成"服务不可用"**，误导排查方向 | 未修 |
| F-4 | **vendor 版本锚点未启用**：`expectedVendorVersion: ''` → 仅 `PLUGIN_INTERFACE_VERSION` 被强制 | profile `cordis.patch.yml`；锚点文件 `vendor/markitdown/VENDORED_VERSION` 存在但未接线 | 上游同步后 **vendor 版本漂移不会被检测** | 未修（可选） |
| F-5 | **`PLUGIN_INTERFACE_VERSION` 双真源**：Python 锚点文件 与 TS 常量各写一份 | `vendor/markitdown/VENDORED_VERSION` vs `dsh-markitdown-worker/src/index.ts:42` | 手工同步；改一处忘另一处 → 运行期 `VERSION_MISMATCH`（好）或静默不校验（坏） | 未修 |
| F-6 | **`lib/` 产物入库，无新鲜度门禁**：`src` 改了忘 `build:lib` → profile 拷到旧 lib，而 `dump-config` **不执行 `apply`**，仍全绿 | `dsh-integration/*/lib/`；`dump-config` 语义（Step 12 已证） | **双副本不同步**，出现"配置全绿但行为是旧的" | 未修 |
| F-7 | **`dsh plugin add file:` 是目录拷贝**：改源码不重装＝静默陈旧；且 remove+add 有 EPERM 中断风险（中断后**包从 profile 消失**） | `ISSUES.md` 问题 2/3；本轮实测 tool 包被移除 | 运行树陈旧 / profile 缺包 | 部分缓解（`dev-reload.ps1` + 重试），**忘记跑仍中招** |
| F-8 | **配置三处同步**：`Schema.object({})` / 包内 `cordis.yml` / profile `cordis.patch.yml`；patch 覆盖须**全键重述** | 三处 yml + `src/index.ts` 的 `Config` | 新增字段忘同步 → 静默用默认值；漏键 → 丢配置 | 现已一致，**无自动门禁** |
| F-9 | **`Config` 导出名铁律无自动门禁**：改名会静默跳过 Schema 校验与默认值填充 | `registry.ts:326` `Config: plugin.Config` + `fiber.ts:50-53` | 配置错误静默通过 | 本轮已修（P0-1/G 项），**无检测** |
| F-10 | **collect 模式超时线性放大**：`timeoutMs * max(1, sources.length)` → 20 × 120s = **40 分钟** | `dsh-markitdown-worker/src/index.ts:231` | 远超宿主工具超时；长尾请求悬挂 | 未修 |
| F-11 | **collect 协议靠 stdout 单行 JSON，"非协议行"被跳过**：解析从末尾向前找 `ok` 字段的行 | `src/index.ts:137-151` | 上游库 print/warning 污染 stdout 时**可能吞掉真实错误行**；崩溃前后残输出语义不明 | 未修（容错≠防护） |
| F-12 | **`collectStdoutBytes` 超限即 Fail-Closed**：默认 32 MiB，无分块/流式 | `Config.collectStdoutBytes`；`CollectTransport` stdio | 超大文档直接失败（至少不是静默截断） | 已决策（Fail-Closed） |
| F-13 | **`restartOnCrash` 只被 interactive 消费**：collect 每请求新进程 | `src/index.ts:290-292`（interactive 分支） | 两模式**配置语义不一致**，用户以为设了就有效 | 未修 |
| F-14 | **`interactive` 模式全链未实跑**：长驻进程 / 握手超时 / 崩溃重启预算 | `src/index.ts:259` 起；profile `transportMode='collect'` | 未验证路径，上线即风险 | 未修（P3-3 待做） |
| F-15 | **事件发射无消费者**：`markitdown/converted` 只 emit，无人订阅 | `src/index.ts:463`；定义包 `Events` 声明 | 观测面为零（设计允许，但等于死面） | 未修 |
| F-16 | **模型可见信息含完整本地路径**：`meta.source` 原样回传模型与 UI | `service.py:165-168`（`meta.source = source`）；对比 `:163-164` 刻意只留 errno | 本地路径（含用户名/目录结构）泄漏到模型与日志 | 未修 |

补充（读源码已确认，未单独列级）：
- **F-25 网络面**：bridge 直接支持 `http(s)` 抓取（`_markitdown.py:569` `urlparse(response.url)`），worker 进程可发起外网请求；`data:` URI 可注入任意内联内容。属 markitdown 固有行为，需在工具描述中显式声明边界。
- **F-26 批量无 per-item 重试**：整批单进程，进程崩溃即全批失败（per-item 隔离只在**单个进程内**生效，`service.py:191-196`）。
- **F-27 `workerEnv` 可注入任意环境变量**（如 `PYTHONPATH`）：需 profile 写权限，低危。

---

## 三 P2 — 环境与运维

| # | 脆弱面 | 证据 | 现状 |
|---|---|---|---|
| F-17 | `patch` 不在 Windows PATH（只在 Git Bash MSYS 内） | PowerShell `Get-Command patch` → NOT FOUND | ✅ 已修（改 Python 重放器） |
| F-18 | 非优雅终止残留 `$DSH_HOME/profiles/node_modules.lock` → 下次启动失败 | 本轮实测 | 已知，需手工删锁 |
| F-19 | pnpm 交换目录 `EPERM` → `remove` 成功 + `add` 失败 → 包从 profile 消失 | 本轮实测 | 部分缓解（重试 + 残骸清理） |
| F-20 | 机器相关路径：2 处 `link:` 绝对路径 + `tsconfig.base.json` 的 `paths` 指向 profile 的 node_modules | `dsh-integration/*/package.json`；`tsconfig.base.json` | 有 `fix-paths.ps1`，但脚本默认值亦机器相关 |
| F-21 | 无 scope 包名会被 registry 同名包劫持 | 本轮实测拉到第三方 `dsh-markitdown@0.1.1` | ✅ 已修（三包 scope 化）；**未来新增包须记得** |
| F-22 | 无 `prepare` 脚本 → `github:` 安装路径会失败 | 包内 `tsconfig.json` extends `../tsconfig.base.json`，profile 拷贝后该相对路径不存在 | 已决策不加（`file:` 不受影响） |
| F-23 | 热重载残留 python 子进程未验证 | `ctx.effect` 清理路径 | 未验证（P2-1） |
| F-24 | profile 根堆积 `_tmp_<pid>_<hash>` 残骸 | 实测 30 个历史残留 | 无害，可手工清 |
| F-28 | `__pycache__` 随 vendored 目录扩散 | `vendor/markitdown/**/__pycache__` | 无害，但会干扰 `diff -rq` 判定 |

---

## 四 处置建议顺序

| 序 | 动作 | 理由 | 依赖 |
|---|---|---|---|
| 1 | **修 F-1 + F-2（读路径围栏）** | 唯一的安全级缺陷；两处小改动 + 一条负例 | 无 |
| 2 | 补 T0-5/T2-9d/T4-4 的**可触发**负例 | 现文档的负例用 `D:/` 形式**根本触发不到**（见 `TESTPLAN.md` 待订正项） | 1 |
| 3 | 修 F-3（错误映射补 2 码） | 一行级；直接改善可诊断性 | 无 |
| 4 | 加 F-6 门禁：`src` mtime > `lib` mtime 即报错 | 消除"双副本不同步"这一类复发 | 无 |
| 5 | 修 F-10（批量超时改为按项递增而非线性封顶） | 防长尾悬挂 | 无 |
| 6 | F-4 / F-13 / F-16：接线锚点、统一 `restartOnCrash` 语义、脱敏 `meta.source` | 一致性收尾 | 需 K 决策 |

> ⚠️ **本文与既有文档的冲突提示**：`CAPABILITY.md` #8 与 `TESTPLAN.md` T2-9c / T4-4 目前把「路径白名单」记为 ✅ 已通电、并以"传 `Test/` 外路径 → 报 sandbox denied"为判据。
> 按 F-1，**用 `D:/...` 形式书写时该判据不可复现**。这两处已按本文订正。
