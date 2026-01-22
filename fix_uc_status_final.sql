-- SCRIPT DE CORREÇÃO DO STATUS DA UC
-- Copie e execute TUDO no Editor SQL do Supabase.

-- 1. Adicionar novos valores ao Enum (se não existirem)
-- Nota: O Postgres não permite adicionar vários em uma linha só, então fazemos um por um.

ALTER TYPE uc_status ADD VALUE IF NOT EXISTS 'em_ativacao';
ALTER TYPE uc_status ADD VALUE IF NOT EXISTS 'aguardando_conexao';
ALTER TYPE uc_status ADD VALUE IF NOT EXISTS 'sem_geracao';
ALTER TYPE uc_status ADD VALUE IF NOT EXISTS 'em_atraso';
ALTER TYPE uc_status ADD VALUE IF NOT EXISTS 'cancelado_inadimplente';

-- 2. Garantir que os valores antigos/básicos existem (só por segurança)
ALTER TYPE uc_status ADD VALUE IF NOT EXISTS 'ativo';
ALTER TYPE uc_status ADD VALUE IF NOT EXISTS 'cancelado';

-- 3. Confirmação (Removido para evitar erro de transação)
-- Apenas execute as linhas acima.

