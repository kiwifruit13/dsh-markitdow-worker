# markitdown 符号速查表（自动生成）

> **本文档由 `generate_api_docs.py` 自动生成，以代码为唯一真相源**，人工修改会被下次生成覆盖。
> 若需更新 API 描述，请修改代码 docstring 后重新生成。

> 列出全部公开符号及其定义模块与导出来源；再导出符号已去重。

| 符号 | 类型 | 定义模块 | 导出来源 | 说明 |
|------|------|----------|----------|------|
| `AudioConverter` | 类 | `markitdown.converters._audio_converter` | `markitdown.converters` | Converts audio files to markdown via extraction of metada... |
| `BingSerpConverter` | 类 | `markitdown.converters._bing_serp_converter` | `markitdown.converters` | Handle Bing results pages (only the organic search results). |
| `ContentUnderstandingConverter` | 类 | `markitdown.converters._cu_converter` | `markitdown.converters` | Converts files using Azure Content Understanding. |
| `ContentUnderstandingFileType` | 枚举 | `markitdown.converters._cu_converter` | `markitdown.converters` | Supported file types for Content Understanding conversion. |
| `CsvConverter` | 类 | `markitdown.converters._csv_converter` | `markitdown.converters` | Converts CSV files to Markdown tables. |
| `DocumentConverter` | 类 | `markitdown._base_converter` | `markitdown` | Abstract superclass of all DocumentConverters. |
| `DocumentConverterResult` | 类 | `markitdown._base_converter` | `markitdown` | The result of converting a document to Markdown. |
| `DocumentIntelligenceConverter` | 类 | `markitdown.converters._doc_intel_converter` | `markitdown.converters` | Specialized DocumentConverter that uses Document Intellig... |
| `DocumentIntelligenceFileType` | 枚举 | `markitdown.converters._doc_intel_converter` | `markitdown.converters` | Enum of file types supported by the Document Intelligence... |
| `DocxConverter` | 类 | `markitdown.converters._docx_converter` | `markitdown.converters` | Converts DOCX files to Markdown. Style information (e.g.,... |
| `EpubConverter` | 类 | `markitdown.converters._epub_converter` | `markitdown.converters` | Converts EPUB files to Markdown. Style information (e.g.,... |
| `FailedConversionAttempt` | 类 | `markitdown._exceptions` | `markitdown` | Represents a single attempt to convert a file. |
| `FileConversionException` | 类 | `markitdown._exceptions` | `markitdown` | Thrown when a suitable converter was found, but the conve... |
| `HtmlConverter` | 类 | `markitdown.converters._html_converter` | `markitdown.converters` | Anything with content type text/html |
| `ImageConverter` | 类 | `markitdown.converters._image_converter` | `markitdown.converters` | Converts images to markdown via extraction of metadata (i... |
| `IpynbConverter` | 类 | `markitdown.converters._ipynb_converter` | `markitdown.converters` | Converts Jupyter Notebook (.ipynb) files to Markdown. |
| `MarkItDown` | 类 | `markitdown._markitdown` | `markitdown` | (In preview) An extremely simple text-based document read... |
| `MarkItDownException` | 类 | `markitdown._exceptions` | `markitdown` | Base exception class for MarkItDown. |
| `MissingDependencyException` | 类 | `markitdown._exceptions` | `markitdown` | Converters shipped with MarkItDown may depend on optional |
| `OutlookMsgConverter` | 类 | `markitdown.converters._outlook_msg_converter` | `markitdown.converters` | Converts Outlook .msg files to markdown by extracting ema... |
| `PRIORITY_GENERIC_FILE_FORMAT` | 常量 | `markitdown` | `markitdown` | - |
| `PRIORITY_SPECIFIC_FILE_FORMAT` | 常量 | `markitdown` | `markitdown` | - |
| `PdfConverter` | 类 | `markitdown.converters._pdf_converter` | `markitdown.converters` | Converts PDFs to Markdown. |
| `PlainTextConverter` | 类 | `markitdown.converters._plain_text_converter` | `markitdown.converters` | Anything with content type text/plain |
| `PptxConverter` | 类 | `markitdown.converters._pptx_converter` | `markitdown.converters` | Converts PPTX files to Markdown. Supports heading, tables... |
| `RssConverter` | 类 | `markitdown.converters._rss_converter` | `markitdown.converters` | Convert RSS / Atom type to markdown |
| `StreamInfo` | 数据类 | `markitdown._stream_info` | `markitdown` | The StreamInfo class is used to store information about a... |
| `UnsupportedFormatException` | 类 | `markitdown._exceptions` | `markitdown` | Thrown when no suitable converter was found for the given... |
| `WikipediaConverter` | 类 | `markitdown.converters._wikipedia_converter` | `markitdown.converters` | Handle Wikipedia pages separately, focusing only on the m... |
| `XlsConverter` | 类 | `markitdown.converters._xlsx_converter` | `markitdown.converters` | Converts XLS files to Markdown, with each sheet presented... |
| `XlsxConverter` | 类 | `markitdown.converters._xlsx_converter` | `markitdown.converters` | Converts XLSX files to Markdown, with each sheet presente... |
| `YouTubeConverter` | 类 | `markitdown.converters._youtube_converter` | `markitdown.converters` | Extract YouTube metadata and transcripts, or fall back to... |
| `ZipConverter` | 类 | `markitdown.converters._zip_converter` | `markitdown.converters` | Converts ZIP files to markdown by extracting and converti... |
| `__version__` | 常量 | `markitdown` | `markitdown` | - |
