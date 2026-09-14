# markitdown API 参考文档（自动生成）

> **本文档由 `generate_api_docs.py` 自动生成，以代码为唯一真相源**，人工修改会被下次生成覆盖。
> 若需更新 API 描述，请修改代码 docstring 后重新生成。

> 符号总数：34 ｜ docstring 覆盖率：91.2%

---

## `markitdown`

### `PRIORITY_GENERIC_FILE_FORMAT`（常量）

- 值：`10.0`（类型 `float`）

导出来源：`markitdown`

### `PRIORITY_SPECIFIC_FILE_FORMAT`（常量）

- 值：`0.0`（类型 `float`）

导出来源：`markitdown`

### `__version__`（常量）

- 值：`'0.1.8b1'`（类型 `str`）

导出来源：`markitdown`

---

## `markitdown._base_converter`

### `DocumentConverter`（类）

Abstract superclass of all DocumentConverters.

- 构造：`DocumentConverter()`
- 方法（本类定义）：
  - `accepts(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> bool` — Return a quick determination on if the converter should attempt converting the document.
  - `convert(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> DocumentConverterResult` — Convert a document to Markdown text.

导出来源：`markitdown`

### `DocumentConverterResult`（类）

The result of converting a document to Markdown.

- 构造：`DocumentConverterResult(markdown: str, title: Optional[str] = None)`
- 属性：
  - `text_content: str` — Soft-deprecated alias for `markdown`. New code should migrate to using `markdown` or __str__.

导出来源：`markitdown`

---

## `markitdown._exceptions`

### `FailedConversionAttempt`（类）

Represents a single attempt to convert a file.

- 构造：`FailedConversionAttempt(converter: Any, exc_info: Optional[tuple] = None)`

导出来源：`markitdown`

### `FileConversionException`（类）

Thrown when a suitable converter was found, but the conversion
process fails for any reason.

- 构造：`FileConversionException(message: Optional[str] = None, attempts: Optional[List[FailedConversionAttempt]] = None)`

导出来源：`markitdown`

### `MarkItDownException`（类）

Base exception class for MarkItDown.

- 构造：`MarkItDownException(...)`

导出来源：`markitdown`

### `MissingDependencyException`（类）

Converters shipped with MarkItDown may depend on optional
dependencies. This exception is thrown when a converter's
convert() method is called, but the required dependency is not
installed. This is not necessarily a fatal error, as the converter
will simply be skipped (an error will bubble up only if no other
suitable converter is found).

Error messages should clearly indicate which dependency is missing.

- 构造：`MissingDependencyException(...)`

导出来源：`markitdown`

### `UnsupportedFormatException`（类）

Thrown when no suitable converter was found for the given file.

- 构造：`UnsupportedFormatException(...)`

导出来源：`markitdown`

---

## `markitdown._markitdown`

### `MarkItDown`（类）

(In preview) An extremely simple text-based document reader, suitable for LLM use.
This reader will convert common file-types or webpages to Markdown.

- 构造：`MarkItDown(enable_builtins: Optional[bool] = None, enable_plugins: Optional[bool] = None, **kwargs)`
- 方法（本类定义）：
  - `convert(source: Union[str, requests.models.Response, pathlib._local.Path, BinaryIO], stream_info: Optional[StreamInfo] = None, **kwargs: Any) -> DocumentConverterResult` — Args:
  - `convert_local(path: Union[str, pathlib._local.Path], stream_info: Optional[StreamInfo] = None, file_extension: Optional[str] = None, url: Optional[str] = None, **kwargs: Any) -> DocumentConverterResult`
  - `convert_response(response: Response, stream_info: Optional[StreamInfo] = None, file_extension: Optional[str] = None, url: Optional[str] = None, **kwargs: Any) -> DocumentConverterResult`
  - `convert_stream(stream: BinaryIO, stream_info: Optional[StreamInfo] = None, file_extension: Optional[str] = None, url: Optional[str] = None, **kwargs: Any) -> DocumentConverterResult`
  - `convert_uri(uri: str, stream_info: Optional[StreamInfo] = None, file_extension: Optional[str] = None, mock_url: Optional[str] = None, **kwargs: Any) -> DocumentConverterResult`
  - `convert_url(url: str, stream_info: Optional[StreamInfo] = None, file_extension: Optional[str] = None, mock_url: Optional[str] = None, **kwargs: Any) -> DocumentConverterResult` — Alias for convert_uri()
  - `enable_builtins(**kwargs) -> NoneType` — Enable and register built-in converters.
  - `enable_plugins(**kwargs) -> NoneType` — Enable and register converters provided by plugins.
  - `register_converter(converter: DocumentConverter, priority: float = 0.0) -> NoneType` — Register a DocumentConverter with a given priority.
  - `register_page_converter(converter: DocumentConverter) -> NoneType` — DEPRECATED: Use register_converter instead.

导出来源：`markitdown`

---

## `markitdown._stream_info`

### `StreamInfo`（数据类）

The StreamInfo class is used to store information about a file stream.
All fields can be None, and will depend on how the stream was opened.

构造参数与字段一致：

| 字段 | 类型 | 默认值 |
|------|------|--------|
| `mimetype` | `Optional[str]` | `None` |
| `extension` | `Optional[str]` | `None` |
| `charset` | `Optional[str]` | `None` |
| `filename` | `Optional[str]` | `None` |
| `local_path` | `Optional[str]` | `None` |
| `url` | `Optional[str]` | `None` |

导出来源：`markitdown`

---

## `markitdown.converters._audio_converter`

### `AudioConverter`（类）

Converts audio files to markdown via extraction of metadata (if `exiftool` is installed), and speech transcription (if `speech_recognition` is installed).

- 构造：`AudioConverter()`
- 方法（本类定义）：
  - `accepts(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> bool` — Return a quick determination on if the converter should attempt converting the document.
  - `convert(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> DocumentConverterResult` — Convert a document to Markdown text.

导出来源：`markitdown.converters`

---

## `markitdown.converters._bing_serp_converter`

### `BingSerpConverter`（类）

Handle Bing results pages (only the organic search results).
NOTE: It is better to use the Bing API

- 构造：`BingSerpConverter()`
- 方法（本类定义）：
  - `accepts(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> bool` — Make sure we're dealing with HTML content *from* Bing.
  - `convert(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> DocumentConverterResult` — Convert a document to Markdown text.

导出来源：`markitdown.converters`

---

## `markitdown.converters._csv_converter`

### `CsvConverter`（类）

Converts CSV files to Markdown tables.

- 构造：`CsvConverter()`
- 方法（本类定义）：
  - `accepts(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> bool` — Return a quick determination on if the converter should attempt converting the document.
  - `convert(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> DocumentConverterResult` — Convert a document to Markdown text.

导出来源：`markitdown.converters`

---

## `markitdown.converters._cu_converter`

### `ContentUnderstandingConverter`（类）

Converts files using Azure Content Understanding.

Provides high-quality document, image, audio, and video conversion
with structured field extraction via YAML front matter.

- 构造：`ContentUnderstandingConverter(endpoint: str, credential: AzureKeyCredential | TokenCredential | None = None, analyzer_id: Optional[str] = None, file_types: Optional[List[ContentUnderstandingFileType]] = None)`
- 方法（本类定义）：
  - `accepts(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> bool` — Return True if the file type is in the configured set.
  - `convert(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> DocumentConverterResult` — Convert the file using CU and return Markdown with YAML front matter.

导出来源：`markitdown.converters`

### `ContentUnderstandingFileType`（枚举）

Supported file types for Content Understanding conversion.

| 成员 | 值 |
|------|-----|
| `PDF` | `'pdf'` |
| `DOCX` | `'docx'` |
| `PPTX` | `'pptx'` |
| `XLSX` | `'xlsx'` |
| `HTML` | `'html'` |
| `TXT` | `'txt'` |
| `MD` | `'md'` |
| `RTF` | `'rtf'` |
| `XML` | `'xml'` |
| `EML` | `'eml'` |
| `MSG` | `'msg'` |
| `JPEG` | `'jpeg'` |
| `PNG` | `'png'` |
| `BMP` | `'bmp'` |
| `TIFF` | `'tiff'` |
| `HEIF` | `'heif'` |
| `MP4` | `'mp4'` |
| `M4V` | `'m4v'` |
| `MOV` | `'mov'` |
| `AVI` | `'avi'` |
| `MKV` | `'mkv'` |
| `WEBM` | `'webm'` |
| `FLV` | `'flv'` |
| `WMV` | `'wmv'` |
| `WAV` | `'wav'` |
| `MP3` | `'mp3'` |
| `M4A` | `'m4a'` |
| `FLAC` | `'flac'` |
| `OGG` | `'ogg'` |
| `AAC` | `'aac'` |
| `WMA` | `'wma'` |

导出来源：`markitdown.converters`

---

## `markitdown.converters._doc_intel_converter`

### `DocumentIntelligenceConverter`（类）

Specialized DocumentConverter that uses Document Intelligence to extract text from documents.

- 构造：`DocumentIntelligenceConverter(endpoint: str, api_version: str | None = None, credential: AzureKeyCredential | TokenCredential | None = None, file_types: List[DocumentIntelligenceFileType] = [<DocumentIntelligenceFileType.DOCX: 'docx'>, <DocumentIn...)`
- 方法（本类定义）：
  - `accepts(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> bool` — Return a quick determination on if the converter should attempt converting the document.
  - `convert(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> DocumentConverterResult` — Convert a document to Markdown text.

导出来源：`markitdown.converters`

### `DocumentIntelligenceFileType`（枚举）

Enum of file types supported by the Document Intelligence Converter.

| 成员 | 值 |
|------|-----|
| `DOCX` | `'docx'` |
| `PPTX` | `'pptx'` |
| `XLSX` | `'xlsx'` |
| `HTML` | `'html'` |
| `PDF` | `'pdf'` |
| `JPEG` | `'jpeg'` |
| `PNG` | `'png'` |
| `BMP` | `'bmp'` |
| `TIFF` | `'tiff'` |

导出来源：`markitdown.converters`

---

## `markitdown.converters._docx_converter`

### `DocxConverter`（类）

Converts DOCX files to Markdown. Style information (e.g., headings) and tables are preserved where possible.

- 构造：`DocxConverter()`
- 方法（本类定义）：
  - `accepts(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> bool` — Return a quick determination on if the converter should attempt converting the document.
  - `convert(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> DocumentConverterResult` — Convert a document to Markdown text.

导出来源：`markitdown.converters`

---

## `markitdown.converters._epub_converter`

### `EpubConverter`（类）

Converts EPUB files to Markdown. Style information (e.g., headings) and tables are preserved where possible.

- 构造：`EpubConverter()`
- 方法（本类定义）：
  - `accepts(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> bool` — Return a quick determination on if the converter should attempt converting the document.
  - `convert(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> DocumentConverterResult` — Convert a document to Markdown text.

导出来源：`markitdown.converters`

---

## `markitdown.converters._html_converter`

### `HtmlConverter`（类）

Anything with content type text/html

- 构造：`HtmlConverter()`
- 方法（本类定义）：
  - `accepts(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> bool` — Return a quick determination on if the converter should attempt converting the document.
  - `convert(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> DocumentConverterResult` — Convert a document to Markdown text.
  - `convert_string(html_content: str, url: Optional[str] = None, **kwargs) -> DocumentConverterResult` — Non-standard convenience method to convert a string to markdown.

导出来源：`markitdown.converters`

---

## `markitdown.converters._image_converter`

### `ImageConverter`（类）

Converts images to markdown via extraction of metadata (if `exiftool` is installed), and description via a multimodal LLM (if an llm_client is configured).

- 构造：`ImageConverter()`
- 方法（本类定义）：
  - `accepts(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> bool` — Return a quick determination on if the converter should attempt converting the document.
  - `convert(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> DocumentConverterResult` — Convert a document to Markdown text.

导出来源：`markitdown.converters`

---

## `markitdown.converters._ipynb_converter`

### `IpynbConverter`（类）

Converts Jupyter Notebook (.ipynb) files to Markdown.

- 构造：`IpynbConverter()`
- 方法（本类定义）：
  - `accepts(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> bool` — Return a quick determination on if the converter should attempt converting the document.
  - `convert(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> DocumentConverterResult` — Convert a document to Markdown text.

导出来源：`markitdown.converters`

---

## `markitdown.converters._outlook_msg_converter`

### `OutlookMsgConverter`（类）

Converts Outlook .msg files to markdown by extracting email metadata and content.

Uses the olefile package to parse the .msg file structure and extract:
- Email headers (From, To, Subject)
- Email body content

- 构造：`OutlookMsgConverter()`
- 方法（本类定义）：
  - `accepts(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> bool` — Return a quick determination on if the converter should attempt converting the document.
  - `convert(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> DocumentConverterResult` — Convert a document to Markdown text.

导出来源：`markitdown.converters`

---

## `markitdown.converters._pdf_converter`

### `PdfConverter`（类）

Converts PDFs to Markdown.
Supports extracting tables into aligned Markdown format (via pdfplumber).
Falls back to pdfminer if pdfplumber is missing or fails.

- 构造：`PdfConverter()`
- 方法（本类定义）：
  - `accepts(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> bool` — Return a quick determination on if the converter should attempt converting the document.
  - `convert(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> DocumentConverterResult` — Convert a document to Markdown text.

导出来源：`markitdown.converters`

---

## `markitdown.converters._plain_text_converter`

### `PlainTextConverter`（类）

Anything with content type text/plain

- 构造：`PlainTextConverter()`
- 方法（本类定义）：
  - `accepts(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> bool` — Return a quick determination on if the converter should attempt converting the document.
  - `convert(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> DocumentConverterResult` — Convert a document to Markdown text.

导出来源：`markitdown.converters`

---

## `markitdown.converters._pptx_converter`

### `PptxConverter`（类）

Converts PPTX files to Markdown. Supports heading, tables and images with alt text.

- 构造：`PptxConverter()`
- 方法（本类定义）：
  - `accepts(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> bool` — Return a quick determination on if the converter should attempt converting the document.
  - `convert(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> DocumentConverterResult` — Convert a document to Markdown text.

导出来源：`markitdown.converters`

---

## `markitdown.converters._rss_converter`

### `RssConverter`（类）

Convert RSS / Atom type to markdown

- 构造：`RssConverter()`
- 方法（本类定义）：
  - `accepts(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> bool` — Return a quick determination on if the converter should attempt converting the document.
  - `convert(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> DocumentConverterResult` — Convert a document to Markdown text.

导出来源：`markitdown.converters`

---

## `markitdown.converters._wikipedia_converter`

### `WikipediaConverter`（类）

Handle Wikipedia pages separately, focusing only on the main document content.

- 构造：`WikipediaConverter()`
- 方法（本类定义）：
  - `accepts(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> bool` — Make sure we're dealing with HTML content *from* Wikipedia.
  - `convert(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> DocumentConverterResult` — Convert a document to Markdown text.

导出来源：`markitdown.converters`

---

## `markitdown.converters._xlsx_converter`

### `XlsConverter`（类）

Converts XLS files to Markdown, with each sheet presented as a separate Markdown table.

- 构造：`XlsConverter()`
- 方法（本类定义）：
  - `accepts(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> bool` — Return a quick determination on if the converter should attempt converting the document.
  - `convert(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> DocumentConverterResult` — Convert a document to Markdown text.

导出来源：`markitdown.converters`

### `XlsxConverter`（类）

Converts XLSX files to Markdown, with each sheet presented as a separate Markdown table.

- 构造：`XlsxConverter()`
- 方法（本类定义）：
  - `accepts(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> bool` — Return a quick determination on if the converter should attempt converting the document.
  - `convert(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> DocumentConverterResult` — Convert a document to Markdown text.

导出来源：`markitdown.converters`

---

## `markitdown.converters._youtube_converter`

### `YouTubeConverter`（类）

Extract YouTube metadata and transcripts, or fall back to HTML.

- 构造：`YouTubeConverter()`
- 方法（本类定义）：
  - `accepts(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> bool` — Make sure we're dealing with HTML content *from* YouTube.
  - `convert(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> DocumentConverterResult` — Convert a document to Markdown text.

导出来源：`markitdown.converters`

---

## `markitdown.converters._zip_converter`

### `ZipConverter`（类）

Converts ZIP files to markdown by extracting and converting all contained files.

The converter extracts the ZIP contents to a temporary directory, processes each file
using appropriate converters based on file extensions, and then combines the results
into a single markdown document. The temporary directory is cleaned up after processing.

Example output format:
```markdown
Content from the zip file `example.zip`:

## File: docs/readme.txt

This is the content of readme.txt
Multiple lines are preserved

## File: images/example.jpg

ImageSize: 1920x1080
DateTimeOriginal: 2024-02-15 14:30:00
Description: A beautiful landscape photo

## File: data/report.xlsx

## Sheet1
| Column1 | Column2 | Column3 |
|---------|---------|---------|
| data1   | data2   | data3   |
| data4   | data5   | data6   |
```

Key features:
- Maintains original file structure in headings
- Processes nested files recursively
- Uses appropriate converters for each file type
- Preserves formatting of converted content
- Cleans up temporary files after processing

- 构造：`ZipConverter(markitdown: MarkItDown)`
- 方法（本类定义）：
  - `accepts(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> bool` — Return a quick determination on if the converter should attempt converting the document.
  - `convert(file_stream: BinaryIO, stream_info: StreamInfo, **kwargs: Any) -> DocumentConverterResult` — Convert a document to Markdown text.

导出来源：`markitdown.converters`

---

## 生成质量报告

- 符号构成：类 ×28、常量 ×3、数据类 ×1、枚举 ×2
- 扫描模块数：38
- 提示：
  - 模块 `markitdown.__about__` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.__main__` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown._base_converter` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown._exceptions` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown._markitdown` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown._stream_info` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown._uri_utils` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converter_utils.docx.math.latex_dict` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converter_utils.docx.math.omml` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converter_utils.docx.math` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converter_utils.docx.pre_process` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converter_utils.docx` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converter_utils` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converters._audio_converter` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converters._bing_serp_converter` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converters._csv_converter` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converters._cu_converter` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converters._doc_intel_converter` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converters._docx_converter` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converters._epub_converter` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converters._exiftool` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converters._html_converter` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converters._image_converter` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converters._ipynb_converter` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converters._llm_caption` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converters._markdownify` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converters._outlook_msg_converter` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converters._pdf_converter` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converters._plain_text_converter` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converters._pptx_converter` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converters._rss_converter` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converters._transcribe_audio` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converters._wikipedia_converter` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converters._xlsx_converter` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converters._youtube_converter` 未声明 __all__，其符号不进入公开文档
  - 模块 `markitdown.converters._zip_converter` 未声明 __all__，其符号不进入公开文档
