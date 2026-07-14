import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carregar variáveis de ambiente (simples)
const envStr = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
const envLines = envStr.split('\n');
let SUPABASE_URL = '';
let SUPABASE_KEY = '';
envLines.forEach(line => {
    if (line.startsWith('VITE_SUPABASE_URL=')) SUPABASE_URL = line.split('=')[1].trim();
    if (line.startsWith('VITE_SUPABASE_ANON_KEY=')) SUPABASE_KEY = line.split('=')[1].trim();
});

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
    try {
        console.log('Lendo tabela_cip.csv...');
        const csvPath = path.join(__dirname, 'tabela_cip.csv');
        // Lê em latin1 para não quebrar acentos caso tenha sido salvo no Windows Excel
        const data = fs.readFileSync(csvPath, 'latin1');
        
        const lines = data.split('\n');
        const rowsToInsert = [];
        
        console.log(`Encontradas ${lines.length} linhas.`);

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const cols = line.split(';');
            if (cols.length < 6) continue;

            const parseNumber = (val) => {
                if (!val) return 0;
                val = val.replace(',', '.');
                const num = parseFloat(val);
                return isNaN(num) ? 0 : num;
            };

            rowsToInsert.push({
                municipio: cols[0].trim(),
                classe: cols[1].trim(),
                faixa_de: parseNumber(cols[2]),
                faixa_ate: parseNumber(cols[3]),
                percentual: parseNumber(cols[4]),
                valor_fixo: parseNumber(cols[5])
            });
        }

        console.log(`Preparando para inserir ${rowsToInsert.length} registros...`);

        // Limpar tabela antes de inserir
        const { error: delError } = await supabase.from('cosip_rates').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        if (delError) console.error('Aviso ao deletar:', delError.message);

        // Inserir em lotes de 1000
        const batchSize = 1000;
        for (let i = 0; i < rowsToInsert.length; i += batchSize) {
            const batch = rowsToInsert.slice(i, i + batchSize);
            const { error } = await supabase.from('cosip_rates').insert(batch);
            if (error) {
                console.error(`Erro no lote ${i}:`, error);
                throw error;
            }
            console.log(`Inserido lote de ${i} até ${i + batchSize}`);
        }

        console.log('Tudo importado com sucesso!');

    } catch (e) {
        console.error('Erro na importação:', e);
    }
}

run();
