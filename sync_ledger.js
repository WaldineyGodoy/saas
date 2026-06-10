import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load env from project root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("Fetching all invoices...");
  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('id, status, asaas_payment_id, valor_a_pagar, uc_id')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error("Error fetching invoices:", error);
    return;
  }

  console.log("Recent Invoices:");
  invoices.forEach(inv => {
    console.log(`ID: ${inv.id} | Status: ${inv.status} | Valor: ${inv.valor_a_pagar}`);
  });

  const specific = invoices.find(i => i.id === '7f7330ac-4dde-4d1e-a22b-06acfde0d34');
  if (specific) {
    console.log("\nFound specific invoice:", specific);
    
    // Check ledger
    const { data: ledger, error: lErr } = await supabase
      .from('ledger_entries')
      .select('*')
      .eq('reference_id', specific.id);
    console.log("Ledger entries for specific:", ledger);
  }
}

main();
