@echo off
echo Running install...
call corepack pnpm install
if %errorlevel% neq 0 exit /b %errorlevel%

echo Running prisma generate...
call corepack pnpm prisma generate
if %errorlevel% neq 0 exit /b %errorlevel%

echo Running prisma validate...
call corepack pnpm prisma validate
if %errorlevel% neq 0 exit /b %errorlevel%

echo Running typecheck...
call corepack pnpm typecheck
if %errorlevel% neq 0 exit /b %errorlevel%

echo Running test:isolation...
call corepack pnpm test:isolation
if %errorlevel% neq 0 exit /b %errorlevel%

echo Running targeted tests...
call corepack pnpm --filter @uaiw/api test -- testIsolation providerRecoveryPolicies
if %errorlevel% neq 0 exit /b %errorlevel%

echo Running full tests...
call corepack pnpm test
if %errorlevel% neq 0 exit /b %errorlevel%

echo Running security scan...
call corepack pnpm security:scan
if %errorlevel% neq 0 exit /b %errorlevel%

echo Running release check...
call corepack pnpm release:check
if %errorlevel% neq 0 exit /b %errorlevel%

echo Running docker config check...
call corepack pnpm ci:docker:config
if %errorlevel% neq 0 exit /b %errorlevel%

echo Running node check...
node tools/ci/check.mjs
if %errorlevel% neq 0 exit /b %errorlevel%

echo ALL CHECKS PASSED
exit /b 0
