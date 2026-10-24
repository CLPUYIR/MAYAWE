@echo off
echo ================================================================
echo             MAYAwe V2 - Running Test Suite                      
echo ================================================================
echo.
echo [1/3] Nexus Unit and Endpoint Tests...
node "%~dp0test_nexus.js"
if %errorlevel% neq 0 (
    echo [ERROR] Nexus tests failed!
    exit /b %errorlevel%
)
echo.
echo [2/3] Aether Spatial Smoke Tests...
python "%~dp0test_aether_smoke.py"
if %errorlevel% neq 0 (
    echo [ERROR] Aether smoke tests failed!
    exit /b %errorlevel%
)
echo.
echo [3/3] Directive Flow Integration Tests...
node "%~dp0test_directive_flow.js"
if %errorlevel% neq 0 (
    echo [ERROR] Directive flow tests failed!
    exit /b %errorlevel%
)
echo.
echo ================================================================
echo             All MAYAwe V2 Tests PASSED! [Exit 0]                
echo ================================================================
exit /b 0
