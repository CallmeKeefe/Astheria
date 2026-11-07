@"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu --disable-dev-shm-usage --no-sandbox --dump-dom --virtual-time-budget=15000 --run-all-compositor-stages-before-draw "http://localhost:5174/" > ".taste-skill/dom.txt" 2>".taste-skill/dom-err.txt"
@echo EXITCODE %ERRORLEVEL%
