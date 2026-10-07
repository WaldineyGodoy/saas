require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY);

sb.rpc('execute_sql', { query: "SELECT column_name FROM information_schema.columns WHERE table_name = 'leads'" })
  .then(r => console.log(r.data))
  .catch(console.error);
