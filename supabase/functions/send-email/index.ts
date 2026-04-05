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

        const body = await req.json().catch(() => ({}));
        const { to, subject, html, attachments, variables } = body;

        const { data: config, error: configError } = await supabaseAdmin
            .from('integrations_config')
            .select('*')
            .eq('service_name', 'resend_api')
            .single();

        if (configError || !config || !config.api_key) {
            throw new Error('Configuração do Resend não encontrada.');
        }

        // Helper robusto para ler variáveis tanto de Array [{key, value}] quanto de Object {key: value}
        const getV = (key: string, fallback: string) => {
            const vars = config.variables;
            if (!vars) return fallback;
            
            // Caso 1: É um Objeto Direto (formato atual no DB)
            if (typeof vars === 'object' && !Array.isArray(vars)) {
                return vars[key] || fallback;
            }
            
            // Caso 2: É um Array de objetos (formato vindo do UI state)
            if (Array.isArray(vars)) {
                const found = vars.find((v: any) => v.key === key);
                return found ? found.value : fallback;
            }
            
            return fallback;
        };

        const { data: asaasConfig } = await supabaseAdmin
            .from('integrations_config')
            .select('environment')
            .eq('service_name', 'financial_api')
            .single();

        const isSandbox = asaasConfig?.environment === 'sandbox';
        
        let finalRecipient = to;
        if (isSandbox) {
            finalRecipient = getV('test_email', 'waldineygodoy@gmail.com');
        }

        if (!finalRecipient) {
            throw new Error('Destinatário não definido.');
        }

        const resend = new Resend(config.api_key);

        // Template de Alta Fidelidade
        let finalHtml = html;
        if (!finalHtml && variables) {
            const { nome, valor, vencimento, mensagem } = variables;
            finalHtml = `
            <!DOCTYPE html>
            <html>
            <body style="font-family: sans-serif; background: #f8fafc; padding: 20px;">
                <div style="background: #fff; max-width: 600px; margin: 0 auto; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden;">
                    <div style="background: #003366; color: #fff; padding: 30px; text-align: center;"><h1>Sua fatura chegou!</h1></div>
                    <div style="padding: 30px;">
                        ${mensagem ? `<div style="background: #fff7ed; padding: 15px; border-radius: 8px; border: 1px dashed #fdba74; margin-bottom: 20px;">${mensagem}</div>` : ''}
                        <p>Olá, <strong>${nome || 'Assinante'}</strong>.</p>
                        <div style="background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0;">
                            <strong>Vencimento:</strong> ${vencimento || '--/--/----'}<br>
                            <strong>Valor:</strong> ${valor || 'R$ 0,00'}
                        </div>
                        <div style="text-align:center; padding: 30px;"><a href="https://app.b2wenergia.com.br" style="background: #FF6600; color: #fff; padding: 12px 30px; border-radius: 25px; text-decoration: none; font-weight: bold;">Acessar minha conta</a></div>
                    </div>
                </div>
            </body>
            </html>`;
        }

        // Corrigido para garantir que use o domínio b2wenergia.com.br que está verificado
        const fromEmail = getV('from_email', 'faturas@b2wenergia.com.br');
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
            status: 200
        });
    }
})
