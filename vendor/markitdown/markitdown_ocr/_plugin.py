"""
Plugin registration for markitdown-ocr.
Registers OCR-enhanced converters with priority-based replacement strategy.
"""

from typing import Any
from markitdown import MarkItDown
from markitdown.converters import (
    DocxConverter,
    PdfConverter,
    PptxConverter,
    XlsConverter,
    XlsxConverter,
)

from ._ocr_service import LLMVisionOCRService
from ._pdf_converter_with_ocr import PdfConverterWithOCR
from ._docx_converter_with_ocr import DocxConverterWithOCR
from ._pptx_converter_with_ocr import PptxConverterWithOCR
from ._xlsx_converter_with_ocr import XlsxConverterWithOCR


__plugin_interface_version__ = 1


def register_converters(markitdown: MarkItDown, **kwargs: Any) -> None:
    """
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
    """
    # Create OCR service — reads the same llm_client/llm_model kwargs
    # that MarkItDown itself already accepts for image descriptions
    llm_client = kwargs.get("llm_client")
    llm_model = kwargs.get("llm_model")
    llm_prompt = kwargs.get("llm_prompt")

    ocr_service: LLMVisionOCRService | None = None
    if llm_client and llm_model:
        ocr_service = LLMVisionOCRService(
            client=llm_client,
            model=llm_model,
            default_prompt=llm_prompt,
        )

    # Fail-Closed: markitdown's convert loop swallows a converter's exception and
    # falls through to the next accepting converter (_markitdown.py:675-677), so
    # leaving the built-ins registered would silently downgrade an OCR failure
    # (wrong model name, unreachable endpoint, auth error) into a non-OCR
    # conversion. When OCR is explicitly enabled, the OCR-enhanced converters must
    # be the ONLY handlers for these formats.
    # `_converters` is the canonical registration list carried by MarkItDown.
    if ocr_service is not None:
        replaced = (
            PdfConverter,
            DocxConverter,
            PptxConverter,
            XlsxConverter,
            XlsConverter,
        )
        markitdown._converters = [
            registration
            for registration in markitdown._converters
            if not isinstance(registration.converter, replaced)
        ]

    # Register converters with priority -1.0 (before built-ins at 0.0)
    # This effectively "replaces" the built-in converters when plugin is installed
    # Pass the OCR service to each converter's constructor
    PRIORITY_OCR_ENHANCED = -1.0

    markitdown.register_converter(
        PdfConverterWithOCR(ocr_service=ocr_service), priority=PRIORITY_OCR_ENHANCED
    )

    markitdown.register_converter(
        DocxConverterWithOCR(ocr_service=ocr_service), priority=PRIORITY_OCR_ENHANCED
    )

    markitdown.register_converter(
        PptxConverterWithOCR(ocr_service=ocr_service), priority=PRIORITY_OCR_ENHANCED
    )

    markitdown.register_converter(
        XlsxConverterWithOCR(ocr_service=ocr_service), priority=PRIORITY_OCR_ENHANCED
    )
