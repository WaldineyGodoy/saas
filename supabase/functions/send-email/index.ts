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

        // 2. Verificar Ambiente (Sandbox vs Produção) via Configuração do Asaas
        const { data: asaasConfig } = await supabaseAdmin
            .from('integrations_config')
            .select('environment')
            .eq('service_name', 'financial_api')
            .single();

        const isSandbox = asaasConfig?.environment === 'sandbox';
        const testEmail = config.variables?.test_email || 'waldineygodoy@gmail.com';
        
        // Destinatário final (Redireciona se for Sandbox)
        const recipient = isSandbox ? testEmail : to;

        const resend = new Resend(config.api_key);

        // 2. Preparar E-mail
        // Se html não for passado, geramos um template padrão baseado no B2W (se variables existirem)
        let finalHtml = html;
        if (!finalHtml && variables) {
            const { nome, valor, vencimento } = variables;
            finalHtml = `
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Sua fatura chegou!</title>
                <style>
                    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1e293b; line-height: 1.6; margin: 0; padding: 0; background-color: #f8fafc; }
                    .wrapper { width: 100%; table-layout: fixed; background-color: #f8fafc; padding-bottom: 40px; }
                    .main { background-color: #ffffff; width: 100%; max-width: 600px; margin: 0 auto; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; margin-top: 20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
                    .header { text-align: center; padding: 25px; border-bottom: 1px solid #f1f5f9; }
                    .hero { background-color: #003366; color: #ffffff; padding: 40px 30px; text-align: center; }
                    .hero h1 { margin: 0; font-size: 28px; font-weight: bold; margin-bottom: 10px; }
                    .hero p { margin: 0; font-size: 16px; opacity: 0.9; }
                    .content { padding: 30px; }
                    /* Info Cards using Table for best email compatibility */
                    .info-table { width: 100%; border-collapse: separate; border-spacing: 12px 0; margin-bottom: 30px; }
                    .card { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 15px; text-align: left; }
                    .card-label { font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: bold; margin-bottom: 4px; letter-spacing: 0.05em; }
                    .card-value { font-size: 18px; font-weight: bold; color: #003366; }
                    .benefit { margin-bottom: 20px; display: flex; align-items: flex-start; }
                    .benefit-icon { background-color: #fef3c7; color: #FF6600; font-size: 18px; width: 32px; height: 32px; line-height: 32px; text-align: center; border-radius: 8px; margin-right: 15px; flex-shrink: 0; }
                    .benefit-text h3 { margin: 0; font-size: 16px; color: #003366; font-weight: 700; }
                    .benefit-text p { margin: 2px 0 0 0; font-size: 13px; color: #64748b; }
                    .cta { text-align: center; padding: 10px 0 30px 0; }
                    .btn { display: inline-block; background-color: #FF6600; color: #ffffff; padding: 16px 40px; border-radius: 32px; text-decoration: none; font-weight: bold; font-size: 16px; box-shadow: 0 4px 6px rgba(255, 102, 0, 0.2); transition: background-color 0.3s; }
                    .footer { background-color: #f8fafc; padding: 30px; border-top: 1px solid #e2e8f0; }
                    .footer-table { width: 100%; font-size: 12px; color: #64748b; }
                    .contact-title { font-weight: bold; color: #003366; text-transform: uppercase; font-size: 11px; margin-bottom: 8px; opacity: 0.8; }
                    .disclaimer { font-size: 10px; color: #94a3b8; text-align: center; margin-top: 20px; border-top: 1px solid #e2e8f0; pt: 15px; }
                </style>
            </head>
            <body>
                <div class="wrapper">
                    <table class="main" cellpadding="0" cellspacing="0">
                        <tr>
                            <td class="header">
                                <img src="https://b2wenergia.com.br/wp-content/uploads/2025/12/Logo-Laranja-estreito.png" alt="B2W Energia" height="42" style="display: block; margin: 0 auto;">
                            </td>
                        </tr>
                        <tr>
                            <td class="hero">
                                <div style="width: 50px; height: 50px; background-color: #FF6600; border-radius: 50%; margin: 0 auto 20px auto; line-height: 50px; font-size: 24px;">📄</div>
                                <h1>Sua fatura chegou!</h1>
                                <p>Olá, ${nome}. Sua fatura com economia B2W já está disponível.</p>
                            </td>
                        </tr>
                        <tr>
                            <td class="content">
                                <table class="info-table" cellpadding="0" cellspacing="0">
                                    <tr>
                                        <td width="50%">
                                            <div class="card">
                                                <div class="card-label">🗓️ VENCIMENTO</div>
                                                <div class="card-value">${vencimento}</div>
                                            </div>
                                        </td>
                                        <td width="50%">
                                            <div class="card">
                                                <div class="card-label">💰 VALOR TOTAL</div>
                                                <div class="card-value">${valor}</div>
                                            </div>
                                        </td>
                                    </tr>
                                </table>

                                <h2 style="font-size: 18px; color: #003366; margin-bottom: 20px; border-bottom: 2px solid #f1f5f9; padding-bottom: 10px;">Tudo em um só lugar</h2>
                                
                                <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 30px;">
                                    <tr>
                                        <td style="padding-bottom: 20px;">
                                            <table width="100%" cellpadding="0" cellspacing="0">
                                                <tr>
                                                    <td width="48" valign="top">
                                                        <div style="background-color: #dcfce7; color: #16a34a; font-size: 20px; width: 36px; height: 36px; line-height: 36px; text-align: center; border-radius: 8px;">📉</div>
                                                    </td>
                                                    <td valign="top">
                                                        <div style="font-weight: bold; color: #003366; font-size: 15px;">Economia do Mês</div>
                                                        <div style="font-size: 13px; color: #64748b;">Acompanhe quanto você economizou na sua conta de luz.</div>
                                                    </td>
                                                </tr>
                                            </table>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding-bottom: 20px;">
                                            <table width="100%" cellpadding="0" cellspacing="0">
                                                <tr>
                                                    <td width="48" valign="top">
                                                        <div style="background-color: #e0f2fe; color: #003366; font-size: 20px; width: 36px; height: 36px; line-height: 36px; text-align: center; border-radius: 8px;">📊</div>
                                                    </td>
                                                    <td valign="top">
                                                        <div style="font-weight: bold; color: #003366; font-size: 15px;">Consumo Detalhado</div>
                                                        <div style="font-size: 13px; color: #64748b;">Consulte seu histórico de consumo de forma simples.</div>
                                                    </td>
                                                </tr>
                                            </table>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td>
                                            <table width="100%" cellpadding="0" cellspacing="0">
                                                <tr>
                                                    <td width="48" valign="top">
                                                        <div style="background-color: #ffedd5; color: #FF6600; font-size: 20px; width: 36px; height: 36px; line-height: 36px; text-align: center; border-radius: 8px;">📥</div>
                                                    </td>
                                                    <td valign="top">
                                                        <div style="font-weight: bold; color: #003366; font-size: 15px;">Segunda Via</div>
                                                        <div style="font-size: 13px; color: #64748b;">Baixe o boleto atualizado sempre que precisar.</div>
                                                    </td>
                                                </tr>
                                            </table>
                                        </td>
                                    </tr>
                                </table>

                                <div class="cta">
                                    <a href="https://app.b2wenergia.com.br" class="btn">Acessar minha conta</a>
                                    <p style="font-size: 12px; color: #94a3b8; margin-top: 15px;">Ou acesse: <span style="color: #003366; font-weight: 500;">app.b2wenergia.com.br</span></p>
                                </div>
                            </td>
                        </tr>
                        <tr>
                            <td class="footer">
                                <table class="footer-table" cellpadding="0" cellspacing="0">
                                    <tr>
                                        <td width="60%" valign="top">
                                            <div class="contact-title">Canais de Atendimento</div>
                                            <div style="margin-bottom: 5px;">📞 0800 123 4567</div>
                                            <div style="margin-bottom: 5px;">📧 atendimento@b2wenergia.com.br</div>
                                            <div>🌐 www.b2wenergia.com.br</div>
                                        </td>
                                        <td width="40%" valign="bottom" align="right">
                                            <img src="https://b2wenergia.com.br/wp-content/uploads/2025/12/Logo-Laranja-estreito.png" alt="B2W Energia" height="28" style="opacity: 0.5; filter: grayscale(100%);">
                                        </td>
                                    </tr>
                                </table>
                                <div class="disclaimer">
                                    © 2026 B2W Energia. Todos os direitos reservados.<br>
                                    Este é um e-mail automático, por favor não responda.
                                </div>
                            </td>
                        </tr>
                    </table>
                </div>
            </body>
            </html>
            `;
        }

        // 3. Enviar via Resend
        const fromEmail = config.variables?.from_email || 'faturas@comunicacao.b2wenergia.com.br';
        const fromName = config.variables?.from_name || 'B2W Energia';
        const fromHeader = `${fromName} <${fromEmail}>`;

        const emailResponse = await resend.emails.send({
            from: fromHeader,
            to: [recipient],
            subject: `${isSandbox ? '[SANDBOX] ' : ''}${subject || 'Sua fatura B2W Energia chegou!'}`,
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
