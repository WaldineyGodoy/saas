import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Empty, Loading, Screen } from '../components/ui';
import { useAdesaoCliente } from '../lib/api';
import { Andamento, Concluida, Nova } from './adesao';

/**
 * Adesão assistida (decisão do dono, 14/10/2026): na Home Connect o Parceiro
 * Power cadastra um novo assinante para a rede dele, com o mesmo passo a
 * passo da adesão de Energia. Sem `id`, começa uma adesão nova; com `id`
 * (vindo da rede do parceiro), continua a do cliente de onde parou.
 */
export default function AdesaoCliente() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const adesao = useAdesaoCliente(id);
  const qc = useQueryClient();
  const atualizar = async () => {
    await adesao.refetch();
    qc.invalidateQueries({ queryKey: ['rede-parceiro'] });
  };

  if (!id) {
    return (
      <Nova
        cliente
        onCriada={async (subscriberId) => {
          qc.invalidateQueries({ queryKey: ['rede-parceiro'] });
          router.replace({ pathname: '/adesao-cliente', params: { id: subscriberId } });
        }}
      />
    );
  }
  if (adesao.isLoading) return <Loading />;
  const a = adesao.data;
  if (!a) {
    return (
      <Screen>
        <Empty icon="person-search" title="Adesão não encontrada" text="Este cadastro não está na sua rede ou foi cancelado." />
      </Screen>
    );
  }
  if (a.etapa === 'assinado') return <Concluida cliente nome={a.nome} />;
  return <Andamento cliente adesao={a} onAtualizar={atualizar} />;
}
