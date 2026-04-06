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
            console.error('Configuração do Resend não encontrada ou incompleta.');
            throw new Error('Configuração do Resend não encontrada.');
        }

        const getV = (key: string, fallback: string) => {
            const vars = config.variables;
            if (!vars) return fallback;
            if (typeof vars === 'object' && !Array.isArray(vars)) return vars[key] || fallback;
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
        
        // Destinatário
        let finalRecipient = to;
        if (isSandbox) finalRecipient = getV('test_email', 'waldineygodoy@gmail.com');

        const resend = new Resend(config.api_key);

        // Template de Altíssima Fidelidade (inspirado em Email de fatura/src/App.tsx)
        let finalHtml = html;
        if (!finalHtml && variables) {
            const { nome, valor, vencimento, mensagem } = variables;
            const brandLogo = "https://b2wenergia.com.br/wp-content/uploads/2025/12/Logo-Laranja-estreito.png";
            
            finalHtml = `
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Sua Fatura B2W Energia</title>
            </head>
            <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f1f5f9; color: #1e293b;">
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f1f5f9; padding: 40px 10px;">
                    <tr>
                        <td align="center">
                            <!-- Main Container -->
                            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);">
                                
                                <!-- Header -->
                                <tr>
                                    <td align="center" style="padding: 30px; border-bottom: 1px solid #f1f5f9;">
                                        <img src="${brandLogo}" alt="B2W Energia" style="height: 48px; width: auto; display: block;">
                                    </td>
                                </tr>

                                <!-- Hero Section -->
                                <tr>
                                    <td align="center" style="background-color: #003366; padding: 40px 30px; color: #ffffff;">
                                        <div style="width: 64px; height: 64px; background-color: #FF6600; border-radius: 50%; margin-bottom: 20px; display: table;">
                                            <div style="display: table-cell; vertical-align: middle; text-align: center; color: #ffffff; font-size: 32px;">📄</div>
                                        </div>
                                        <h1 style="margin: 0; font-size: 28px; font-weight: bold; margin-bottom: 10px;">Sua fatura chegou!</h1>
                                        <p style="margin: 0; font-size: 18px; color: #94a3b8; opacity: 0.9;">Olá, ${nome || 'assinante'}. Sua fatura do mês já está disponível.</p>
                                    </td>
                                </tr>

                                <!-- Content Section -->
                                <tr>
                                    <td style="padding: 30px 40px;">
                                        
                                        <!-- Test Message -->
                                        ${mensagem ? `
                                        <div style="background-color: #fff7ed; border: 1px dashed #fdba74; border-radius: 12px; padding: 20px; margin-bottom: 30px; font-style: italic; color: #9a3412;">
                                            <strong>Nota de teste:</strong> ${mensagem}
                                        </div>
                                        ` : ''}

                                        <!-- Quick Info -->
                                        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 30px;">
                                            <tr>
                                                <td width="48%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 15px;">
                                                    <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                                        <tr>
                                                            <td width="40" style="background-color: #dbeafe; border-radius: 8px; padding: 6px; text-align: center;">📅</td>
                                                            <td style="padding-left: 12px;">
                                                                <div style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">Vencimento</div>
                                                                <div style="font-size: 16px; font-weight: bold; color: #003366;">${vencimento || 'A consultar'}</div>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                </td>
                                                <td width="4%"></td>
                                                <td width="48%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 15px;">
                                                    <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                                        <tr>
                                                            <td width="40" style="background-color: #ffedd5; border-radius: 8px; padding: 6px; text-align: center;">💳</td>
                                                            <td style="padding-left: 12px;">
                                                                <div style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">Valor Total</div>
                                                                <div style="font-size: 16px; font-weight: bold; color: #003366;">${valor || 'R$ 0,00'}</div>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                        </table>

                                        <!-- Highlights -->
                                        <div style="margin-bottom: 30px;">
                                            <h2 style="font-size: 20px; font-weight: bold; color: #003366; margin-bottom: 20px;">Tudo em um só lugar ✅</h2>
                                            
                                            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 15px;">
                                                <tr>
                                                    <td width="48" valign="top" style="background-color: #dcfce7; border-radius: 50%; width: 44px; height: 44px; text-align: center; vertical-align: middle;">📈</td>
                                                    <td style="padding-left: 15px; padding-bottom: 20px;">
                                                        <div style="font-weight: bold; color: #003366;">Economia do Mês</div>
                                                        <div style="font-size: 14px; color: #64748b;">Acompanhe quanto você economizou na sua conta de luz.</div>
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td width="48" valign="top" style="background-color: #dbeafe; border-radius: 50%; width: 44px; height: 44px; text-align: center; vertical-align: middle;">📊</td>
                                                    <td style="padding-left: 15px; padding-bottom: 20px;">
                                                        <div style="font-weight: bold; color: #003366;">Consumo Detalhado</div>
                                                        <div style="font-size: 14px; color: #64748b;">Consulte seu histórico de consumo de forma simples.</div>
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td width="48" valign="top" style="background-color: #ffedd5; border-radius: 50%; width: 44px; height: 44px; text-align: center; vertical-align: middle;">📥</td>
                                                    <td style="padding-left: 15px; padding-bottom: 20px;">
                                                        <div style="font-weight: bold; color: #003366;">Segunda Via</div>
                                                        <div style="font-size: 14px; color: #64748b;">Baixe o boleto atualizado sempre que precisar.</div>
                                                    </td>
                                                </tr>
                                            </table>
                                        </div>

                                        <!-- CTA Button -->
                                        <div style="text-align: center; padding-top: 20px;">
                                            <a href="https://app.b2wenergia.com.br" style="background-color: #FF6600; color: #ffffff; padding: 18px 40px; border-radius: 30px; text-decoration: none; font-weight: bold; font-size: 18px; display: inline-block; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">Acessar minha conta</a>
                                            <p style="margin-top: 15px; font-size: 14px; color: #94a3b8;">Ou acesse: <span style="color: #003366; font-weight: bold;">app.b2wenergia.com.br</span></p>
                                        </div>

                                    </td>
                                </tr>

                                <!-- Footer -->
                                <tr>
                                    <td style="background-color: #f8fafc; border-top: 1px solid #f1f5f9; padding: 40px;">
                                        <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                            <tr>
                                                <td width="60%" style="color: #64748b; font-size: 14px; line-height: 1.6;">
                                                    <div style="font-weight: bold; color: #003366; text-transform: uppercase; font-size: 12px; margin-bottom: 10px;">Canais de Atendimento</div>
                                                    📞 31 99536-7744<br>
                                                    📧 atendimento@b2wenergia.com.br<br>
                                                    🌐 www.b2wenergia.com.br
                                                </td>
                                                <td align="right" valign="bottom">
                                                    <img src="${brandLogo}" alt="B2W Energia" style="height: 24px; opacity: 0.5; filter: grayscale(1);">
                                                    <p style="font-size: 10px; color: #94a3b8; margin: 10px 0 0 0;">© 2026 B2W Energia. Todos os direitos reservados.</p>
                                                </td>
                                            </tr>
                                        </table>
                                        <div style="font-size: 10px; color: #cbd5e1; text-align: center; border-top: 1px solid #e2e8f0; margin-top: 30px; pt: 20px; padding-top: 20px;">
                                            Este é um e-mail automático enviado para clientes ativos da B2W Energia.
                                        </div>
                                    </td>
                                </tr>

                            </table>
                        </td>
                    </tr>
                </table>
            </body>
            </html>`;
        }

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

        console.log('Resend API Response Success:', emailResponse.data);

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
