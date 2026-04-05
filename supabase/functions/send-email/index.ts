import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'
import { Resend } from 'https://esm.sh/resend@3.2.0'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        // Parse body gracefully
        const body = await req.json().catch(() => ({}));
        const { to, subject, html, attachments, variables } = body;

        // 1. Buscar Configuração do Resend
        const { data: config, error: configError } = await supabaseAdmin
            .from('integrations_config')
            .select('*')
            .eq('service_name', 'resend_api')
            .single();

        if (configError || !config || !config.api_key) {
            throw new Error('Configuração do Resend não encontrada no banco de dados.');
        }

        // Helper para extrair variáveis do array [{key, value}]
        const getV = (key: string, fallback: string) => {
            if (!Array.isArray(config.variables)) return fallback;
            const found = config.variables.find((v: any) => v.key === key);
            return found ? found.value : fallback;
        };

        // 2. Verificar Ambiente (Sandbox vs Produção)
        const { data: asaasConfig } = await supabaseAdmin
            .from('integrations_config')
            .select('environment')
            .eq('service_name', 'financial_api')
            .single();

        const isSandbox = asaasConfig?.environment === 'sandbox';
        
        // Destinatário final
        let finalRecipient = to;
        if (isSandbox) {
            finalRecipient = getV('test_email', 'waldineygodoy@gmail.com');
        }

        if (!finalRecipient) {
            throw new Error('Destinatário não definido (e-mail destino ou test_email ausente).');
        }

        const resend = new Resend(config.api_key);

        // 3. Preparar E-mail
        let finalHtml = html;
        if (!finalHtml && variables) {
            const { nome, valor, vencimento, mensagem } = variables;
            finalHtml = `
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: sans-serif; color: #1e293b; background-color: #f8fafc; margin: 0; padding: 20px; }
                    .main { background: #fff; max-width: 600px; margin: 0 auto; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; }
                    .header { text-align: center; padding: 20px; border-bottom: 1px solid #f1f5f9; }
                    .hero { background: #003366; color: #fff; padding: 30px; text-align: center; }
                    .content { padding: 30px; }
                    .card { background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
                    .btn { display: inline-block; background: #FF6600; color: #fff; padding: 12px 30px; border-radius: 25px; text-decoration: none; font-weight: bold; }
                    .test-msg { background: #fff7ed; border: 1px dashed #fdba74; padding: 15px; border-radius: 8px; margin-bottom: 20px; font-style: italic; }
                </style>
            </head>
            <body>
                <div class="main">
                    <div class="header"><img src="https://b2wenergia.com.br/wp-content/uploads/2025/12/Logo-Laranja-estreito.png" height="40"></div>
                    <div class="hero"><h1>Sua fatura chegou!</h1><p>Olá, ${nome || 'Assinante'}</p></div>
                    <div class="content">
                        ${mensagem ? `<div class="test-msg"><strong>Teste:</strong> ${mensagem}</div>` : ''}
                        <div class="card">
                            <strong>Vencimento:</strong> ${vencimento || '--/--/----'}<br>
                            <strong>Valor:</strong> ${valor || 'R$ 0,00'}
                        </div>
                        <div style="text-align:center"><a href="https://app.b2wenergia.com.br" class="btn">Acessar Fatura</a></div>
                    </div>
                </div>
            </body>
            </html>`;
        }

        const fromEmail = getV('from_email', 'faturas@comunicacao.b2wenergia.com.br');
        const fromName = getV('from_name', 'B2W Energia');
        const fromHeader = `${fromName} <${fromEmail}>`;

        const emailResponse = await resend.emails.send({
            from: fromHeader,
            to: Array.isArray(finalRecipient) ? finalRecipient : [finalRecipient],
            subject: `${isSandbox ? '[SANDBOX] ' : ''}${subject || 'Sua fatura B2W Energia chegou!'}`,
            html: finalHtml || `<p>Sua fatura está disponível.</p>`,
            attachments: attachments || []
        });

        if (emailResponse.error) throw new Error(emailResponse.error.message);

        return new Response(JSON.stringify({ success: true, data: emailResponse.data }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        });

    } catch (error) {
        console.error('Edge Function Error:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200 // Always 200 for CORS stability
        });
    }
})
