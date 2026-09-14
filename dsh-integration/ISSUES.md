# dsh-tool-markitdown 插件故障排查记录

日期：2026-09-14
状态：已解决并验证（2026-09-14 13:55 复测：`markitdown_convert` 单条 + `markitdown_convert_batch` 批量 2/2 succeeded，无 title 校验报错）。

---

## 问题 1：`markitdown_convert` 返回 `"value.title" must be a string`

### 症状

调用 `markitdown_convert` 转换任何文件时，如果 Python 侧的 `MarkitdownResult.title` 为 `undefined`（大多数纯文本、markdown 文件），工具报错：

```
Error: tool "markitdown_convert" returned invalid output: "value.title" must be a string
```

### 根因（13:52 订正 —— 原写法把 `null` 误记为 `undefined`）

- `MarkitdownResult.title` 类型上是可选的（`title?: string`），但 Python 侧 `result.title` 对无标题文档是 **`None`**（`str | None`），bridge 直接序列化成 JSON **`null`**（实跑实证）
- DSH 工具壳里 `execute` 的 `title !== undefined` 判断**拦不住 `null`**（`null !== undefined` 为 `true`），于是 `{ title: null }` 被原样返回
- output schema 的 `title` 声明为 `{ type: 'string' }`；校验器对**存在且非 undefined** 的属性执行类型检查 → `typeof null !== 'string'` → 拒绝
- 精确说：校验器**跳过 `undefined` 属性**（`json-schema.ts:569`），但 `null` 会进入子校验（`:607`），因此报 `"value.title" must be a string`

### 走过的弯路（已撤销）

曾尝试在 schema 里给 `title` 加 `optional: true`：

```ts
title: { type: 'string', optional: true },
```

**这是错的。** 查 DSH 源码 `packages/core/tools/src/schema.ts:193` 的 `assertAuthorKeys`：

- 字符串 schema 的合法键白名单 = `ANNOTATION_KEYS`（`description`、`title`、`default`、`examples`）+ `type` + `enum` + `const`
- **`optional` 不在这个白名单里**，加上会直接触发 `authorError: ${path}.optional is not supported by the value schema DSL`
- DSH 的 value-schema DSL 里对象属性缺省就是可选的，没有 `optional` 概念（只有顶层参数属性才用 `required: true`）

已回退到 `title: { type: 'string' }`。

### 正确修复

在 `execute` 里条件返回，`title` 为 `undefined` 时直接不写入该键：

```ts
async execute(args, exec): Promise<CanonicalConvert> {
  const ocr = await resolveOcr(args.ocr)
  const result: MarkitdownResult = await ctx.markitdown.convert(args.source, { ocr }, exec.signal)
  // `title` is optional in MarkitdownResult; omit the key when undefined so the
  // output-schema check (title not in `required`) sees a clean object.
  return result.title !== undefined
    ? { markdown: result.markdown, title: result.title, meta: result.meta }
    : { markdown: result.markdown, meta: result.meta }
}
```

已修改文件：`src/index.ts`
已重新 build 并同步到 `C:\Users\kiwif\.dsh\profiles\web\node_modules\@kiwifruit\dsh-tool-markitdown\lib\index.js`

---

## 问题 2：修复同步后工具仍报相同错误（已定位并解决，详见下方"诊断结论"13:52 订正）

### 症状

修改并 build 后，确认 `lib/index.js` 第 110-112 行包含条件返回逻辑，hash 与 repo 同步，但工具调用仍然报：

```
Error: tool "markitdown_convert" returned invalid output: "value.title" must be a string
```

### 排查过程

1. 确认安装位置 `@kiwifruit/dsh-tool-markitdown` 是**普通目录 copy**（非 symlink/junction）
   - `Get-Item LinkType` 为空
   - 安装目录与 repo 目录的 hash 不同步前不同，同步后相同
2. 确认 DSH 进程启动时间（`Get-CimInstance Win32_Process`）
   - 主 DSH web 进程（`dsh web`）PID 15120，启动于 13:33:36
   - 修改 `lib/index.js` 在 13:33:36 之后
   - 理论上进程应该加载了新文件
3. 用 `cordis_inspect_self` 查看插件状态：`plugins: []`
   - **DSH 动态插件列表为空**——说明 `tool-markitdown` 可能没有被 DSH 识别为活跃插件
4. 直接调 `markitdown_convert` 仍然报错

### 未确认的疑点

- `cordis_inspect_self` 返回空 plugins 列表，可能说明：
  - 该插件是以 **Cordis 静态组合**（cordis.yml 挂载）而非动态 Plugin 的形式加载的
  - 或者 DSH Web 进程没有加载该插件（启动参数 / profile 问题）
  - 需要检查 DSH 进程启动日志或 `dsh --dump-config` 确认 `tool-markitdown` 是否真的被挂载
- 错误消息 `"value.title" must be a string` 的格式与 schema 校验错误完全吻合，说明插件**确实被调用了**，但执行的是**旧代码**
- 可能是 DSH Web 进程有热缓存机制（`require` cache / `import` cache），重启后仍加载了缓存的旧模块

### 待办

- [ ] 跑 `dsh --profile web --dump-config` 确认 `tool-markitdown` 在配置里
- [ ] 检查 DSH Web 进程日志确认插件加载状态
- [ ] 彻底杀掉所有 DSH Web 相关 node 进程后再重启
- [ ] 确认重启后 `markitdown_convert` 是否恢复正常

---

## 问题 3：安装目录是 copy 而非 link，容易忘记同步（流程隐患）

### 现象

`dsh-integration/dsh-tool-markitdown` 通过 `dsh plugin add file:...] 安装到 `~/.dsh/profiles/web/node_modules/@kiwifruit/`，安装结果是**普通目录 copy**。每次修改源码 + build 后，必须手动 `Copy-Item` 到安装位置，DSH 重启后才生效。

### 建议

长期方案改为 pnpm `link:` 或 `file:` 引用指向 repo 路径（pnpm 的 `link:` 协议会创建 symlink），这样 build 后立即生效，无需手动同步。README 里的"已知边界"提到跨机场景需要用 `fix-paths.ps1` 重写 `link:` 绝对路径，说明原作者知道这个机制。

---

## 诊断结论（2026-09-14 13:45，助手核对，逐条实证）

### 问题 1 —— ✅ 已解决，根因分析正确
`execute` 条件返回已落地。补充一处精确表述：schema 里 `title: { type: 'string' }` **未声明 `required` = 该键本身可省略**，失败点是 `execute` 返回了 `{ title: undefined }`（键存在、值为 `undefined`），`type: 'string'` 校验因此失败。省略键即通过。

### 问题 2 —— ✅ 已定位：真正根因是 **`null`**，不是"未重启进程"

> ⚠️ **本节为 13:52 订正**。13:45 的诊断曾判为"报错实例陈旧、需重启"——**该判断不成立**。磁盘与安装均无问题，是 **`execute` 的修复条件漏掉了 `null`**。

**根因链（逐环节实证）**

| 环节 | 事实 | 证据 |
|---|---|---|
| Python 上游 | 无标题文档的 `result.title` 是 `None` | markitdown `DocumentConverterResult.title: str \| None` |
| bridge 序列化（修复前） | `{"title": result.title}` → JSON **`null`** | 实跑 single-shot：`{"markdown":"hello untitled sample\n","title":null,"meta":{...}}` |
| tool 侧条件 | `result.title !== undefined` —— **`null !== undefined` 为 `true`** → 走第一分支，产出 `{ title: null }` | `src/index.ts:167`（修复前） |
| 校验器 | 键存在且 `!== undefined` → 进入子校验 → `typeof null !== 'string'` → 报错 | `json-schema.ts:568-571` + `:607` |
| 报错文案 | `"value.title" must be a string` | 与实机日志**逐字一致** |

**校验器对「缺键 / undefined / null」的三种行为（探针实测：直接调用宿主 `validateJsonSchemaValue`）**

| 载荷 | 结果 |
|---|---|
| `{ markdown, meta }`（无 title 键） | ✅ **PASS** |
| `{ markdown, title: undefined, meta }` | ❌ FAIL：`"value" must be a lossless JSON object`（整对象含 undefined 即非无损 JSON） |
| `{ markdown, title: null, meta }` | ❌ FAIL：`"value.title" must be a string` ← **本故障** |
| `{ markdown, title: 'Doc', meta }` | ✅ **PASS** |

→ **`"absent"` 是"无标题"的唯一无损编码**。`undefined` 与 `null` **都会失败，只是报错文案不同**——这正解释了为什么"改成省略键"能解决，而"只判 `undefined`"不能。

**最终修复（双层，已落地）**
1. **bridge**（`vendor/bridge/markitdown_bridge/service.py`）：`title is None` 时**不写该键**。实跑验证 → 输出变为 `{"markdown":...,"meta":{...}}`（title 键消失）。
2. **tool**（`dsh-tool-markitdown/src/index.ts`）：改用 `typeof result.title === 'string'` —— 即使对接旧版 bridge 送来的 `null` 也会省略键。运行树产物 `lib/index.js:113` 已核验。

**同步影响**：定义包 `MarkitdownResult.title` 注释已写明"键缺席、绝不为 null"的契约；`api-plus --check` 复跑 **EXIT=0**（符号签名未变，无漂移）。

**保留的原核查项（仍然有效）**：安装目录内容与 repo 逐字节一致（`6776cdcd578f5951`）；无旧副本；`.dsh-module-fallback` 内无 markitdown 条目；`cordis_inspect_self` 的 `plugins: []` 是**客户端动态插件**清单，与静态组合无关（报错本身即证明工具已注册执行）；Node/ESM 无跨进程模块缓存。

**行动**：重启 DSH 进程（退出用 `Ctrl+C`，勿用 `y` 强杀，否则残留 `$DSH_HOME/profiles/node_modules.lock`）→ 复测 `markitdown_convert` 转换 `Test/` 下的文件。

### 问题 3 —— 事实成立，但 `link:` 不是直接替代项
- 事实正确：`dsh plugin add file:` 在 pnpm 下是**目录拷贝**，改完源码必须重新 `build` + 重新安装才生效。
- 但 `link:` 不能直接替换 `dsh plugin add file:` —— pnpm 的 `link:` **不拉依赖闭包**，profile 侧需自行保证 provider/consumer 的全部依赖（`@kiwifruit/dsh-markitdown`、`@deepseek-ai/*`）可解析。
- **推荐开发循环**：改源码 → `pnpm run build:lib` → `dsh plugin --profile web remove @kiwifruit/dsh-tool-markitdown` + `add file:<abs>` → 重启进程。要更快迭代可改用 `--patch` 临时覆盖层（不动 profile 树）。
- 若确需 link 化，需单独评估依赖闭包与 profile 解析锚，不建议顺手改。

### 附：核对中发现并已处理 / 需注意
1. **残留垃圾目录（已删除）**：`profiles/web/node_modules/dsh-tool-markitdown_tmp_9316_2` —— pnpm 安装中断遗留（包名仍为旧的无 scope 名 + `v0.1.0-rc.3`，29 个文件）。删除后 profile 内 markitdown 条目只剩 `@kiwifruit/*` 三个。
2. **`Test` 目录当前为空** —— 复测前请先放入测试文件。
3. ⚠️ **行为变更提醒（非 bug）**：`allowedReadRoots` 已改为 **Fail-Closed**（空数组 = 拒绝所有本地路径），当前白名单**只含 `D:/Git/github/markitdown-main/Test`**。转换该目录外的路径会报 `[sandbox: file access denied outside allowed read roots]` —— 这是预期行为。
