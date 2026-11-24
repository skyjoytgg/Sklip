@echo off
rem Prépare le moteur pour le développement, avec Python 3.13 (géré par uv, sans toucher à ton Python 3.15).
cd /d %~dp0
uv venv --python 3.13 .venv || exit /b 1
uv pip install --python .venv\Scripts\python.exe -r requirements.txt || exit /b 1
.venv\Scripts\python.exe -m pytest -q
