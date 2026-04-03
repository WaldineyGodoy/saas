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

        const { to, subject, html, attachments, variables } = await req.json()

        if (!to) {
            throw new Error('Destinatário (to) é obrigatório.')
        }

        // 1. Buscar Configuração do Resend
        const { data: config, error: configError } = await supabaseAdmin
            .from('integrations_config')
            .select('*')
            .eq('service_name', 'resend_api')
            .single();

        if (configError || !config || !config.api_key) {
            throw new Error('Configuração do Resend não encontrada ou API Key ausente.');
        }

        const resend = new Resend(config.api_key);

        // 2. Preparar E-mail
        // Se html não for passado, geramos um template padrão baseado no B2W (se variables existirem)
        let finalHtml = html;
        if (!finalHtml && variables) {
            const { nome, valor, vencimento } = variables;
            finalHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: sans-serif; color: #1e293b; line-height: 1.6; margin: 0; padding: 0; background-color: #f1f5f9; }
                    .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; }
                    .header { text-align: center; padding: 30px; border-bottom: 1px solid #f1f5f9; }
                    .hero { background-color: #002D5E; color: #ffffff; padding: 40px; text-align: center; }
                    .hero h1 { margin: 0; font-size: 24px; }
                    .content { padding: 40px; }
                    .cards { display: flex; gap: 20px; margin-bottom: 30px; }
                    .card { flex: 1; background: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; }
                    .card-label { font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: bold; margin-bottom: 5px; }
                    .card-value { font-size: 18px; font-weight: bold; color: #002D5E; }
                    .footer { background: #f8fafc; padding: 30px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
                    .btn { display: inline-block; background-color: #f97316; color: #ffffff; padding: 15px 30px; border-radius: 30px; text-decoration: none; font-weight: bold; margin-top: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <img src="https://b2wenergia.com.br/wp-content/uploads/2025/12/Logo-Laranja-estreito.png" alt="B2W Energia" height="40">
                    </div>
                    <div class="hero">
                        <h1>Sua fatura chegou!</h1>
                        <p>Olá, ${nome}. Sua fatura do mês já está disponível.</p>
                    </div>
                    <div class="content">
                        <div style="display: table; width: 100%; border-spacing: 10px;">
                            <div style="display: table-cell; background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; width: 50%;">
                                <div style="font-size: 11px; color: #64748b; font-weight: bold;">VENCIMENTO</div>
                                <div style="font-size: 16px; font-weight: bold; color: #002D5E;">${vencimento}</div>
                            </div>
                            <div style="display: table-cell; background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; width: 50%;">
                                <div style="font-size: 11px; color: #64748b; font-weight: bold;">VALOR TOTAL</div>
                                <div style="font-size: 16px; font-weight: bold; color: #002D5E;">${valor}</div>
                            </div>
                        </div>
                        <p style="margin-top: 30px;">Como cliente <strong>B2W Energia</strong>, você tem acesso ao nosso portal para gerenciar sua conta com transparência.</p>
                        <div style="text-align: center;">
                            <a href="https://app.b2wenergia.com.br" class="btn">Acessar minha conta</a>
                        </div>
                    </div>
                    <div class="footer">
                        © 2026 B2W Energia. Todos os direitos reservados.
                    </div>
                </div>
            </body>
            </html>
            `;
        }

        // 3. Enviar via Resend
        const emailResponse = await resend.emails.send({
            from: 'B2W Energia <faturas@comunicacao.b2wenergia.com.br>', // Use o domínio verificado no Resend
            to: [to],
            subject: subject || 'Sua fatura B2W Energia chegou!',
            html: finalHtml || `<p>Olá, sua fatura está pronta.</p>`,
            attachments: attachments || []
        });

        if (emailResponse.error) {
            throw new Error(emailResponse.error.message);
        }

        return new Response(
            JSON.stringify({ success: true, data: emailResponse.data }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200
            }
        )

    } catch (error) {
        console.error('Edge Function Error:', error);
        return new Response(
            JSON.stringify({ error: error.message }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400
            }
        )
    }
})
