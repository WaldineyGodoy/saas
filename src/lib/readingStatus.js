export const deriveReadingStatus = (status, energyBillStatus, options = {}) => {
    const { valorConcessionaria, concessionariaPdfUrl, isPlaceholder } = options;
    const s = String(status || '').toLowerCase().trim();
    const e = String(energyBillStatus || '').toLowerCase().trim();

    const ERROR      = ['erro','error','indisponivel','indisponível'];
    const PROCESSING = ['processing','processando'];
    const PAID       = ['pago','parcelada','contestada'];
    const PENDING    = ['pending','pendente','aguardando'];
    const SUCCESS    = ['success','sucesso','pago','parcelada','contestada',
                        'consistente','a_vencer','atrasada','atrasado', 'confirmado'];

    // IMPORTANTE: Mantenha esta função sincronizada com a function 'derive_reading_status' no PostgreSQL.
    // Se alterar a regra aqui, lembre-se de alterar o trigger lá!

    // 1. cancelada -> sem status de leitura
    if (s === 'cancelado' || s === 'cancelada') return null;

    // 2. erro
    if (ERROR.includes(s) || ERROR.includes(e)) return 'error';

    // 3. processando
    if (PROCESSING.includes(s) || PROCESSING.includes(e)) return 'processing';

    // 4. PAID_SET sobre STATUS (não sobre energy_bill_status)
    if (PAID.includes(s)) return 'success';

    // 5. hasRealBill -> valor > 0 E pdf (AND, não OR)
    if (Number(valorConcessionaria) > 0 && !!concessionariaPdfUrl) return 'success';

    // 6. pendente
    if (PENDING.includes(s) || PENDING.includes(e)) return 'pending';

    // 7. placeholder
    if (isPlaceholder === true) return 'pending';

    // 8. SUCCESS_SET
    if (SUCCESS.includes(s) || SUCCESS.includes(e)) return 'success';

    // 9. default seguro
    return 'pending';
};
