import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://abbysvxnnhwvvzhftoms.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiYnlzdnhubmh3dnZ6aGZ0b21zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2NTcwNzcsImV4cCI6MjA4NDIzMzA3N30.omP9h4ZqFbDX4FMO_lkd5Q3Iv99xgbs5bVz6beIpqfo';

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspect() {
    console.log('Fetching irradiancia table structure...');
    const { data, error } = await supabase.from('irradiancia').select('*').limit(1);

    if (error) {
        console.error('Error fetching irradiancia:', error);
    } else {
        console.log('Success! Row sample:');
        console.log(data);
    }
}

inspect();
