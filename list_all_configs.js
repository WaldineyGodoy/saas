
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://abbysvxnnhwvvzhftoms.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiYnlzdnhubmh3dnZ6aGZ0b21zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2NTcwNzcsImV4cCI6MjA4NDIzMzA3N30.omP9h4ZqFbDX4FMO_lkd5Q3Iv99xgbs5bVz6beIpqfo'

const supabase = createClient(supabaseUrl, supabaseKey)

async function listConfigs() {
    const { data, error } = await supabase
        .from('integrations_config')
        .select('*')

    if (error) {
        console.error('Error fetching configs:', error)
    } else {
        console.log('All Configs:', JSON.stringify(data, null, 2))
    }
}

listConfigs()
