"""Shared bridge service logic — used by both the interactive NDJSON server
(`python -m markitdown_bridge`) and the single-shot entry (`python -m markitdown_bridge.single`).

Keeping ops in one module prevents semantic drift between the two transports.
"""

import json
import os
import sys
import threading
from pathlib import Path

_BRIDGE_DIR = Path(__file__).resolve().parent.parent          # vendor/bridge
_VENDOR_ROOT = _BRIDGE_DIR.parent                              # vendor/
_VENDOR_MARKITDOWN = _VENDOR_ROOT / "markitdown"               # vendor/markitdown

sys.path.insert(0, str(_VENDOR_MARKITDOWN))                    # markitdown/, markitdown_ocr/

from markitdown import (  # noqa: E402
    MarkItDown,
    MarkItDownException,
    MissingDependencyException,
    UnsupportedFormatException,
)

ERROR_PREFIX = "MARKITDOWN_"

ERROR_VERSION_MISMATCH = ERROR_PREFIX + "VERSION_MISMATCH"
ERROR_DEPENDENCY = ERROR_PREFIX + "DEPENDENCY"
ERROR_UNSUPPORTED_FORMAT = ERROR_PREFIX + "UNSUPPORTED_FORMAT"
ERROR_CONVERSION_FAILED = ERROR_PREFIX + "CONVERSION_FAILED"
ERROR_INVALID_PARAMS = ERROR_PREFIX + "INVALID_PARAMS"
ERROR_INTERNAL = ERROR_PREFIX + "INTERNAL"

PLUGIN_INTERFACE_VERSION = 1

__all__ = [
    "PLUGIN_INTERFACE_VERSION",
    "ERROR_VERSION_MISMATCH",
    "ERROR_DEPENDENCY",
    "ERROR_UNSUPPORTED_FORMAT",
    "ERROR_CONVERSION_FAILED",
    "ERROR_INVALID_PARAMS",
    "ERROR_INTERNAL",
    "BridgeError",
    "BridgeService",
    "read_vendored_meta",
    "assert_version_compatible",
    "emit_json",
    "force_utf8_stdio",
    "ocr_default_from_env",
]


class BridgeError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def read_vendored_meta() -> dict:
    """Parse vendor/markitdown/VENDORED_VERSION into a dict. Missing file = Fail-Closed."""
    meta_path = _VENDOR_MARKITDOWN / "VENDORED_VERSION"
    if not meta_path.is_file():
        raise RuntimeError(f"VENDORED_VERSION missing at {meta_path}")
    meta = {}
    for raw in meta_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        meta[key.strip()] = value.strip()
    if "VENDORED_VERSION" not in meta or "PLUGIN_INTERFACE_VERSION" not in meta:
        raise RuntimeError("VENDORED_VERSION file is malformed")
    return meta


def assert_version_compatible(params: dict) -> dict:
    """Validate client-declared versions against the vendored anchor (Fail-Closed)."""
    client_version = params.get("pluginInterfaceVersion")
    client_vendor = params.get("expectedVendorVersion")
    vendored = read_vendored_meta()
    if client_version != int(vendored["PLUGIN_INTERFACE_VERSION"]):
        raise BridgeError(
            ERROR_VERSION_MISMATCH,
            f"plugin interface version mismatch: client={client_version} "
            f"vendored={vendored['PLUGIN_INTERFACE_VERSION']}",
        )
    if client_vendor is not None and client_vendor != "" and client_vendor != vendored["VENDORED_VERSION"]:
        raise BridgeError(
            ERROR_VERSION_MISMATCH,
            f"vendored version mismatch: client={client_vendor} "
            f"vendored={vendored['VENDORED_VERSION']}",
        )
    return vendored


class BridgeService:
    """Holds MarkItDown instances (one per OCR config) and request bookkeeping."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._pending: dict[str, dict] = {}   # id -> {"running": bool} (interactive mode only)
        self._md_cache: dict[tuple, MarkItDown] = {}

    # ---- instance management ------------------------------------------

    def _get_markitdown(self, ocr_key: tuple | None) -> MarkItDown:
        """One MarkItDown instance per OCR configuration (converters differ when OCR is on)."""
        with self._lock:
            if ocr_key in self._md_cache:
                return self._md_cache[ocr_key]
            md = MarkItDown(enable_builtins=True, enable_plugins=False)
            if ocr_key is not None:
                # Vendored code is NOT pip-installed → entry_points(group="markitdown.plugin")
                # cannot discover markitdown_ocr. Manual registration replicates the plugin path.
                from markitdown_ocr._plugin import register_converters

                base_url, api_key, model, prompt = ocr_key
                from openai import OpenAI

                client = OpenAI(base_url=base_url, api_key=api_key)
                register_converters(md, llm_client=client, llm_model=model, llm_prompt=prompt)
            self._md_cache[ocr_key] = md
            return md

    # ---- op handlers ---------------------------------------------------

    def _resolve_ocr_key(self, kwargs: dict) -> tuple | None:
        ocr = kwargs.get("ocr")
        if not ocr:
            return None
        base_url = ocr.get("baseUrl")
        api_key = ocr.get("apiKey")
        model = ocr.get("model")
        if not (base_url and api_key and model):
            raise BridgeError(ERROR_INVALID_PARAMS, "ocr requires baseUrl, apiKey and model")
        return (base_url, api_key, model, ocr.get("prompt"))

    def op_init(self, params: dict) -> dict:
        vendored = assert_version_compatible(params)
        return {
            "version": "1.0.0",
            "pluginInterfaceVersion": int(vendored["PLUGIN_INTERFACE_VERSION"]),
            "vendoredVersion": vendored["VENDORED_VERSION"],
            "capabilities": ["convert", "convert_batch", "cancel", "health", "ocr"],
        }

    def _convert_one(self, source: str, kwargs: dict) -> dict:
        md = self._get_markitdown(self._resolve_ocr_key(kwargs))
        try:
            result = md.convert(source)
        except MissingDependencyException as exc:
            raise BridgeError(ERROR_DEPENDENCY, str(exc)) from exc
        except UnsupportedFormatException as exc:
            raise BridgeError(ERROR_UNSUPPORTED_FORMAT, str(exc)) from exc
        except MarkItDownException as exc:
            raise BridgeError(ERROR_CONVERSION_FAILED, str(exc)) from exc
        except ImportError as exc:
            raise BridgeError(ERROR_DEPENDENCY, str(exc)) from exc
        except OSError as exc:
            # File read failures surface as OSError; keep the resource path out of the message.
            raise BridgeError(ERROR_CONVERSION_FAILED, f"could not read source: {exc.errno}") from exc
        payload = {
            "markdown": result.markdown,
            "meta": {"chars": len(result.markdown), "source": source},
        }
        # Upstream `title` is `str | None`. JSON has no `undefined`, and the DSH
        # value-schema validator REJECTS `null` against `type: 'string'`
        # (json-schema.ts:607) while SKIPPING absent keys (json-schema.ts:569).
        # Omitting the key is therefore the only shape that satisfies the TS
        # contract `title?: string` — a null would fail output validation.
        if result.title is not None:
            payload["title"] = result.title
        return payload

    def op_convert(self, params: dict) -> dict:
        source = params.get("source")
        if not isinstance(source, str) or not source:
            raise BridgeError(ERROR_INVALID_PARAMS, "convert requires non-empty 'source'")
        kwargs = params.get("kwargs") or {}
        return self._convert_one(source, kwargs)

    def op_convert_batch(self, params: dict) -> dict:
        sources = params.get("sources")
        if not isinstance(sources, list) or not sources:
            raise BridgeError(ERROR_INVALID_PARAMS, "convert_batch requires non-empty 'sources' array")
        kwargs = params.get("kwargs") or {}
        items = []
        for source in sources:
            try:
                item = {"source": source, **self._convert_one(source, kwargs)}
            except BridgeError as exc:
                item = {"source": source, "error": {"code": exc.code, "message": exc.message}}
            items.append(item)
        return {"items": items}

    def op_cancel(self, params: dict) -> dict:
        target = params.get("targetId")
        if not isinstance(target, str):
            raise BridgeError(ERROR_INVALID_PARAMS, "cancel requires 'targetId'")
        with self._lock:
            entry = self._pending.pop(target, None)
        was_running = bool(entry and entry.get("running"))
        return {"cancelled": entry is not None and not was_running, "wasRunning": was_running}

    def op_health(self, params: dict) -> dict:
        with self._lock:
            return {"ok": True, "pending": len(self._pending)}

    # ---- dispatch -------------------------------------------------------

    def run_op(self, op: str, params: dict) -> dict:
        handler = {
            "init": self.op_init,
            "convert": self.op_convert,
            "convert_batch": self.op_convert_batch,
            "cancel": self.op_cancel,
            "health": self.op_health,
        }.get(op)
        if handler is None:
            raise BridgeError(ERROR_INVALID_PARAMS, f"unknown op: {op}")
        return handler(params)

    # ---- interactive-mode request lifecycle -----------------------------

    def run_request(self, req_id: str, op: str, params: dict) -> dict:
        with self._lock:
            self._pending[req_id] = {"running": True}
        try:
            return self.run_op(op, params)
        finally:
            with self._lock:
                self._pending.pop(req_id, None)


def emit_json(obj: dict) -> None:
    """One lossless-JSON line on stdout; ALL diagnostics belong on stderr."""
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def force_utf8_stdio() -> None:
    import io

    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", write_through=True)
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", write_through=True)


def ocr_default_from_env() -> bool:
    return os.environ.get("MARKITDOWN_BRIDGE_OCR", "").lower() in ("1", "true", "yes")
