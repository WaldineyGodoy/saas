import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2.45.0"

serve(async (req) => {
    try {
        const authHeader = req.headers.get('Authorization');
        // Ensure it is called securely (either by cron or internal admin)
        if (authHeader !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        }

        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        // Fetch Accounts
        const accountsResult = await supabase.from('ledger_accounts').select('id, code');
        const accounts = {};
        accountsResult.data?.forEach(acc => {
            accounts[acc.code] = acc.id;
        });

        // Fetch all active Usinas
        const { data: usinas, error: usinasError } = await supabase
            .from('usinas')
            .select('id, name, supplier_id, servicos_contratados, service_values')
            .eq('status', 'operacao');

        if (usinasError) throw usinasError;

        let totalCharged = 0;
        let usinasProcessed = 0;

        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
        const transactionId = crypto.randomUUID();

        for (const usina of usinas || []) {
            if (!usina.supplier_id) continue;
            if (!usina.servicos_contratados || !usina.service_values) continue;

            const services = usina.service_values;
            
            const manutencao = Number(services['Manutenção']) || 0;
            const arrendamento = Number(services['Arrendamento']) || 0;
            const agua = Number(services['Água']) || 0;
            const energia = Number(services['Energia']) || 0;
            const internet = Number(services['Internet']) || 0;
            const seguranca = Number(services['Segurança']) || 0;

            const despesas_op_total = agua + energia + internet + seguranca;
            const total = manutencao + arrendamento + despesas_op_total;

            if (total <= 0) continue;

            // Prevent duplicate charging for this month
            // We check if a debit for this usina already exists this month
            const { data: existing } = await supabase
                .from('ledger_entries')
                .select('id')
                .eq('reference_id', usina.supplier_id)
                .eq('reference_type', 'supplier_expenses')
                .like('description', `%${currentMonth}%`)
                .limit(1);

            if (existing && existing.length > 0) continue; // Already charged

            const entries = [];

            // Debit Supplier (2.1.1)
            entries.push({
                transaction_id: transactionId,
                account_id: accounts['2.1.1'],
                amount: total, // Debit is positive in our generic ledger math for passive, wait... supplier is 2.1.1 (Passivo) -> Debit is positive? 
                // Wait. In SupplierModal: Credit (negative) increases Saldo a Receber. Debit (positive) decreases Saldo a Receber.
                // So debiting expenses means inserting a POSITIVE amount into 2.1.1!
                description: `Despesas Operacionais - ${currentMonth} (${usina.name})`,
                reference_type: 'supplier_expenses',
                reference_id: usina.supplier_id,
                is_sandbox: false
            });

            // Credit B2W Revenue Accounts
            // In our system, Credit to Receitas (Resultados) is negative.
            if (manutencao > 0) {
                entries.push({
                    transaction_id: transactionId,
                    account_id: accounts['3.1.3'], // Manutenção
                    amount: -manutencao,
                    description: `Receita Manutenção - ${usina.name}`,
                    reference_type: 'usina',
                    reference_id: usina.id,
                    is_sandbox: false
                });
            }

            if (arrendamento > 0) {
                entries.push({
                    transaction_id: transactionId,
                    account_id: accounts['3.1.4'], // Arrendamento
                    amount: -arrendamento,
                    description: `Receita Arrendamento - ${usina.name}`,
                    reference_type: 'usina',
                    reference_id: usina.id,
                    is_sandbox: false
                });
            }

            if (despesas_op_total > 0) {
                entries.push({
                    transaction_id: transactionId,
                    account_id: accounts['2.1.4'], // Provisão Despesas OP
                    amount: -despesas_op_total,
                    description: `Provisão Despesas Operacionais - ${usina.name}`,
                    reference_type: 'usina',
                    reference_id: usina.id,
                    is_sandbox: false
                });
            }

            const { error: insertError } = await supabase.from('ledger_entries').insert(entries);
            if (insertError) {
                console.error(`Error charging Usina ${usina.name}:`, insertError);
            } else {
                totalCharged += total;
                usinasProcessed++;
            }
        }

        return new Response(JSON.stringify({ success: true, totalCharged, usinasProcessed }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (err) {
        console.error('Cron Error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
});
