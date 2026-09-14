# CAPABILITY.md — markitdown DSH 集成能力矩阵

单一事实来源：**哪些能力已通电、哪些只是接线、哪些缺失**。

- 配套文档：`README.md`（使用说明）｜`ISSUES.md`（故障记录）｜`../../todo.md`（待办规划）
- 快照时间：2026-09-14
- 生效 profile：`web`（`$DSH_HOME/profiles/web/`）

## 〇 如何读这份表

### 三态定义

| 标记 | 含义 | 判据 |
|---|---|---|
| ✅ 已通电 | 端到端可用 | 有**实跑记录**，或链路每一环均可由已验收的下游路径直接推出 |
| 🔌 接线就绪未通电 | 代码/配置就位，运行时未启用 | 缺外部输入（端点/凭证）或配置为默认关闭态 |
| ❌ 缺失 | 无实现 | 源码中无对应落点 |

### 证据类型

| 类型 | 含义 | 复现方式 |
|---|---|---|
| `[实跑]` | 真实执行过并记录了原始输出 | 按「三、复现命令」逐条重跑 |
| `[源码]` | 行号可定位的实现 | 打开 `文件:行` 核对 |
| `[配置]` | profile 生效值 | `cat $DSH_HOME/profiles/web/cordis.patch.yml` 或 `dsh --profile web --dump-config` |

> 约定：锚点写 `文件:行`，路径相对仓库根 `D:/Git/github/markitdown-main/`，除非另行标注。

---

## 一 能力矩阵

| # | 能力 | 状态 | 证据锚点 | 证据类型 |
|---|---|---|---|---|
| 1 | **单文件转换** `markitdown_convert` | ✅ | 工具注册 `dsh-integration/dsh-tool-markitdown/src/index.ts:137`；执行 `:172-184`；worker 入口 `dsh-integration/dsh-markitdown-worker/src/index.ts:225` → `runOnce('convert')` `:186`；bridge `vendor/bridge/markitdown_bridge/service.py:178` `op_convert`；实跑 `Test/sample.txt` → `ok:true` | `[实跑]`+`[源码]` |
| 2 | **批量转换**（≤20 + 逐项隔离） | ✅ | 上限校验 `dsh-tool-markitdown/src/index.ts:227-229`（`> 20` 抛错）；逐项隔离 `vendor/bridge/markitdown_bridge/service.py:191-196`（单项 `BridgeError` → `{"source","error":{code,message}}`，不中断整批）；超时按项数放大 `dsh-markitdown-worker/src/index.ts:231` | `[源码]` |
| 3 | **OCR**（扫描件/内嵌图） | 🔌 | 门控 `dsh-tool-markitdown/src/index.ts::resolveOcr`（显式 `ocr:true` 且端点未配置 → 抛 `MarkitdownDependencyError`）；bridge 参数校验 `service.py:138`；能力自报 `service.py:147`；**端点未配置**：`ocrBaseUrl: ''` / `ocrModel: ''` `[配置]` | `[源码]`+`[配置]` |
| 4 | **`collect` 传输**（每请求单进程） | ✅ | 类 `dsh-markitdown-worker/src/index.ts:158`；选择分支 `:454-456`；profile 生效 `transportMode: 'collect'` `[配置]`；实跑（#1 即走此链路） | `[实跑]`+`[配置]` |
| 5 | **`interactive` 传输**（长驻 NDJSON） | 🔌 | 类 `dsh-markitdown-worker/src/index.ts:259`；握手 `:317-318`；崩溃重启闸门 `:287-292`；health `:373`；**profile 未启用**（`transportMode: 'collect'`）`[配置]` | `[源码]`+`[配置]` |
| 6 | **健康检查** | ✅ | 抽象 `dsh-integration/dsh-markitdown/src/index.ts:165`；collect 探针式（复用 `runOnce('init')`）`dsh-markitdown-worker/src/index.ts:234`；interactive `request('health')` `:373`；bridge `service.py:208` `op_health` → `{ok, pending}` | `[源码]` |
| 7 | **取消与超时** | ✅ | 三分支竞速 `dsh-markitdown-worker/src/index.ts:195-208`（`exited` / `timeout` / `aborted`）；abort → `AbortError` `:208`；超时 → `MarkitdownUnavailableError` `:207`；信号透传 `dsh-tool-markitdown/src/index.ts:175`（`exec.signal`）；bridge 协作取消 `service.py:199` `op_cancel`；超时配置 `timeoutMs: 120000` `[配置]` | `[源码]`+`[配置]` |
| 8 | **路径白名单**（Fail-Closed） | ⚠️ **名义生效、实际被绕过** | 判定函数本身正确 `dsh-markitdown-worker/src/index.ts:119-129`（**空数组 = 拒绝一切本地路径**，无 open-mode 放行分支）；拒绝形状 `:127`；批量前置校验 `:131-134`；生效值 `allowedReadRoots: ['D:/Git/github/markitdown-main/Test']` `[配置]`<br>**⚠️ 但调用点被 `SCHEME_RE` 短路**：`:43` 的正则同样匹配 Windows 盘符（`D:`），故 `:461`/`:477` 的守卫对 `D:/...` 形式**不触发** → 白名单形同未启用。补偿层不存在（`ctx.sandbox.confine(mode:'read-only')` 只限**写**不限读）。详见 `FRAGILITY.md` F-1 | `[源码]`+`[配置]` |
| 9 | **版本握手** | ⚠️ 部分 | 插件接口版本**强制**：worker 常量 `PLUGIN_INTERFACE_VERSION = 1` `dsh-markitdown-worker/src/index.ts:42`，随每次请求发出 `:190-191`；bridge 校验 `service.py::assert_version_compatible`（`init` `:142`）；**vendor 版本锚点未启用**：`expectedVendorVersion: ''` `[配置]` → 仅校验接口版本 | `[源码]`+`[配置]` |
| 10 | **错误映射** | ✅ | bridge 6 码 `vendor/bridge/markitdown_bridge/service.py:28-33`（`VERSION_MISMATCH`/`DEPENDENCY`/`UNSUPPORTED_FORMAT`/`CONVERSION_FAILED`/`INVALID_PARAMS`/`INTERNAL`）；TS 侧映射 4 类 `dsh-markitdown-worker/src/index.ts:99-108`；错误类定义 `dsh-integration/dsh-markitdown/src/index.ts:91,99,107,115,123` | `[源码]` |
| 11 | **事件发射** | ✅ | 发射 `dsh-markitdown-worker/src/index.ts:463` `ctx.emit('markitdown/converted', …)`；契约声明 `dsh-integration/dsh-markitdown/src/index.ts:179`（`@mode emit` = 只广播、不参与决策）；**当前无消费者**（emit-only，属设计允许） | `[源码]` |

补充：bridge 自报能力清单 `vendor/bridge/markitdown_bridge/service.py:147` → `["convert","convert_batch","cancel","health","ocr"]`，与本表 1/2/3/6/7 五项一一对应（`cancel` 对应 #7）。

---

## 二 未通电项与通电所需输入

| 项 | 未通电原因 | 通电所需输入 | 归口 |
|---|---|---|---|
| #3 OCR | `ocrBaseUrl` / `ocrModel` 为空串；凭证键 `markitdown/ocr` 未写入 | 一个 **OpenAI 兼容**、支持视觉（`image_url` data-URI）的端点：`baseUrl` + `model` + API key（写入 `ctx.credentials` 的 `markitdown/ocr`） | P1-1 |
| #5 `interactive` 传输 | profile `transportMode: 'collect'` | 切换 profile 值 + 实机观察（长驻进程、崩溃重启、健康探测） | P3-3 |
| #9 vendor 版本锚点 | `expectedVendorVersion: ''` | 填入 `vendor/markitdown/VENDORED_VERSION` 的值（当前锚点文件存在，仅未接线） | 可选 |

### OCR 端点的协议契约（决定"什么端点能用"）

来源：`vendor/markitdown/markitdown_ocr/_ocr_service.py:86-100`（`[源码]`）

| 要求 | 值 |
|---|---|
| 协议 | OpenAI **Chat Completions** |
| 调用形态 | `chat.completions.create`，`content: [{type:'text'}, {type:'image_url', image_url:{url}}]` |
| 图片传法 | `role: 'user'` + base64 **data URI** 内联（图片仅允许在 user 消息） |
| 输入格式 | 支持 JPEG/PNG/GIF/WebP；converter 统一转 PNG |
| 单图上限 | ≤32 MiB；最大边 8192px |
| 渲染分辨率 | 扫描件按 **300 DPI** 渲染（A4 ≈ 2480×3508） |

> ⚠️ 已知精度风险：若端点对单图 token 有上限（如 384 token → 自动降采样到约 800×800），300 DPI 渲染会被大幅降采样，**小字识别率只能靠 P1-1 实测判定**，不能靠"有无报错"判断。

---

## 三 复现命令

所有命令在仓库根 `D:/Git/github/markitdown-main/` 执行。Python 解释器用隔离 venv：`dsh-integration/.venv/Scripts/python.exe`。

```bash
# 0) 查看生效配置（#3 #4 #5 #9 的 [配置] 证据）
cat "$DSH_HOME/profiles/web/cordis.patch.yml"
dsh --profile web --dump-config | grep -A18 "id: markitdown-worker"

# 1) 单文件转换（#1 实跑）
printf 'hello\n' > Test/sample.txt
cd vendor/bridge && echo '{"op":"convert","params":{"source":"D:/Git/github/markitdown-main/Test/sample.txt"},"pluginInterfaceVersion":1,"expectedVendorVersion":null}' \
  | PYTHONUTF8=1 ../../dsh-integration/.venv/Scripts/python.exe -m markitdown_bridge.single

# 2) 批量 + 逐项隔离（#2）：混入一个不存在的路径，观察该项报错而其余成功
cd vendor/bridge && echo '{"op":"convert_batch","params":{"sources":["D:/Git/github/markitdown-main/Test/sample.txt","D:/Git/github/markitdown-main/Test/__nope__.pdf"]},"pluginInterfaceVersion":1,"expectedVendorVersion":null}' \
  | PYTHONUTF8=1 ../../dsh-integration/.venv/Scripts/python.exe -m markitdown_bridge.single

# 3) OCR 未通电的 Fail-Closed 行为（#3）：坏端点 → 期望 ok:false + MARKITDOWN_CONVERSION_FAILED
cd vendor/bridge && echo '{"op":"convert","params":{"source":"D:/Git/github/markitdown-main/Test/pdf_scanned_minimal.pdf","kwargs":{"ocr":{"baseUrl":"http://127.0.0.1:9/v1","apiKey":"dummy","model":"nonexistent-vision"}}},"pluginInterfaceVersion":1,"expectedVendorVersion":null}' \
  | PYTHONUTF8=1 ../../dsh-integration/.venv/Scripts/python.exe -m markitdown_bridge.single

# 4) 版本握手（#9）：错配接口版本 → 期望 MARKITDOWN_VERSION_MISMATCH
cd vendor/bridge && echo '{"op":"init","params":{"pluginInterfaceVersion":999},"pluginInterfaceVersion":999,"expectedVendorVersion":null}' \
  | PYTHONUTF8=1 ../../dsh-integration/.venv/Scripts/python.exe -m markitdown_bridge.single
```

> 路径白名单负例（#8）在 bridge 层不可复现——`assertPathAllowed` 在 **TS worker 侧**（`dsh-markitdown-worker/src/index.ts:119`），需实机经 `markitdown_convert` 传白名单外路径。归入 P1-3 运行时断言。
