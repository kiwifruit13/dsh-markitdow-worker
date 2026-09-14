# markitdown_bridge API 参考文档（自动生成）

> **本文档由 `generate_api_docs.py` 自动生成，以代码为唯一真相源**，人工修改会被下次生成覆盖。
> 若需更新 API 描述，请修改代码 docstring 后重新生成。

> 符号总数：14 ｜ docstring 覆盖率：35.7%

---

## `markitdown_bridge.service`

### `BridgeError`（类）

Common base class for all non-exit exceptions.

- 构造：`BridgeError(code: str, message: str) -> NoneType`

导出来源：`markitdown_bridge.service`

### `BridgeService`（类）

Holds MarkItDown instances (one per OCR config) and request bookkeeping.

- 构造：`BridgeService() -> NoneType`
- 方法（本类定义）：
  - `op_cancel(params: dict) -> dict`
  - `op_convert(params: dict) -> dict`
  - `op_convert_batch(params: dict) -> dict`
  - `op_health(params: dict) -> dict`
  - `op_init(params: dict) -> dict`
  - `run_op(op: str, params: dict) -> dict`
  - `run_request(req_id: str, op: str, params: dict) -> dict`

导出来源：`markitdown_bridge.service`

### `ERROR_CONVERSION_FAILED`（常量）

- 值：`'MARKITDOWN_CONVERSION_FAILED'`（类型 `str`）

导出来源：`markitdown_bridge.service`

### `ERROR_DEPENDENCY`（常量）

- 值：`'MARKITDOWN_DEPENDENCY'`（类型 `str`）

导出来源：`markitdown_bridge.service`

### `ERROR_INTERNAL`（常量）

- 值：`'MARKITDOWN_INTERNAL'`（类型 `str`）

导出来源：`markitdown_bridge.service`

### `ERROR_INVALID_PARAMS`（常量）

- 值：`'MARKITDOWN_INVALID_PARAMS'`（类型 `str`）

导出来源：`markitdown_bridge.service`

### `ERROR_UNSUPPORTED_FORMAT`（常量）

- 值：`'MARKITDOWN_UNSUPPORTED_FORMAT'`（类型 `str`）

导出来源：`markitdown_bridge.service`

### `ERROR_VERSION_MISMATCH`（常量）

- 值：`'MARKITDOWN_VERSION_MISMATCH'`（类型 `str`）

导出来源：`markitdown_bridge.service`

### `PLUGIN_INTERFACE_VERSION`（常量）

- 值：`1`（类型 `int`）

导出来源：`markitdown_bridge.service`

### `assert_version_compatible`（函数）

Validate client-declared versions against the vendored anchor (Fail-Closed).

- 签名：`assert_version_compatible(params: dict) -> dict`

导出来源：`markitdown_bridge.service`

### `emit_json`（函数）

One lossless-JSON line on stdout; ALL diagnostics belong on stderr.

- 签名：`emit_json(obj: dict) -> NoneType`

导出来源：`markitdown_bridge.service`

### `force_utf8_stdio`（函数）

- 签名：`force_utf8_stdio() -> NoneType`

导出来源：`markitdown_bridge.service`

### `ocr_default_from_env`（函数）

- 签名：`ocr_default_from_env() -> bool`

导出来源：`markitdown_bridge.service`

### `read_vendored_meta`（函数）

Parse vendor/markitdown/VENDORED_VERSION into a dict. Missing file = Fail-Closed.

- 签名：`read_vendored_meta() -> dict`

导出来源：`markitdown_bridge.service`

---

## 生成质量报告

- 符号构成：类 ×2、常量 ×7、函数 ×5
- 扫描模块数：2
- 无提示、无错误。
