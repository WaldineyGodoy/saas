-- Adiciona os novos valores ao ENUM uc_status
-- Execute este script no Editor SQL do Supabase

ALTER TYPE uc_status ADD VALUE IF NOT EXISTS 'em_ativacao';
ALTER TYPE uc_status ADD VALUE IF NOT EXISTS 'aguardando_conexao';
ALTER TYPE uc_status ADD VALUE IF NOT EXISTS 'sem_geracao';
ALTER TYPE uc_status ADD VALUE IF NOT EXISTS 'em_atraso';
ALTER TYPE uc_status ADD VALUE IF NOT EXISTS 'cancelado_inadimplente';
