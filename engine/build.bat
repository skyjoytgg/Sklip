@echo off
rem Construit le moteur en exécutable Windows : engine\dist\sklip-engine\sklip-engine.exe
cd /d %~dp0
python -m pip install -r requirements.txt pyinstaller || exit /b 1
python -m PyInstaller --noconfirm --onedir --console --name sklip-engine ^
  --add-data "sklip_engine\fonts;sklip_engine\fonts" ^
  --add-data "sklip_engine\assets;sklip_engine\assets" ^
  --collect-all faster_whisper --collect-all ctranslate2 ^
  run_engine.py || exit /b 1
echo Moteur construit dans engine\dist\sklip-engine
