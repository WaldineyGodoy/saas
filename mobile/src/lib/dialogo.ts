import { Alert, Platform } from 'react-native';

/**
 * Avisos e confirmações que funcionam também no webapp.
 *
 * `Alert.alert` do react-native-web não faz nada: no apps.b2wenergia.com.br
 * os botões "Sair" e "Excluir conta" ficavam mudos. Na web vale o diálogo do
 * navegador; no app nativo, o Alert de sempre.
 */
export function avisar(titulo: string, mensagem?: string) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.alert(mensagem ? `${titulo}\n\n${mensagem}` : titulo);
    return;
  }
  Alert.alert(titulo, mensagem);
}

export function confirmar(titulo: string, mensagem: string, acao: string, aoConfirmar: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${titulo}\n\n${mensagem}`)) aoConfirmar();
    return;
  }
  Alert.alert(titulo, mensagem, [
    { text: 'Cancelar', style: 'cancel' },
    { text: acao, style: 'destructive', onPress: aoConfirmar },
  ]);
}
