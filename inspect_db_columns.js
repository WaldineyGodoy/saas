import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://abbysvxnnhwvvzhftoms.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiYnlzdnhubmh3dnZ6aGZ0b21zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2NTcwNzcsImV4cCI6MjA4NDIzMzA3N30.omP9h4ZqFbDX4FMO_lkd5Q3Iv99xgbs5bVz6beIpqfo';

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspect() {
    console.log('Fetching columns...');
    // We can't easily query information_schema via JS client directly without stored procedure/RPC.
    // BUT we can try an RPC if one exists, or just query the table and see if specific columns work?
    // Actually, asking the USER might be faster if I can't query.

    // Attempt to insert a dummy row with known columns to see which one fails? No, risky. 
    // Wait, the user said "colunas jan.kwh ~ dez.kwh". 
    // Maybe the names are strictly "jan.kwh" (with dot)? That would be weird for SQL. 
    // Likely jan_kwh or "jan.kwh" quoted. 

    // Let's try to verify if the index creation failed because the column name is different.
    // I entered `municipio_ibge`. Maybe it is `codigo_ibge`?

    // I'll try to select specific columns and catch error.
    const { error: err1 } = await supabase.from('irradiancia').select('municipio_ibge').limit(1);
    console.log('municipio_ibge exists?', !err1, err1?.message);

    const { error: err2 } = await supabase.from('irradiancia').select('codigo_ibge').limit(1);
    console.log('codigo_ibge exists?', !err2, err2?.message);

    const { error: err3 } = await supabase.from('irradiancia').select('ibge').limit(1);
    console.log('ibge exists?', !err3, err3?.message);

    const { error: err4 } = await supabase.from('irradiancia').select('id_municipio').limit(1);
    console.log('id_municipio exists?', !err4, err4?.message);

    const { error: err5 } = await supabase.from('irradiancia').select('jan.kwh').limit(1); // Try with dot as user said
    console.log('jan.kwh exists?', !err5, err5?.message);

    const { error: err6 } = await supabase.from('irradiancia').select('jan_kwh').limit(1);
    console.log('jan_kwh exists?', !err6, err6?.message);
}

inspect();
