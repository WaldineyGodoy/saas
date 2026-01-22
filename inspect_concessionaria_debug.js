
import { supabase } from './src/lib/supabase.js';

async function inspect() {
    console.log('Inspecting Concessionaria table...');

    // Try to fetch one row to see structure
    const { data, error } = await supabase
        .from('Concessionaria')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error fetching Concessionaria:', error);

        // Try lowercase table name just in case
        const { data: data2, error: error2 } = await supabase
            .from('concessionaria')
            .select('*')
            .limit(1);

        if (error2) {
            console.error('Error fetching concessionaria (lowercase):', error2);
        } else {
            console.log('Success with lowercase table name:', data2);
        }
    } else {
        console.log('Success with Concessionaria table name:', data);
    }
}

inspect();
