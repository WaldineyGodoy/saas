import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://abbysvxnnhwvvzhftoms.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiYnlzdnhubmh3dnZ6aGZ0b21zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2NTcwNzcsImV4cCI6MjA4NDIzMzA3N30.omP9h4ZqFbDX4FMO_lkd5Q3Iv99xgbs5bVz6beIpqfo';

const supabase = createClient(supabaseUrl, supabaseKey);

async function reparse() {
    // Busca todas as faturas que têm PDF da concessionária e cuja referência é 2026-04-01 ou 2026-05-01
    const { data: invoices, error } = await supabase
        .from('invoices')
        .select('id, mes_referencia, concessionaria_pdf_url, vencimento, vencimento_concessionaria')
        .in('mes_referencia', ['2026-04-01', '2026-05-01'])
        .not('concessionaria_pdf_url', 'is', null);

    if (error) {
        console.error('Error fetching invoices:', error);
        return;
    }

    console.log(`Encontradas ${invoices.length} faturas para analisar.`);

    for (const inv of invoices) {
        console.log(`\nProcessando fatura ID ${inv.id} (Ref: ${inv.mes_referencia})...`);
        try {
            // Download PDF
            const response = await fetch(inv.concessionaria_pdf_url);
            if (!response.ok) {
                console.error(`Falha ao baixar PDF para fatura ${inv.id}: ${response.statusText}`);
                continue;
            }
            const arrayBuffer = await response.arrayBuffer();
            const base64 = Buffer.from(arrayBuffer).toString('base64');

            // Chamar a Edge Function localmente/remotamente parse-invoice
            // Chamando via RPC / supabase functions invoke
            const { data: parsed, error: parseErr } = await supabase.functions.invoke('parse-invoice', {
                body: { pdfBase64: base64 }
            });

            if (parseErr || !parsed || parsed.error) {
                console.error(`Erro ao analisar PDF da fatura ${inv.id}:`, parseErr || parsed?.error);
                continue;
            }

            console.log(`Dados extraídos: mes_referencia=${parsed.mes_referencia}, vencimento=${parsed.vencimento}`);

            if (parsed.vencimento) {
                const vencConcessionaria = parsed.vencimento.split('T')[0];
                console.log(`Atualizando vencimento_concessionaria para: ${vencConcessionaria}`);
                
                const { error: updateErr } = await supabase
                    .from('invoices')
                    .update({ vencimento_concessionaria: vencConcessionaria })
                    .eq('id', inv.id);

                if (updateErr) {
                    console.error(`Erro ao salvar no banco para fatura ${inv.id}:`, updateErr);
                } else {
                    console.log(`Fatura ${inv.id} atualizada com sucesso!`);
                }
            } else {
                console.warn(`Vencimento não extraído para a fatura ${inv.id}`);
            }

        } catch (err) {
            console.error(`Erro inesperado para a fatura ${inv.id}:`, err);
        }
    }
    console.log('\nProcessamento concluído!');
}

reparse();
