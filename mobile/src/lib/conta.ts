// Leitura da conta de energia para pedir uma nova UC.
//
// A leitura e feita no servidor (Edge Function parse-invoice-image, foto ou
// PDF) e volta pronta, com os campos derivados. Ler a conta NAO cria UC: vira
// um pedido para a equipe (app_solicitar_nova_uc), e a UC so nasce quando o
// termo for assinado.

export type EnderecoConta = {
  logradouro?: string; complemento?: string; bairro?: string;
  cep?: string; cidade?: string; uf?: string; completo?: string;
};

export type ContaLida = {
  numeroUc: string;
  numeroUcNovo?: string;
  codigoCliente?: string;
  codigoInstalacao?: string;
  titular?: string;
  documentoTipo?: string;
  documento?: string;
  endereco?: EnderecoConta | null;
  classificacao?: string;
  tipoFornecimento?: string;
  ligacao?: '' | 'monofasico' | 'bifasico' | 'trifasico';
  mediaKwh?: number;
  historico?: { mes: string; kwh: number; dias: number }[];
  mesReferencia?: string;
  consumoKwh?: number;
  valorTotal?: number;
  concessionaria?: string;
};

/** Mesmo recorte de contaParaPedido (src/lib/energyBillParser.js no CRM):
 *  so o que serve para cadastrar a UC; nada de linha digitavel ou PIX. */
const CAMPOS_PEDIDO = [
  'numeroUc', 'numeroUcNovo', 'codigoCliente', 'codigoInstalacao', 'titular', 'documentoTipo', 'documento',
  'endereco', 'classificacao', 'tipoFornecimento', 'ligacao', 'mediaKwh', 'historico', 'mesReferencia',
  'consumoKwh', 'valorTotal', 'concessionaria',
] as const;

export const contaParaPedido = (leitura: Record<string, unknown>): ContaLida => {
  const pedido: Record<string, unknown> = { concessionaria: 'Neoenergia Cosern' };
  for (const campo of CAMPOS_PEDIDO) {
    const v = leitura[campo];
    if (v !== undefined && v !== null && v !== '') pedido[campo] = v;
  }
  return pedido as ContaLida;
};

export const LIGACAO: Record<string, string> = {
  monofasico: 'Monofásico', bifasico: 'Bifásico', trifasico: 'Trifásico',
};

/** Lado maior da foto enviada: acima disso a leitura nao melhora e o envio fica lento
 *  (mesmo limite do CRM web). */
export const LADO_MAXIMO = 2000;

/** Redimensiona so o lado maior, mantendo a proporcao; nunca amplia. */
export const tamanhoReduzido = (largura: number, altura: number): { width?: number; height?: number } | null => {
  if (!largura || !altura || Math.max(largura, altura) <= LADO_MAXIMO) return null;
  return largura >= altura ? { width: LADO_MAXIMO } : { height: LADO_MAXIMO };
};

/** ~5 MB de arquivo em base64; o servidor recusa acima de 7 milhoes de caracteres. */
export const PDF_MAXIMO_BYTES = 5 * 1024 * 1024;

/** Mensagens do banco chegam sem acento (padrao das RPCs); o app mostra o texto como veio,
 *  so troca o erro tecnico de funcao ausente por algo que o cliente entenda. */
export const mensagemDeErro = (msg: string): string =>
  /function .* does not exist|Could not find the function/i.test(msg)
    ? 'O servidor ainda não está preparado para este pedido. Avise o suporte B2W.'
    : msg;
