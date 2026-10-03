"""
VeatsAI — AutoCAD Electrical MCP server.

Drives a running AutoCAD Electrical (Windows, COM automation) and exposes MCP tools:

  autocad_status                 – is AutoCAD / the Electrical toolset running, open drawings
  draw_motor_panel_schematic     – VeatsAI CAD contract JSON -> new DWG with intelligent IEC
                                   AutoCAD Electrical symbols (TAG1/DESC1/RATING1/MFG/CAT) + wires
  insert_electrical_symbol       – insert one library symbol (e.g. VCB1) with attributes
  list_electrical_symbols        – search the symbol library
  save_active_drawing            – save the active drawing as DWG

Transports:
  python server.py                      -> stdio (Claude Code / any MCP client, see .mcp.json)
  python server.py --http [--port 8765] -> streamable HTTP on 127.0.0.1 (used by the VeatsAI web app)

Output is a PRELIMINARY drawing for engineer review — not a certified design.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any

import pythoncom
import win32com.client
from mcp.server.mcpserver import MCPServer

ACADE_YEAR = os.environ.get("ACADE_YEAR", "2027")
SYMBOL_LIB = Path(os.environ.get("ACADE_SYMBOL_LIB", rf"C:\Users\Public\Documents\Autodesk\Acade {ACADE_YEAR}\Libs\iec2"))
OUTPUT_DIR = Path(os.environ.get("VEATS_CAD_OUTPUT", Path.home() / "Documents" / "VeatsAI" / "drawings"))

# CAD contract component type -> IEC2 vertical symbol, tag prefix, distance from insertion point to top/bottom terminal.
SYMBOLS: dict[str, dict[str, Any]] = {
    "breaker": {"block": "VCB1", "prefix": "Q", "top": 7.5, "bottom": -7.5},
    "mpcb": {"block": "VCB1", "prefix": "Q", "top": 7.5, "bottom": -7.5},
    "disconnect": {"block": "VDS11", "prefix": "Q", "top": 7.5, "bottom": -7.5},
    "contactor": {"block": "VMS1", "prefix": "K", "top": 7.5, "bottom": -7.5},
    "soft_starter": {"block": "VMS1", "prefix": "K", "top": 7.5, "bottom": -7.5},
    "overload": {"block": "VOL1", "prefix": "F", "top": 7.5, "bottom": -7.5},
    "motor": {"block": "VMO1M3", "prefix": "M", "top": 22.5, "bottom": None},
    "vfd": {"block": None, "prefix": "U", "top": 7.5, "bottom": -7.5},  # drawn as a labelled box
}
WIRE_LAYER = "WIRES"  # AutoCAD Electrical wire layer defined by the WD_M block
COL_W = 45.0  # feeder column spacing
GAP = 12.0  # wire length between devices

# --------------------------------------------------------------------------- COM plumbing
# All COM calls run on ONE dedicated thread (COM apartment), never on the asyncio loop.

_executor = ThreadPoolExecutor(max_workers=1, initializer=pythoncom.CoInitialize, thread_name_prefix="acad-com")
RPC_E_CALL_REJECTED = -2147418111
RPC_E_SERVERCALL_RETRYLATER = -2147417846


def _retry(fn, attempts: int = 40, delay: float = 0.25):
    """AutoCAD rejects COM calls while busy; retry those transparently."""
    for i in range(attempts):
        try:
            return fn()
        except pythoncom.com_error as e:  # type: ignore[attr-defined]
            if e.hresult in (RPC_E_CALL_REJECTED, RPC_E_SERVERCALL_RETRYLATER) and i < attempts - 1:
                time.sleep(delay)
                continue
            raise


async def _run(fn, *args):
    return await asyncio.get_running_loop().run_in_executor(_executor, lambda: fn(*args))


def _app():
    try:
        return _retry(lambda: win32com.client.GetActiveObject("AutoCAD.Application"))
    except pythoncom.com_error:  # type: ignore[attr-defined]
        raise RuntimeError("AutoCAD is not running. Start AutoCAD Electrical and try again.")


def _wait_quiet(app, timeout: float = 20.0):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if app.GetAcadState().IsQuiescent:
                return
        except pythoncom.com_error:  # type: ignore[attr-defined]
            pass
        time.sleep(0.2)
    raise RuntimeError("AutoCAD is busy (a dialog or command is waiting for input). Close it in AutoCAD and retry.")


def _pt(x: float, y: float):
    return win32com.client.VARIANT(pythoncom.VT_ARRAY | pythoncom.VT_R8, (float(x), float(y), 0.0))


def _electrical_loaded(app) -> bool:
    try:
        return any(a.lower().startswith(("wd_", "ace")) for a in app.ListArx())
    except Exception:
        return False


def _ensure_layer(doc, name: str, color: int):
    try:
        layer = doc.Layers.Item(name)
    except pythoncom.com_error:  # type: ignore[attr-defined]
        layer = doc.Layers.Add(name)
        layer.Color = color
    return layer


_ASCII = {"—": "-", "–": "-", "×": "x", "≥": ">=", "≤": "<=", "·": "-", "Δ": "D", "√": "sqrt", "°": " deg", "²": "2", "ë": "e", "Ë": "E", "ç": "c", "Ç": "C"}


def _ascii(s: Any) -> str:
    """AutoCAD TEXT/attributes are code-page based; map common symbols to safe ASCII."""
    return "".join(_ASCII.get(ch, ch if ord(ch) < 128 else "?") for ch in str(s))


def _lisp_str(s: str) -> str:
    return s.replace("\\", "/").replace('"', '\\"')


def _insert_symbol(app, doc, block: str, x: float, y: float, attrs: dict[str, str]):
    """Insert an intelligent AutoCAD Electrical symbol via its API (c:wd_insym2) and fill attributes."""
    path = SYMBOL_LIB / f"{block}.dwg"
    if not path.exists():
        raise FileNotFoundError(f"Symbol {block} not found in {SYMBOL_LIB}")
    ms = doc.ModelSpace
    before = _retry(lambda: ms.Count)
    _retry(lambda: doc.SendCommand(f'(c:wd_insym2 "{_lisp_str(str(path))}" (list {x} {y} 0.0) 1.0 nil)\n'))
    _wait_quiet(app)
    if _retry(lambda: ms.Count) <= before:
        raise RuntimeError(f"AutoCAD Electrical did not insert {block}. Is the Electrical toolset loaded?")
    ent = _retry(lambda: ms.Item(ms.Count - 1))
    if attrs:
        for att in _retry(lambda: ent.GetAttributes()):
            tag = att.TagString
            if tag in attrs and attrs[tag] is not None:
                att.TextString = _ascii(attrs[tag])[:250]
    return ent


def _add_text(ms, text: str, x: float, y: float, h: float = 3.0, layer: str = "VEATS_TEXT"):
    t = _retry(lambda: ms.AddText(_ascii(text), _pt(x, y), h))
    t.Layer = layer
    return t


def _box(ms, x: float, y: float, tag: str, name: str, rating: str):
    """Generic device (e.g. VFD) where the IEC library has no standard symbol: 16 x 15 box with tag."""
    for (a, b, c, e) in ((x - 8, y - 7.5, x + 8, y - 7.5), (x + 8, y - 7.5, x + 8, y + 7.5), (x + 8, y + 7.5, x - 8, y + 7.5), (x - 8, y + 7.5, x - 8, y - 7.5)):
        ln = _retry(lambda a=a, b=b, c=c, e=e: ms.AddLine(_pt(a, b), _pt(c, e)))
        ln.Layer = "VEATS_TEXT"
    _add_text(ms, tag, x - 5, y - 1, 3.0)
    _add_text(ms, f"{name} {rating}".strip(), x + 10, y, 2.0)


def _wire(ms, x1, y1, x2, y2):
    ln = _retry(lambda: ms.AddLine(_pt(x1, y1), _pt(x2, y2)))
    ln.Layer = WIRE_LAYER
    return ln


# --------------------------------------------------------------------------- operations


def op_status() -> dict:
    try:
        app = _app()
    except RuntimeError as e:
        return {"running": False, "message": str(e)}
    docs = [_retry(lambda i=i: app.Documents.Item(i).Name) for i in range(_retry(lambda: app.Documents.Count))]
    return {
        "running": True,
        "product": _retry(lambda: app.Name),
        "version": _retry(lambda: app.Version),
        "electrical_toolset_loaded": _electrical_loaded(app),
        "symbol_library": str(SYMBOL_LIB),
        "symbol_library_found": SYMBOL_LIB.exists(),
        "open_drawings": docs,
        "output_dir": str(OUTPUT_DIR),
    }


def _expand_feeders(contract: dict) -> list[dict]:
    """One column per physical motor (motor groups are expanded by quantity)."""
    comps = contract.get("components", [])
    feeders = []
    for motor in [c for c in comps if c.get("type") == "motor"]:
        group = motor.get("group", 0)
        devices = [c for c in comps if c.get("group") == group and c.get("type") in SYMBOLS and c.get("type") != "motor"]
        for i in range(int(motor.get("quantity") or 1)):
            feeders.append({"motor": motor, "devices": devices, "index": i, "total": int(motor.get("quantity") or 1)})
    return feeders


def op_draw(contract: dict, save_path: str | None) -> dict:
    app = _app()
    if not _electrical_loaded(app):
        raise RuntimeError("AutoCAD is running but the Electrical toolset is not loaded. Start 'AutoCAD Electrical'.")
    if not SYMBOL_LIB.exists():
        raise RuntimeError(f"Symbol library not found: {SYMBOL_LIB} (set ACADE_SYMBOL_LIB)")

    doc = _retry(lambda: app.Documents.Add())
    _retry(lambda: doc.Activate())
    _wait_quiet(app)
    ms = doc.ModelSpace

    # WD_M carries the AutoCAD Electrical drawing settings; inserting it up-front avoids the
    # "Special block WD_M needs to be added" dialog that would otherwise block automation.
    _retry(lambda: ms.InsertBlock(_pt(0, 0), str(SYMBOL_LIB / "wd_m.dwg"), 1.0, 1.0, 1.0, 0.0))
    for name, color in ((WIRE_LAYER, 3), ("VEATS_TEXT", 7), ("VEATS_TITLE", 8)):
        _ensure_layer(doc, name, color)

    feeders = _expand_feeders(contract)
    if not feeders:
        raise ValueError("CAD contract contains no motor feeders.")
    shown = feeders[:12]
    width = max(len(shown) * COL_W, 120.0)
    x0 = COL_W / 2
    cx = x0 + (len(shown) - 1) * COL_W / 2
    counters: dict[str, int] = {}
    inserted = 0

    def next_tag(prefix: str) -> str:
        counters[prefix] = counters.get(prefix, 0) + 1
        return f"{prefix}{counters[prefix]}"

    comps = contract.get("components", [])
    supply = next((c for c in comps if c.get("type") == "supply"), {})
    main = next((c for c in comps if c.get("type") == "breaker" and c.get("group") is None), None)

    # Incoming supply + main breaker
    top_y = 0.0
    _add_text(ms, "INCOMING SUPPLY", cx - 15, top_y + 26, 3.0)
    _add_text(ms, supply.get("rating", ""), cx - 15, top_y + 21, 2.5)
    main_y = top_y
    _wire(ms, cx, main_y + 18, cx, main_y + 7.5)
    if main:
        _insert_symbol(app, doc, "VCB1", cx, main_y, {"TAG1": "Q0", "DESC1": main.get("name", "Main breaker"), "RATING1": main.get("rating", ""),
                                                        "MFG": main.get("manufacturer", ""), "CAT": main.get("catalog", "")})
        inserted += 1
        counters["Q"] = 0

    # Busbar
    bus_y = main_y - 7.5 - GAP
    _wire(ms, cx, main_y - 7.5, cx, bus_y)
    _wire(ms, min(x0, cx) - 8, bus_y, max(x0 + (len(shown) - 1) * COL_W, cx) + 8, bus_y)
    _add_text(ms, "L1/L2/L3  " + (next((c.get("rating", "") for c in comps if c.get("type") == "busbar"), "")), max(x0 + (len(shown) - 1) * COL_W, cx) + 10, bus_y - 1, 2.5)

    lowest = bus_y
    for col, f in enumerate(shown):
        x = x0 + col * COL_W
        y_conn = bus_y  # current connection point (bottom of previous element)
        for d in f["devices"]:
            spec = SYMBOLS[d["type"]]
            y_ins = y_conn - GAP - spec["top"]
            _wire(ms, x, y_conn, x, y_ins + spec["top"])
            tag = next_tag(spec["prefix"])
            if spec["block"] is None:
                _box(ms, x, y_ins, tag, d.get("name", ""), d.get("rating", ""))
            else:
                _insert_symbol(app, doc, spec["block"], x, y_ins, {
                    "TAG1": tag, "DESC1": d.get("name", ""), "RATING1": d.get("rating", ""),
                    "MFG": d.get("manufacturer", ""), "CAT": d.get("catalog", ""),
                })
                inserted += 1
            y_conn = y_ins + spec["bottom"]
        m = f["motor"]
        spec = SYMBOLS["motor"]
        y_ins = y_conn - GAP - spec["top"]
        _wire(ms, x, y_conn, x, y_ins + spec["top"])
        label = f'{m.get("name", "M")}{"." + str(f["index"] + 1) if f["total"] > 1 else ""}'
        _insert_symbol(app, doc, spec["block"], x, y_ins, {
            "TAG1": next_tag("M"), "DESC1": label, "DESC2": f'{m.get("power_kw", "")} kW',
            "RATING1": m.get("rating", ""),
        })
        inserted += 1
        lowest = min(lowest, y_ins - 20)

    if len(feeders) > len(shown):
        _add_text(ms, f"+{len(feeders) - len(shown)} more feeders (see BOM)", x0 + len(shown) * COL_W, bus_y - 20, 2.5)

    # Title block
    tb_y = lowest - 30
    frame_w = width + 40
    left = min(x0, cx) - 25
    for (a, b, c, e) in ((left, tb_y, left + frame_w, tb_y), (left + frame_w, tb_y, left + frame_w, tb_y + 22),
                         (left + frame_w, tb_y + 22, left, tb_y + 22), (left, tb_y + 22, left, tb_y)):
        ln = _retry(lambda a=a, b=b, c=c, e=e: ms.AddLine(_pt(a, b), _pt(c, e)))
        ln.Layer = "VEATS_TITLE"
    _add_text(ms, contract.get("project", "VeatsAI project"), left + 4, tb_y + 14, 4.0, "VEATS_TITLE")
    _add_text(ms, f'Single-line power schematic - {contract.get("standard", "IEC")}-referenced - {contract.get("voltage", "")} V - '
                  f"PRELIMINARY, requires engineer review - generated by VeatsAI {datetime.now():%Y-%m-%d %H:%M}",
              left + 4, tb_y + 6, 2.2, "VEATS_TITLE")

    _retry(lambda: app.ZoomExtents())

    target = Path(save_path) if save_path else OUTPUT_DIR / f"veatsai-{_slug(contract.get('project', 'project'))}-{datetime.now():%Y%m%d-%H%M%S}.dwg"
    if target.suffix.lower() != ".dwg":
        raise ValueError("save_path must end with .dwg")
    target.parent.mkdir(parents=True, exist_ok=True)
    _retry(lambda: doc.SaveAs(str(target)))
    return {
        "dwg_path": str(target),
        "drawing": target.name,
        "symbols_inserted": inserted,
        "feeders_drawn": len(shown),
        "feeders_total": len(feeders),
        "note": "Preliminary AutoCAD Electrical schematic — tags/wires should be verified (and re-tagged if needed) by the engineer.",
    }


def _slug(s: str) -> str:
    out = "".join(ch if ch.isalnum() else "-" for ch in s.lower())
    return "-".join(p for p in out.split("-") if p)[:50] or "project"


def op_insert(symbol: str, x: float, y: float, attributes: dict[str, str] | None) -> dict:
    app = _app()
    doc = _retry(lambda: app.ActiveDocument)
    _wait_quiet(app)
    ent = _insert_symbol(app, doc, symbol, x, y, attributes or {})
    atts = {a.TagString: a.TextString for a in _retry(lambda: ent.GetAttributes())}
    return {"drawing": doc.Name, "block": ent.EffectiveName, "family": atts.get("FAMILY"), "tag": atts.get("TAG1")}


def op_list(query: str, limit: int) -> dict:
    q = query.upper()
    names = sorted(p.stem for p in SYMBOL_LIB.glob("*.dwg") if q in p.stem.upper())
    return {"library": str(SYMBOL_LIB), "count": len(names), "symbols": names[:limit]}


def op_save(path: str | None) -> dict:
    app = _app()
    doc = _retry(lambda: app.ActiveDocument)
    if path:
        if not path.lower().endswith(".dwg"):
            raise ValueError("path must end with .dwg")
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        _retry(lambda: doc.SaveAs(path))
    else:
        _retry(lambda: doc.Save())
    return {"saved": _retry(lambda: doc.FullName)}


# --------------------------------------------------------------------------- MCP tools

mcp = MCPServer(
    "veatsai-autocad-electrical",
    instructions=(
        "Controls a running AutoCAD Electrical on this Windows machine. Use draw_motor_panel_schematic with a VeatsAI "
        "CAD contract to create a preliminary schematic DWG. Drawings are preliminary and require engineer review."
    ),
)


@mcp.tool()
async def autocad_status() -> dict:
    """Check whether AutoCAD Electrical is running, the Electrical toolset is loaded, and list open drawings."""
    return await _run(op_status)


@mcp.tool()
async def draw_motor_panel_schematic(contract: dict, save_path: str | None = None) -> dict:
    """Create a NEW AutoCAD Electrical drawing from a VeatsAI CAD contract and save it as DWG.

    contract: {"project": str, "voltage": number, "standard": "IEC", "components": [
        {"type": "supply"|"breaker"|"mpcb"|"contactor"|"overload"|"soft_starter"|"motor"|"busbar",
         "name": str, "quantity"?: int, "rating"?: str, "power_kw"?: number, "group"?: int,
         "manufacturer"?: str, "catalog"?: str}]}
    Components with the same "group" form one motor feeder; the main breaker has no group.
    Inserts intelligent IEC symbols (iec2 library) with TAG1/DESC1/RATING1/MFG/CAT and draws wires.
    """
    return await _run(op_draw, contract, save_path)


@mcp.tool()
async def insert_electrical_symbol(symbol: str, x: float, y: float, attributes: dict[str, str] | None = None) -> dict:
    """Insert one AutoCAD Electrical library symbol (e.g. "VCB1" breaker, "VMS1" contactor, "VOL1" overload,
    "VMO1M3" 3-phase motor) into the ACTIVE drawing at (x, y), optionally setting attributes like TAG1, DESC1, RATING1."""
    return await _run(op_insert, symbol, x, y, attributes)


@mcp.tool()
async def list_electrical_symbols(query: str, limit: int = 50) -> dict:
    """Search symbol names in the AutoCAD Electrical IEC library (e.g. query "VCB", "VMO", "VOL")."""
    return await _run(op_list, query, limit)


@mcp.tool()
async def save_active_drawing(path: str | None = None) -> dict:
    """Save the active drawing (optionally Save As a .dwg path)."""
    return await _run(op_save, path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--http", action="store_true", help="serve streamable HTTP instead of stdio")
    parser.add_argument("--port", type=int, default=int(os.environ.get("AUTOCAD_MCP_PORT", "8765")))
    args = parser.parse_args()
    if args.http:
        mcp.run("streamable-http", host="127.0.0.1", port=args.port, stateless_http=True, json_response=True)
    else:
        mcp.run("stdio")
