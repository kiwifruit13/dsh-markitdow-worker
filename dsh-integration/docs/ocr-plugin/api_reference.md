# markitdown_ocr API 参考文档（自动生成）

> **本文档由 `generate_api_docs.py` 自动生成，以代码为唯一真相源**，人工修改会被下次生成覆盖。
> 若需更新 API 描述，请修改代码 docstring 后重新生成。

> 符号总数：9 ｜ docstring 覆盖率：77.8%

---

## `markitdown_ocr`

### `__plugin_interface_version__`（常量）

- 值：`1`（类型 `int`）

导出来源：`markitdown_ocr`

### `__version__`（常量）

- 值：`'0.1.1b1'`（类型 `str`）

导出来源：`markitdown_ocr`

---

## `markitdown_ocr._docx_converter_with_ocr`

### `DocxConverterWithOCR`（类）

Enhanced DOCX Converter with OCR support for embedded images.
Maintains document flow while extracting text from images inline.

- 构造：`DocxConverterWithOCR(ocr_service: Optional[LLMVisionOCRService] = None)`
- 方法（本类定义）：
  - `accepts(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> bool` — Return a quick determination on if the converter should attempt converting the document.
  - `convert(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> DocumentConverterResult` — Convert a document to Markdown text.

导出来源：`markitdown_ocr`

---

## `markitdown_ocr._ocr_service`

### `LLMVisionOCRService`（类）

OCR service using LLM vision models (OpenAI-compatible).

- 构造：`LLMVisionOCRService(client: Any, model: str, default_prompt: str | None = None) -> NoneType`
- 方法（本类定义）：
  - `extract_text(image_stream: BinaryIO, prompt: str | None = None, stream_info: markitdown._stream_info.StreamInfo | None = None, **kwargs: Any) -> OCRResult` — Extract text using LLM vision.

导出来源：`markitdown_ocr`

### `OCRResult`（数据类）

Result from OCR extraction.

构造参数与字段一致：

| 字段 | 类型 | 默认值 |
|------|------|--------|
| `text` | `str` | `（必填）` |
| `confidence` | `float | None` | `None` |
| `backend_used` | `str | None` | `None` |
| `error` | `str | None` | `None` |

导出来源：`markitdown_ocr`

---

## `markitdown_ocr._pdf_converter_with_ocr`

### `PdfConverterWithOCR`（类）

Enhanced PDF Converter with OCR support for embedded images.
Maintains document structure while extracting text from images inline.

- 构造：`PdfConverterWithOCR(ocr_service: Optional[LLMVisionOCRService] = None)`
- 方法（本类定义）：
  - `accepts(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> bool` — Return a quick determination on if the converter should attempt converting the document.
  - `convert(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> DocumentConverterResult` — Convert a document to Markdown text.

导出来源：`markitdown_ocr`

---

## `markitdown_ocr._plugin`

### `register_converters`（函数）

Register OCR-enhanced converters with MarkItDown.

This plugin provides OCR support for PDF, DOCX, PPTX, and XLSX files.
The converters are registered with priority -1.0 to run BEFORE built-in
converters (which have priority 0.0), effectively replacing them when
the plugin is enabled.

Args:
    markitdown: MarkItDown instance to register converters with
    **kwargs: Additional keyword arguments that may include:
        - llm_client: OpenAI-compatible client for LLM-based OCR (required for OCR to work)
        - llm_model: Model name (e.g., 'gpt-4o')
        - llm_prompt: Custom prompt for text extraction

- 签名：`register_converters(markitdown: MarkItDown, **kwargs: Any) -> NoneType`

导出来源：`markitdown_ocr`

---

## `markitdown_ocr._pptx_converter_with_ocr`

### `PptxConverterWithOCR`（类）

Enhanced PPTX Converter with OCR fallback.

- 构造：`PptxConverterWithOCR(ocr_service: Optional[LLMVisionOCRService] = None)`
- 方法（本类定义）：
  - `accepts(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> bool` — Return a quick determination on if the converter should attempt converting the document.
  - `convert(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> DocumentConverterResult` — Convert a document to Markdown text.

导出来源：`markitdown_ocr`

---

## `markitdown_ocr._xlsx_converter_with_ocr`

### `XlsxConverterWithOCR`（类）

Enhanced XLSX Converter with OCR support for embedded images.
Extracts images with their cell positions and performs OCR.

- 构造：`XlsxConverterWithOCR(ocr_service: Optional[LLMVisionOCRService] = None)`
- 方法（本类定义）：
  - `accepts(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> bool` — Return a quick determination on if the converter should attempt converting the document.
  - `convert(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> DocumentConverterResult` — Convert a document to Markdown text.

导出来源：`markitdown_ocr`

---

## 生成质量报告

- 符号构成：类 ×5、常量 ×2、数据类 ×1、函数 ×1
- 扫描模块数：8
- 提示：
  - 模块 `markitdown_ocr.__about__` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown_ocr._docx_converter_with_ocr` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown_ocr._ocr_service` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown_ocr._pdf_converter_with_ocr` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown_ocr._plugin` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown_ocr._pptx_converter_with_ocr` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown_ocr._xlsx_converter_with_ocr` 未声明 __all__，其符号不进入公开文档
