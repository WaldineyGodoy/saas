@echo off
echo ==========================================
echo Corrigindo conflito de versoes (Lockfile)...
echo ==========================================

echo 1. Removendo arquivo de trava antigo...
if exist package-lock.json del package-lock.json

echo 2. Instalando dependencias do zero (isso cria um novo lockfile correto)...
call npm install

echo 3. Enviando correcao para o GitHub...
git add .
git commit -m "fix: atualizando package-lock.json para tailwind v3"
git push

echo ==========================================
echo Correcao enviada! 
echo O deploy deve funcionar agora.
echo ==========================================
pause
