# Starts the VeatsAI AutoCAD Electrical MCP server for the web app (streamable HTTP on 127.0.0.1:8765).
# Run from the repo root:  powershell -ExecutionPolicy Bypass -File integrations/autocad-mcp/start.ps1
# AutoCAD Electrical must already be running on this machine.
$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$py = Join-Path $dir ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    Write-Host "Creating Python environment..."
    python -m venv (Join-Path $dir ".venv")
    & $py -m pip install --quiet --upgrade pip
    & $py -m pip install --quiet -r (Join-Path $dir "requirements.txt")
}
# Uploaded plans (.data\uploads) may be read by the server for DWG -> DXF conversion.
if (-not $env:VEATS_UPLOAD_DIR) { $env:VEATS_UPLOAD_DIR = Join-Path (Get-Location) ".data\uploads" }
$port = if ($env:AUTOCAD_MCP_PORT) { $env:AUTOCAD_MCP_PORT } else { "8765" }
Write-Host "AutoCAD Electrical MCP server -> http://127.0.0.1:$port/mcp  (Ctrl+C to stop)"
& $py (Join-Path $dir "server.py") --http --port $port
