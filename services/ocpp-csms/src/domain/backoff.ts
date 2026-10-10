// Reenvio de comando ao carregador: 2s, 4s, 8s; depois disso o comando expira.
export const MAX_TENTATIVAS = 3;

export function proximoAtrasoMs(tentativa: number): number | null {
  if (tentativa < 1 || tentativa > MAX_TENTATIVAS) return null;
  return 2000 * 2 ** (tentativa - 1);
}
