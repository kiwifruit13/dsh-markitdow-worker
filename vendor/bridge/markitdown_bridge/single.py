"""Single-shot entry (`python -m markitdown_bridge.single`).

Default transport for the DSH provider (collect mode): one process per request.
Reads ONE JSON request object from stdin:
    {"op": "convert|convert_batch|init", "params": {...},
     "pluginInterfaceVersion": 1, "expectedVendorVersion": "..."|null}
Writes ONE JSON response object to stdout, then exits.

This shape is immune to the SubprocessHandle contract drift (streaming vs
done/collected): the provider only needs spawn + full-output collection +
exit, which both contract generations support.
"""

import json
import sys

from .service import (
    BridgeError,
    BridgeService,
    ERROR_INTERNAL,
    ERROR_INVALID_PARAMS,
    emit_json,
    force_utf8_stdio,
)

force_utf8_stdio()


def main() -> int:
    service = BridgeService()
    raw = sys.stdin.read()
    try:
        req = json.loads(raw)
        op = str(req["op"])
        params = req.get("params") or {}
        version_params = {
            "pluginInterfaceVersion": req.get("pluginInterfaceVersion"),
            "expectedVendorVersion": req.get("expectedVendorVersion"),
        }
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        emit_json({"ok": False, "error": {"code": ERROR_INVALID_PARAMS, "message": f"malformed request: {exc}"}})
        return 1

    try:
        # Version gate runs on EVERY invocation (Fail-Closed per request).
        service.run_op("init", version_params)
        result = service.run_op(op, params)
        emit_json({"ok": True, "result": result})
        return 0
    except BridgeError as exc:
        emit_json({"ok": False, "error": {"code": exc.code, "message": exc.message}})
        return 1
    except Exception as exc:  # noqa: BLE001 — last-resort containment
        emit_json({"ok": False, "error": {"code": ERROR_INTERNAL, "message": str(exc)}})
        return 1


if __name__ == "__main__":
    sys.exit(main())
