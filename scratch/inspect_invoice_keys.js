import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://abbysvxnnhwvvzhftoms.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiYnlzdnhubmh3dnZ6aGZ0b21zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2NTcwNzcsImV4cCI6MjA4NDIzMzA3N30.omP9h4ZqFbDX4FMO_lkd5Q3Iv99xgbs5bVz6beIpqfo';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const { data, error } = await supabase.from('invoices').select('*').limit(10);
    if (error) {
        console.error('Error fetching invoices:', error);
    } else {
        console.log('Invoices count:', data?.length);
        if (data && data.length > 0) {
            console.log('Invoice columns keys:', Object.keys(data[0]));
            console.log('Invoice raw sample:', data[0]);
        }
    }
}
run();
