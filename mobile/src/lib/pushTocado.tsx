import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { marcarLidas } from './api';
import { rotaDoPush } from './push';

/** Push tocado: marca como lida e abre a tela do aviso. Só no app nativo. */
function Ouvinte() {
  const resposta = Notifications.useLastNotificationResponse();
  const qc = useQueryClient();
  const tratado = useRef<string | null>(null);

  useEffect(() => {
    const dados = rotaDoPush(resposta ?? null);
    const chave = resposta?.notification.request.identifier ?? null;
    if (!dados || !chave || tratado.current === chave) return;
    tratado.current = chave;
    if (dados.id) {
      void marcarLidas([dados.id]).catch(() => {}).then(() => {
        void qc.invalidateQueries({ queryKey: ['notificacoes'] });
        void qc.invalidateQueries({ queryKey: ['notificacoes-nao-lidas'] });
      });
    }
    router.push((dados.rota || '/notificacoes') as Href);
  }, [resposta, qc]);

  // Push chegando com o app aberto: atualiza o sino.
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener(() => {
      void qc.invalidateQueries({ queryKey: ['notificacoes'] });
      void qc.invalidateQueries({ queryKey: ['notificacoes-nao-lidas'] });
    });
    return () => sub.remove();
  }, [qc]);

  return null;
}

export function AbrirPushTocado() {
  return Platform.OS === 'web' ? null : <Ouvinte />;
}
