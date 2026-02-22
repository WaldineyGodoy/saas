
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://abbysvxnnhwvvzhftoms.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiYnlzdnhubmh3dnZ6aGZ0b21zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2NTcwNzcsImV4cCI6MjA4NDIzMzA3N30.omP9h4ZqFbDX4FMO_lkd5Q3Iv99xgbs5bVz6beIpqfo'

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkConfig() {
    const { data, error } = await supabase
        .from('integrations_config')
        .select('*')
        .eq('service_name', 'financial_api')
        .single()

    if (error) {
        console.error('Error fetching config:', error)
    } else {
        console.log('Asaas Config:', JSON.stringify(data, null, 2))
    }
}

checkConfig()
