const MEIO = { link: 'link', qr: 'QR Code', app: 'app', organico: 'acesso direto' };

const MOTIVO = {
    contrato_assinado: 'Não mudou a indicação: o contrato já estava assinado.',
    ja_assinante: 'Não mudou a indicação: o celular já é de um assinante.',
};

/** Texto de uma visita do lead (lead_visitas) para o histórico no CRM. */
export function rotuloVisita(v) {
    const meio = MEIO[v?.meio] || 'link';
    const indicador = v?.indicador?.name;
    const originador = v?.originador?.name;

    let titulo;
    if (indicador && originador) titulo = `Indicado por ${indicador} (parceiro ${originador}), via ${meio}`;
    else if (indicador) titulo = `Indicado por ${indicador}, via ${meio}`;
    else if (originador) titulo = `Link do parceiro ${originador}, via ${meio}`;
    else titulo = `Simulou de novo, sem link (${meio})`;

    const detalhe = v?.aplicada === false ? (MOTIVO[v.motivo] || 'Não mudou a indicação.') : null;
    return { titulo, detalhe };
}
