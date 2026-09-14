# markitdown_bridge 符号速查表（自动生成）

> **本文档由 `generate_api_docs.py` 自动生成，以代码为唯一真相源**，人工修改会被下次生成覆盖。
> 若需更新 API 描述，请修改代码 docstring 后重新生成。

> 列出全部公开符号及其定义模块与导出来源；再导出符号已去重。

| 符号 | 类型 | 定义模块 | 导出来源 | 说明 |
|------|------|----------|----------|------|
| `BridgeError` | 类 | `markitdown_bridge.service` | `markitdown_bridge.service` | Common base class for all non-exit exceptions. |
| `BridgeService` | 类 | `markitdown_bridge.service` | `markitdown_bridge.service` | Holds MarkItDown instances (one per OCR config) and reque... |
| `ERROR_CONVERSION_FAILED` | 常量 | `markitdown_bridge.service` | `markitdown_bridge.service` | - |
| `ERROR_DEPENDENCY` | 常量 | `markitdown_bridge.service` | `markitdown_bridge.service` | - |
| `ERROR_INTERNAL` | 常量 | `markitdown_bridge.service` | `markitdown_bridge.service` | - |
| `ERROR_INVALID_PARAMS` | 常量 | `markitdown_bridge.service` | `markitdown_bridge.service` | - |
| `ERROR_UNSUPPORTED_FORMAT` | 常量 | `markitdown_bridge.service` | `markitdown_bridge.service` | - |
| `ERROR_VERSION_MISMATCH` | 常量 | `markitdown_bridge.service` | `markitdown_bridge.service` | - |
| `PLUGIN_INTERFACE_VERSION` | 常量 | `markitdown_bridge.service` | `markitdown_bridge.service` | - |
| `assert_version_compatible` | 函数 | `markitdown_bridge.service` | `markitdown_bridge.service` | Validate client-declared versions against the vendored an... |
| `emit_json` | 函数 | `markitdown_bridge.service` | `markitdown_bridge.service` | One lossless-JSON line on stdout; ALL diagnostics belong ... |
| `force_utf8_stdio` | 函数 | `markitdown_bridge.service` | `markitdown_bridge.service` | - |
| `ocr_default_from_env` | 函数 | `markitdown_bridge.service` | `markitdown_bridge.service` | - |
| `read_vendored_meta` | 函数 | `markitdown_bridge.service` | `markitdown_bridge.service` | Parse vendor/markitdown/VENDORED_VERSION into a dict. Mis... |
