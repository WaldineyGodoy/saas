@echo off
echo ==========================================
echo Preparando deploy para o Repositorio SaaS
echo ==========================================

echo 1. Adicionando arquivos alterados...
git add .

echo 2. Registrando alteracoes (Commit)...
git commit -m "feat: Atualizacao SubscriberSignup, Cores da Marca e Redirecionamento"

echo 3. Enviando para o GitHub (Push)...
git push

echo ==========================================
echo Deploy finalizado com sucesso!
echo ==========================================
pause
