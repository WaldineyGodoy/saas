import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Loading } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { extrairIndicador, guardarIndicacaoPendente } from '../../lib/indicacao';

/**
 * Rota do link de indicação: apps.b2wenergia.com.br/i/<id> (e o mesmo
 * caminho no app nativo, quando os links passarem a abrir o app). Guarda a
 * indicação e manda para criar conta, ou para a pergunta da indicação se a
 * pessoa já estiver logada.
 */
export default function LinkIndicacao() {
  const { codigo } = useLocalSearchParams<{ codigo: string }>();
  const { session } = useAuth();
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    const lido = extrairIndicador(String(codigo ?? ''));
    (lido && 'id' in lido ? guardarIndicacaoPendente(lido.id, 'link') : Promise.resolve()).finally(() => setPronto(true));
  }, [codigo]);

  if (!pronto) return <Loading />;
  // Logado: o início decide (login sem produto vai para a pergunta da indicação).
  return <Redirect href={session ? '/' : '/criar-conta'} />;
}
