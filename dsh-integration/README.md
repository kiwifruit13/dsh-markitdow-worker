# dsh-integration — markitdown × DSH 插件生态集成

三包约定（约束/00-总纲/06-插件编写）+ vendored Python bridge worker。

## 文档索引

| 文档 | 定位 |
|---|---|
| `README.md`（本文） | 使用说明、布局、安装、开发循环、已知边界 |
| **`CAPABILITY.md`** | **能力矩阵**：哪些已通电 / 接线就绪未通电 / 缺失（带可复现证据锚点） |
| **`TESTPLAN.md`** | **统一测试大纲**：L0–L4 用例清单 + 判定判据（不含代码） |
| **`FRAGILITY.md`** | **脆弱面清单**：P0/P1/P2 分级 + 证据锚点 + 处置顺序 |
| **`OPTIMIZATION.md`** | **进阶方向**：传输/并发、观测、单一真源、安全策略、批量流式、工程化 + 路线图 |
| `ISSUES.md` | 故障记录与根因订正 |

## 布局

```
dsh-integration/
├── dsh-markitdown/          ⓐ @kiwifruit/dsh-markitdown — 定义包：ctx.markitdown 接缝（抽象类+类型化错误+事件，零运行时依赖）
├── dsh-markitdown-worker/   ⓑ @kiwifruit/dsh-markitdown-worker — 提供者包：管理 Python bridge worker（NDJSON over stdio）
├── dsh-tool-markitdown/     ⓒ @kiwifruit/dsh-tool-markitdown — 消费者包：面向模型的工具 convert / convert_batch
├── scripts/fix-paths.ps1    机器相关路径集中重写（2 处 link: + tsconfig.base.json paths）
vendor/
├── markitdown/              vendored 一方源码（markitdown 核心 + markitdown-ocr + VENDORED_VERSION 锚点）
└── bridge/                  markitdown_bridge 薄壳 worker + requirements.lock
```

## 环境准备（一次性）

```sh
# 1) 创建隔离 venv 并按 lock 安装三方依赖（国内镜像）
python -m venv dsh-integration/.venv
dsh-integration/.venv/Scripts/pip install -r vendor/bridge/requirements.lock -i https://mirrors.aliyun.com/pypi/simple/
```

## 构建

```sh
cd dsh-integration/dsh-markitdown        && pnpm run build:lib
cd dsh-integration/dsh-markitdown-worker && pnpm run build:lib
cd dsh-integration/dsh-tool-markitdown   && pnpm run build:lib
```

## 安装与验证

```sh
# 导出默认配置（初始化 profile 目录结构）
dsh --profile web --dump-default-config >/dev/null

# 持久化安装（file: 必须绝对路径；装入后包名为 @kiwifruit/*）
dsh plugin --profile web add file:/abs/path/to/dsh-integration/dsh-markitdown
dsh plugin --profile web add file:/abs/path/to/dsh-integration/dsh-markitdown-worker
dsh plugin --profile web add file:/abs/path/to/dsh-integration/dsh-tool-markitdown
# 定义包无 dsh.bundle，会打印 "installed as a plain dependency" 警告——属预期，非错误

# 在 profile 的 cordis.patch.yml 中补全 markitdown-worker 的 config：
#   pythonPath: <venv 内解释器绝对路径>
#   vendorPath: <本仓库 vendor 目录绝对路径>
#   allowedReadRoots: [<允许读取的本地根目录>]   ← 必填：空数组 = Fail-Closed，拒绝所有本地路径

# 跨机 / CI 先重写机器相关路径（幂等，-DryRun 可预演）
#   pwsh -File dsh-integration/scripts/fix-paths.ps1 -DryRun

dsh --profile web
```

启动后检查清单（对应验收标准阶段 6）：
1. 三个 id（markitdown-seam 除外，为 library）出现于加载器条目
2. `fiber.state === 'active'`——若 `markitdown-worker` PENDING：`inject` 的 subprocess/sandbox/timer 服务缺提供者
3. 工具面板出现 `markitdown_convert` / `markitdown_convert_batch`
4. 调用 `markitdown_convert` 转换一个本地 PDF/DOCX，得到 markdown
5. 热重载后确认无残留 python 子进程（ctx.effect 清理生效）

## 开发循环（改源码 → 生效）

`dsh plugin add file:<dir>` 在 pnpm 下是**目录拷贝**，不是符号链接。因此改完源码必须重建并重装，
且**必须先 remove** —— 否则同版本的 `file:` 引用会被 pnpm 判定为 `Already up to date`，运行树仍是旧产物（本仓库已实际踩过）。

```sh
# 一键：构建 → 移除 → 重装 → 校验配置合成（推荐）
pwsh -File dsh-integration/scripts/dev-reload.ps1 -DryRun     # 预演，只打印命令
pwsh -File dsh-integration/scripts/dev-reload.ps1             # 执行

# 只刷新单个包（如只改了工具逻辑）
pwsh -File dsh-integration/scripts/dev-reload.ps1 -Only dsh-tool-markitdown
# 只改了 yml / package.json、无需重建 lib 时
pwsh -File dsh-integration/scripts/dev-reload.ps1 -SkipBuild
```

改完后**必须重启 DSH 进程** —— web profile 未启用 `cordis-plugin-hmr`，代码改动不会热生效。

### 为什么不用 `dsh --patch <overlay>`

`--patch` 是**逐次调用**的 CLI 参数（每次启动都要记得带上），且只叠加插件条目、不改变模块解析。
不符合"无需记忆额外步骤"的验收要求，故选用脚本封装（`dev-reload.ps1`）。

### 已知坑（本机实测）

| 现象 | 原因 | 处理 |
|---|---|---|
| `EPERM: rename <pkg>_tmp_NNNN_1 -> <pkg>` | Windows 上 pnpm 交换目录时杀软/索引器短暂持有句柄 | 脚本自动重试（默认 3 次，`-AddRetries` 可调）；仍失败则先退出 DSH 再跑 |
| `atomic-write: timed out waiting for the writer lock` | 非优雅终止（`Terminate batch job (Y/N)? y`、强杀）残留 `$DSH_HOME/profiles/node_modules.lock` | 确认锁内记录的 PID 已退出后删除该锁文件 |
| profile 根堆积 `_tmp_<pid>_<hash>` 目录 | pnpm 建临时文件后 unlink 失败（本机 `node-safe-delete-shim` 批量删除护栏） | 无害（仅占位）；可手工删除 |
| **`remove` 成功但 `add` 失败 → 该包从 profile 消失** | add 中断后 `dependencies` / `dsh.profile.bundles` 已失条目 | 重跑脚本即可；或手工补回两处（lockfile 未被写坏时会自动一致，`dsh --dump-config` 可验证） |

## Python 侧 API 契约文档（api-plus，Step 5.5 已生成）

```sh
# 重新生成（bridge 契约 / vendored 上游速查表）
cd vendor/bridge        && ../../dsh-integration/.venv/Scripts/python.exe ../../api-plus/generate_api_docs.py markitdown_bridge ../../dsh-integration/docs/bridge --manifest ../../dsh-integration/docs/bridge/api_manifest.json --exclude markitdown_bridge.__main__ --exclude markitdown_bridge.single
cd vendor/markitdown    && ../../dsh-integration/.venv/Scripts/python.exe ../../api-plus/generate_api_docs.py markitdown ../../dsh-integration/docs/markitdown-core --manifest ../../dsh-integration/docs/markitdown-core/api_manifest.json
cd vendor/markitdown    && ../../dsh-integration/.venv/Scripts/python.exe ../../api-plus/generate_api_docs.py markitdown_ocr ../../dsh-integration/docs/ocr-plugin --manifest ../../dsh-integration/docs/ocr-plugin/api_manifest.json

# 防漂移门禁（验收必过，退出码 1 = 漂移）
cd vendor/bridge && ../../dsh-integration/.venv/Scripts/python.exe ../../api-plus/generate_api_docs.py markitdown_bridge ../../dsh-integration/docs/bridge --check --exclude markitdown_bridge.__main__ --exclude markitdown_bridge.single
# 期望：[OK] 文档与代码一致，无漂移。 / 符号 14 个 / 错误 0 条 / exit=0
```

## 已知边界（诚实声明）

- **Step 6b 已完成源码实证**（D:\Git\gitee\deepseek-harness-master，2026-09-14）：
  - SubprocessHandle：`done: Promise<SubprocessOutcome>` + `terminate()` + `collected` 读取器；`stdio.stdin` 支持 `{data}` 批形态（collect 模式即用此形态）；`stdout:'pipe'` 暴露原始 Readable → **interactive 模式源码可行**（约束文档"done/collected 取代流式"表述过时，pipe 与 collect 两种形态并存）。
  - **env 为"合并到净化父环境基线"而非全量覆盖**（types.ts:100-108）——约束文档 13-ctxsubprocess 的"全量覆盖"说法有误，workerEnv 按追加语义使用。
  - `ctx.timeout(delay): Promise<void>` ✅（vendor/timer）。
  - credentials：`resolve(credentialRef('scope/id')) → {value, source} | undefined`；OCR 凭证键 `markitdown/ocr`，未配置即 Fail-Closed。
  - ctx.llm 无 OpenAI 兼容 facade（LlmAdapter.stream 为 DSH 内部词汇）→ OCR 维持凭证模式。
  - FiberState 六态确认（PENDING/LOADING/ACTIVE/FAILED/UNLOADING/DISPOSED，vendor/cordis fiber.ts:147）。
- **传输双模**（已决策 + 源码实证）：默认 `collect`——每请求单进程（`python -m markitdown_bridge.single`，走 stdin `{data}` 批形态 + collected stdout 读取）；`interactive` 长驻 NDJSON 为配置项（源码实证可行：`stdout:'pipe'` 暴露原始 Readable）。**使用建议**：连续大批量转换场景可将 `transportMode` 切为 `interactive` 省去每请求 ~1-3s 的 Python 启动开销。
- Python 侧转换是同步的：interactive 模式 cancel 只能移除排队请求；collect 模式超时/中止直接 terminate 单发进程。
- 批量不做 ctx.jobs 后台化（已决策）：内联并发 + 20 条上限 + maxOutputChars 双层限流足够。
- **Config 必须原名导出（源码实证，2026-09-14）**：加载器读取 `plugin.Config`（`vendor/cordis/src/registry.ts:326`），缺失时**直接跳过校验与默认值填充**（`fiber.ts:50-53` `if (!runtime.Config) return config`）。三包一律 `export const Config`，禁止改名/别名。
- **包名已 scope 化（2026-09-14 解决）**：三包现为 `@kiwifruit/dsh-markitdown` / `@kiwifruit/dsh-markitdown-worker` / `@kiwifruit/dsh-tool-markitdown`。原无 scope 名 `dsh-markitdown` 与 npm registry 上的第三方同名包冲突（实测：用 `"*"` 声明依赖时 pnpm 静默装到 `dsh-markitdown@0.1.1`）——scope 化是结构性消除，不靠纪律。**未发布 npm 前，三包之间一律 `link:` 本地引用，绝不使用 semver 范围。**
- **本地路径白名单 = Fail-Closed（2026-09-14 起）**：`allowedReadRoots` 空数组**拒绝所有本地路径**（URI scheme 不受影响）。profile 必须显式列出允许的根，例如 `['D:/Git/github/markitdown-main/Test']`。这是 17-fail-closed「缺失即拒绝」的落地——忘记配置会明确报 `[sandbox: file access denied outside allowed read roots]`，而不是静默放行。
- **机器相关路径集中重写**：`scripts/fix-paths.ps1` 一键改写两处 `link:` 绝对路径与 `tsconfig.base.json` 的 `paths`（`-DryRun` 预演，幂等）。跨机 / CI 只需跑一次。
- **定义包无 `dsh.bundle` 属预期**：`dsh plugin add` 会对定义包输出 `declares no dsh.bundle — installed as a plain dependency` 警告——这是 library 形态的正确结果（不激活 profile 层），非错误。
- **批量完成通知**：消费者使用 `exec.deferContext(createUserMessage(...))`（源码实证 `packages/core/tools/src/index.ts:404`；循环只在本次 `tool/result` 之后追加），非 `exec.agent.inject`，因此无需 try/catch 防御已销毁 agent。
- **value schema DSL 键白名单（源码实证，2026-09-14）**：`output.schema` 由 `ValueSchemaSpec` 编译（`packages/core/tools/src/schema.ts:181` `ANNOTATION_KEYS`、`:293`）。合法键 = `description`/`title`/`default`/`examples`（注解）+ 按类型 `type`/`oneOf`/`properties`/`additionalProperties`/`items`/`enum`/`const`；属性节点（`properties` 的每个 value）额外允许 `required`，但**其值只能是 `true`**（写成 `false` 也是违规）。**可选性靠省略 `required` 表达——不存在 `optional` 键**，写了会在 `defineTool` 抛 `UNSUPPORTED_SCHEMA` 并导致启动失败。另注意：`title` 作为注解键是**字符串**，但作为 `properties` 下的**属性名**完全合法，两者不同层级。
- **验证手段边界（重要教训）**：`dsh --dump-config` **不执行 `apply`**，因此**捕获不到 `defineTool` 的 schema 编译错误**——配置合成 EXIT=0 / 0 警告 ≠ 能启动。启动类问题必须①实机 `dsh --profile web` 启动，或②用宿主 `defineTool` 直调做脚本级探针（`file://` 绝对导入 `packages/core/tools/lib/index.js` 即可，无需 boot）。
- **陈旧锁（本机环境坑）**：非优雅终止（`Terminate batch job (Y/N)? y`、`timeout`/`taskkill` 强杀）会留下 `$DSH_HOME/profiles/node_modules.lock`，后续启动报 `atomic-write: timed out waiting for the writer lock`。锁文件内容即持有者 PID；确认该 PID 已不存在后删除锁文件即可恢复。
- **`title` 契约＝缺键，绝不为 `null`（实跑 + 源码实证，2026-09-14）**：Python `result.title` 为 `None` 时，bridge 在 `service.py:_convert_one` **省略该键**。原因：输出校验器对 `type: 'string'` 的三种行为是——**跳过缺键（PASS）**、`undefined` 会使整对象报 `"value" must be a lossless JSON object`、**`null` 报 `"value.title" must be a string`**（`json-schema.ts:568-571`、`:607`）。因此 `"absent"` 是"无标题"的唯一无损编码。消费侧额外用 `typeof result.title === 'string'` 防御，以兼容旧版 bridge 送来的 `null`。
- **OCR 全链 Fail-Closed（2026-09-14，四层修复）**：OCR 请求一旦失败必须**可检测地报错**，绝不静默降级。四层缺一不可——
  1. `dsh-tool-markitdown` 的 `resolveOcr`：`ocr: true`（模型显式请求）而端点未配置 → 抛 `MarkitdownDependencyError`；仅"默认启用但未配置"才静默关闭
  2. 四类 converter 检查 `ocr_result.error` → 抛 `FileConversionException`（`_ocr_service.py:107-108` 只把异常记进 `.error`，**不抛**）
  3. 各层 `except Exception` **之前**补 `except MarkItDownException: raise` —— 否则异常会被本层的 pdfminer / PyMuPDF 回退吞掉
  4. `markitdown_ocr/_plugin.py`：**显式启用 OCR 时移除内置 5 类 converter**（Pdf/Docx/Pptx/Xlsx/Xls）—— 因为 `_markitdown.py:675-677` 会吞掉单个 converter 的异常并**继续尝试下一个**，不移除就会降级为内置非 OCR 转换
  - 另修一处不可达分支：原扫描件整页 OCR 回退条件 `not markdown` 因主循环必然 append `## Page N` 而永不成立 → 改用 `has_text_content` 标志
  - **双向证据**：修复前同一请求返回 `ok: true` 且图片静默消失；修复后返回 `ok: false` + `MARKITDOWN_CONVERSION_FAILED` + `after 1 attempts`
- **vendored 改动必须归档为 diff（2026-09-14）**：`scripts/sync-vendor.ps1` 会以 `packages/` 覆盖 `vendor/markitdown/`，因此**对 vendored 代码的任何改动都必须产出 `scripts/vendor-patches/NNN-*.diff`**，否则下次同步被静默冲掉。当前归档：`001-ocr-fail-open.diff`（286 行 / 5 文件）。
- **补丁重放不依赖外部 `patch`（2026-09-14）**：`patch.exe` 在 Windows 上只随 Git Bash 的 MSYS 提供（`/usr/bin/patch.exe`），**不在 Windows PATH 上** —— 因此旧版脚本里的 `patch -p1` 在 `pwsh`/cmd 下必然 `CommandNotFound`。现由 `scripts/apply-vendor-patches.py`（Python，本项目硬依赖）承担：**精确匹配、不做 fuzz**，先 `--check`（不落盘）再应用，任一文件失败即 exit=1；`sync-vendor.ps1` 会先跑 check，失败则**在写盘前中止**。
