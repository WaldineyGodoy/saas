import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Carrega as variáveis de ambiente do .env na raiz do projeto
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
// IMPORTANTE: Para inserir dados burlando o RLS (se houver), seria ideal a SERVICE_ROLE_KEY.
// Como estamos testando localmente e se sua tabela permitir anon inserts temporariamente, a ANON_KEY funciona.
// Mas o ideal é criar a variável VITE_SUPABASE_SERVICE_ROLE_KEY no seu .env
const SUPABASE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("ERRO: VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY precisam estar configurados no .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function runIngestion() {
  console.log("Iniciando Ingestão de Dados (Node.js)...");

  // Dados Sintéticos/Mock para validar imediatamente o Mapa
  const mockData = [
    { codigo_aneel: "SE-001", nome: "SE Bom Jesus", distribuidora: "ENEL-CE", tensao_kv: 69, capacidade_mva: 30, latitude: -3.7319, longitude: -38.5267 },
    { codigo_aneel: "SE-002", nome: "SE Maracanaú", distribuidora: "ENEL-CE", tensao_kv: 69, capacidade_mva: 50, latitude: -3.8767, longitude: -38.6253 },
    { codigo_aneel: "SE-003", nome: "SE Caucaia", distribuidora: "ENEL-CE", tensao_kv: 138, capacidade_mva: 100, latitude: -3.7333, longitude: -38.6500 },
    { codigo_aneel: "SE-004", nome: "SE Eusébio", distribuidora: "ENEL-CE", tensao_kv: 69, capacidade_mva: 45, latitude: -3.8906, longitude: -38.4503 },
  ];

  const recordsToInsert = mockData.map(row => ({
    codigo_aneel: row.codigo_aneel,
    nome: row.nome,
    distribuidora: row.distribuidora,
    tensao_kv: row.tensao_kv,
    capacidade_mva: row.capacidade_mva,
    latitude: row.latitude,
    longitude: row.longitude,
    // Criação do ponto WKT para o PostGIS do Supabase
    localizacao: `SRID=4326;POINT(${row.longitude} ${row.latitude})`
  }));

  console.log(`Inserindo ${recordsToInsert.length} subestações no Supabase...`);

  const { data, error } = await supabase
    .from('distribuicao_subestacoes')
    .insert(recordsToInsert);

  if (error) {
    console.error("Erro ao inserir no Supabase:");
    console.error(error);
  } else {
    console.log("Inserção concluída com sucesso! Atualize o seu Mapa para ver as subestações.");
  }
}

runIngestion();
