@echo off
rem The claudeforge command as cmd.exe and PowerShell run it: ClaudeForge's own executable runs
rem claudeforge.mjs as Node. Only a Hosted session's environment names that executable (ADR 0007).
setlocal
if not defined CLAUDEFORGE_CLI_RUNTIME (
  echo claudeforge: Only a Session running in ClaudeForge can change its interface. 1>&2
  exit /b 1
)
set ELECTRON_RUN_AS_NODE=1
"%CLAUDEFORGE_CLI_RUNTIME%" "%~dp0claudeforge.mjs" %*
exit /b %ERRORLEVEL%
