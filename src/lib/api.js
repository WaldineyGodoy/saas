/**
 * Helper unificado para enviar notificações de fatura (Email + WhatsApp)
 * @param {Object} params 
 */
export const sendCombinedNotification = async ({
    recipientEmail,
    recipientPhone,
    subscriberName,
    dueDate,
    value,
    pdfBlob,
    fileName,
    subscriberId,
    profileId,
    isConsolidated = false
}) => {
    try {
        const { data: configs } = await supabase
            .from('integrations_config')
            .select('*')
            .in('service_name', ['financial_api', 'evolution_api', 'resend_api']);

        const asaasConfig = configs?.find(c => c.service_name === 'financial_api');
        const evolutionConfig = configs?.find(c => c.service_name === 'evolution_api');
        const resendConfig = configs?.find(c => c.service_name === 'resend_api');

        const isSandbox = asaasConfig?.environment === 'sandbox';
        
        let testPhone = '';
        if (evolutionConfig?.variables) {
            const vars = evolutionConfig.variables;
            testPhone = (typeof vars === 'object' && !Array.isArray(vars)) 
                ? vars.test_phone 
                : (Array.isArray(vars) ? vars.find(v => v.key === 'test_phone')?.value : '');
        }

        const targetPhone = isSandbox ? (testPhone || '5533999991234') : recipientPhone;
        const targetEmailForLog = isSandbox ? (resendConfig?.variables?.test_email || 'waldineygodoy@gmail.com') : recipientEmail;

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(pdfBlob);
            reader.onerror = reject;
            reader.onloadend = async () => {
                const base64Data = reader.result.split(',')[1];
                
                // 1. Upload to Storage to avoid Base64 size limits in Evolution API v2
                let waMediaUrl = null;
                try {
                    const storagePath = `merged/${Date.now()}_${fileName}`;
                    const { error: uploadError } = await supabase.storage
                        .from('invoices_pdfs')
                        .upload(storagePath, pdfBlob);

                    if (!uploadError) {
                        const { data: signedData, error: signedError } = await supabase.storage
                            .from('invoices_pdfs')
                            .createSignedUrl(storagePath, 3600); // 1 hour

                        if (!signedError) {
                            waMediaUrl = signedData.signedUrl;
                        }
                    }
                } catch (storageErr) {
                    console.error('Error uploading/signing PDF for WhatsApp:', storageErr);
                }

                const emailPromise = sendInvoiceEmail(
                    recipientEmail, 
                    'Sua fatura B2W Energia chegou!',
                    null,
                    [{ filename: fileName, content: base64Data }],
                    { nome: subscriberName, vencimento: dueDate, valor: value }
                ).catch(e => ({ error: e.message }));

                const waText = `Sua fatura da *B2W Energia* chegou! ⚡⚡\n\nOlá, *${subscriberName}*.\nSua fatura com vencimento em *${dueDate}* no valor de *${value}* já está disponível.\nSegue em anexo o PDF completo (Demonstrativo + Boleto). 📄\n\nClique no link abaixo para acessar nosso portal:\nhttps://app.b2wenergia.com.br\n\n*B2W Energia* ☀️`;
                
                const waPromise = targetPhone ? sendWhatsapp(
                    targetPhone,
                    waText,
                    waMediaUrl, // Using URL instead of Base64 for WhatsApp
                    null,       // No Base64 for WhatsApp now
                    fileName
                ).catch(e => ({ error: e.message })) : Promise.resolve({ skipped: true });

                const [emailRes, waRes] = await Promise.all([emailPromise, waPromise]);

                let logContent = `Fatura enviada ao e-mail ${targetEmailForLog}`;
                if (targetPhone) logContent += ` e whatsapp ${targetPhone}`;
                if (isSandbox) logContent += ' (Modo Sandbox)';

                await supabase.from('crm_history').insert({
                    entity_type: 'subscriber',
                    entity_id: subscriberId,
                    content: logContent,
                    metadata: {
                        email_status: emailRes.error ? 'error' : 'sent',
                        wa_status: waRes.error ? 'error' : (waRes.skipped ? 'skipped' : 'sent'),
                        recipient_email: targetEmailForLog,
                        recipient_phone: targetPhone,
                        sandbox: isSandbox,
                        type: isConsolidated ? 'consolidated' : 'individual',
                        error_details: { email: emailRes.error, wa: waRes.error }
                    },
                    created_by: profileId
                });

                resolve({ emailRes, waRes, isSandbox, targetEmailForLog, targetPhone });
            };
        });
    } catch (error) {
        console.error('Error in sendCombinedNotification helper:', error);
        throw error;
    }
};
