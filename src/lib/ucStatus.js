// UC que já saiu de operação: não volta a ser candidata a vínculo com usina.
// Mesma lista que o ConsumerUnitModal usa para pedir o prazo de acompanhamento
// da conta ao encerrar a UC.
export const UC_STATUS_ENCERRADOS = ['desconectado', 'desligado_por_tt', 'cancelado', 'cancelado_inadimplente'];

export const ucEncerrada = (uc) => UC_STATUS_ENCERRADOS.includes(uc?.status);
