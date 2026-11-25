@echo off
rem Construit le moteur en exécutable Windows : engine\dist\sklip-engine\sklip-engine.exe
rem Sur le PC de dev : utilise engine\.venv (Python 3.13, créé par setup-dev.bat), jamais le Python du système.
rem Sur GitHub Actions : pas de .venv, le Python 3.13 installé par le workflow.
cd /d %~dp0
if exist .venv\Scripts\python.exe (
  where uv >nul 2>nul && (uv pip install --python .venv\Scripts\python.exe -r requirements.txt pyinstaller || exit /b 1)
  where uv >nul 2>nul || (.venv\Scripts\python.exe -m pip install -r requirements.txt pyinstaller || exit /b 1)
  set PY=.venv\Scripts\python.exe
) else (
  python -m pip install -r requirements.txt pyinstaller || exit /b 1
  set PY=python
)
%PY% -m PyInstaller --noconfirm --onedir --console --name sklip-engine ^
  --add-data "sklip_engine\fonts;sklip_engine\fonts" ^
  --add-data "sklip_engine\assets;sklip_engine\assets" ^
  --collect-all faster_whisper --collect-all ctranslate2 ^
  run_engine.py || exit /b 1
echo Moteur construit dans engine\dist\sklip-engine
