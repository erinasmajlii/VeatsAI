# AutoCAD Electrical MCP server

An MCP server that lets VeatsAI, and Claude Code, draw in a **running AutoCAD Electrical** on Windows.

```
VeatsAI web app ──MCP (HTTP)──┐
                              ├──► server.py ──COM──► AutoCAD Electrical (c:wd_insym2, IEC symbols)
Claude Code ────MCP (stdio)───┘
```

## Requirements
- Windows with **AutoCAD Electrical** running. Tested with 2027, started as "AutoCAD Electrical", i.e. `/product ACADE`.
- Python 3.11+.
- The IEC symbol library at `C:\Users\Public\Documents\Autodesk\Acade 2027\Libs\iec2`. Override it with `ACADE_SYMBOL_LIB` or `ACADE_YEAR`.

## Setup and start (for the web app)
```powershell
powershell -ExecutionPolicy Bypass -File integrations/autocad-mcp/start.ps1
```
The first run creates `.venv` and installs `requirements.txt`. The server listens on `http://127.0.0.1:8765/mcp`, on localhost only.
In VeatsAI, open a project → **CAD preview** → **Send to AutoCAD Electrical**.

## Claude Code
`.mcp.json` in the repo root registers this server (stdio) as `autocad-electrical`. Once `.venv` exists, Claude Code can call it directly. For example: *"Draw the 3 × 15 kW panel in AutoCAD"*, or *"Insert a VCB1 breaker at 0,0"*.

## Tools
| Tool | What it does |
|---|---|
| `autocad_status` | AutoCAD / Electrical toolset running? Lists open drawings |
| `draw_motor_panel_schematic(contract, save_path?)` | Creates a new DWG from a VeatsAI CAD contract (see `src/lib/types.ts` `CadContract`). It uses intelligent IEC symbols: `VCB1` breaker, `VMS1` contactor, `VOL1` overload, `VMO1M3` 3-phase motor. It fills TAG1/DESC1/RATING1/MFG/CAT and draws wires on the `WIRES` layer |
| `insert_electrical_symbol(symbol, x, y, attributes?)` | Inserts one library symbol into the active drawing |
| `list_electrical_symbols(query)` | Searches the symbol library |
| `save_active_drawing(path?)` | Saves or Save As a DWG |

DWGs are saved to `%USERPROFILE%\Documents\VeatsAI\drawings` (override with `VEATS_CAD_OUTPUT`).

## Notes
- New drawings get the `WD_M` block inserted first. Without it, AutoCAD Electrical shows the "Special block WD_M…" dialog, which blocks automation.
- If AutoCAD has a dialog open or a command running, the tools wait up to 20 s and then report "AutoCAD is busy".
- The output is a **preliminary** schematic for engineer review. Run AutoCAD Electrical's own Retag / project tools for production drawings.
