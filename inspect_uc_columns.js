
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function inspect() {
    const { data, error } = await supabase.from('consumer_units').select('*').limit(1);
    if (error) console.error(error);
    else {
        if (data.length > 0) {
            console.log('Columns:', Object.keys(data[0]));
        } else {
            // If empty, try to insert dummy to get error about missing cols? No, strictly selecting * is enough if I had rows.
            // If no rows, I can't easily see columns with JS client without metadata table access.
            console.log('No rows found. Attempting to select specific new columns to see if they error.');
            const { error: err2 } = await supabase.from('consumer_units').select('te, tusd, fio_b').limit(1);
            if (err2) console.log('Error selecting new cols:', err2.message);
            else console.log('Columns te, tusd, fio_b probably exist');
        }
    }
}
inspect();
