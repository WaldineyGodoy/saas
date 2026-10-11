import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Campo } from '../components/Campo';
import { Button, Card, Chip, Hero, Icon, Loading, Row, Screen, type IconName } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import {
  criarAdesao, enviarDocumentoAdesao, gerarContratoAdesao, idDaUcAdesao, lerConta, useMinhaAdesao, usePerfil, usePlanosAdesao,
  type FaltaDocumento, type MinhaAdesao, type PlanoUc,
} from '../lib/api';
import { DIAS_VENCIMENTO, lerVisitaAdesao, URL_TERMOS_USO, VERSAO_TERMOS } from '../lib/adesao';
import { escolherFoto, escolherPdf, fotografar, type Arquivo } from '../lib/captura';
import { contaParaPedido, LIGACAO, mensagemDeErro, type ContaLida } from '../lib/conta';
import { buscarCep, documentoValido, soDigitos, tipoDocumento } from '../lib/documento';
import { fmtPct } from '../lib/format';
import { celularBR } from '../lib/indicacao';
import { PRIVACIDADE_URL } from '../lib/links';
import { colors, radius, space, type } from '../theme/tokens';

/**
 * Adesão de energia pelo app (decisão do dono, 11/10/2026): conta de luz ->
 * plano -> dados -> documentos -> contrato, tudo no app. O termo é gerado
 * no servidor (onboarding-finalizar, mesmo texto do site) e a assinatura
 * abre no navegador do app, na Autentique. Quem para no meio volta de onde
 * parou: o cadastro fica no banco e app_minha_adesao diz a etapa.
 */
export default function Adesao() {
  const adesao = useMinhaAdesao();
  const qc = useQueryClient();
  const atualizar = async () => {
    await adesao.refetch();
    qc.invalidateQueries({ queryKey: ['perfil'] });
  };

  if (adesao.isLoading) return <Loading />;
  const a = adesao.data;
  if (a?.etapa === 'assinado') return <Concluida />;
  if (a?.token) return <Andamento adesao={a} onAtualizar={atualizar} />;
  return <Nova onCriada={atualizar} />;
}

// ---------------------------------------------------------------------------

const PASSOS: { icon: IconName; titulo: string; texto: string }[] = [
  { icon: 'receipt-long', titulo: 'Sua conta de energia', texto: 'Foto ou PDF: lemos a UC, a distribuidora e o consumo.' },
  { icon: 'sell', titulo: 'Seu plano', texto: 'O desconto que vale para a sua distribuidora.' },
  { icon: 'person', titulo: 'Seus dados', texto: 'CPF, endereço e o melhor dia de vencimento.' },
  { icon: 'badge', titulo: 'Documentos', texto: 'Foto de um documento com foto (RG ou CNH).' },
  { icon: 'draw', titulo: 'Contrato', texto: 'Você assina pelo celular, sem papel.' },
];

function Passo({ n, titulo }: { n: number; titulo: string }) {
  return <Text style={[type.labelSm, { color: colors.secondary, textTransform: 'uppercase' }]}>{`Passo ${n} de 5 · ${titulo}`}</Text>;
}

function Erro({ texto }: { texto: string }) {
  if (!texto) return null;
  return (
    <Card style={{ flexDirection: 'row', gap: 10, borderColor: colors.error, borderWidth: 1 }}>
      <Icon name="error-outline" color={colors.error} />
      <Text style={[type.bodySm, { color: colors.error, flex: 1 }]}>{texto}</Text>
    </Card>
  );
}

/** Foto, galeria ou PDF: os três caminhos de enviar um arquivo. */
function EscolherArquivo({ onArquivo, ocupado, pdf = true }: { onArquivo: (a: Arquivo) => void; ocupado?: boolean; pdf?: boolean }) {
  const usar = (obter: () => Promise<Arquivo | null>) => async () => {
    const a = await obter();
    if (a) onArquivo(a);
  };
  return (
    <View style={{ gap: 8 }}>
      <Button label="Tirar foto" icon="photo-camera" onPress={usar(fotografar)} loading={ocupado} />
      <Row>
        <Button label="Da galeria" icon="photo-library" variant="secondary" style={{ flex: 1 }} onPress={usar(escolherFoto)} disabled={ocupado} />
        {pdf ? <Button label="PDF" icon="picture-as-pdf" variant="secondary" style={{ flex: 1 }} onPress={usar(escolherPdf)} disabled={ocupado} /> : null}
      </Row>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Adesão nova: conta -> plano -> dados

type Etapa = 'inicio' | 'lendo' | 'plano' | 'dados';

function Nova({ onCriada }: { onCriada: () => Promise<void> }) {
  const perfil = usePerfil();
  const { session } = useAuth();
  const meta = (session?.user?.user_metadata ?? {}) as { name?: string; phone?: string };
  const [etapa, setEtapa] = useState<Etapa>('inicio');
  const [conta, setConta] = useState<ContaLida | null>(null);
  const [arquivo, setArquivo] = useState<Arquivo | null>(null);
  const [plano, setPlano] = useState<PlanoUc | null>(null);
  const [erro, setErro] = useState('');
  const planos = usePlanosAdesao(etapa === 'plano' ? conta?.concessionaria : undefined);

  const ler = async (a: Arquivo) => {
    setErro('');
    setEtapa('lendo');
    try {
      const lida = contaParaPedido(await lerConta(a.base64, a.tipo));
      if (!lida.numeroUc) throw new Error('Não encontramos o número da UC nesta conta. Tente outra foto, com a conta inteira e boa luz.');
      setConta(lida);
      setArquivo(a);
      setPlano(null);
      setEtapa('plano');
    } catch (e) {
      setErro(mensagemDeErro(e instanceof Error ? e.message : String(e)));
      setEtapa('inicio');
    }
  };

  if (etapa === 'lendo') return <Loading label="Lendo a conta… pode levar uns 20 segundos" />;

  if (etapa === 'dados' && conta && arquivo) {
    return <Dados conta={conta} arquivo={arquivo} plano={plano} meta={meta} onVoltar={() => setEtapa('plano')} onCriada={onCriada} />;
  }

  if (etapa === 'plano' && conta) {
    const lista = planos.data ?? [];
    return (
      <Screen>
        <Passo n={2} titulo="Plano" />
        <Hero title="Escolha seu plano" subtitle={`Planos para ${conta.concessionaria ?? 'a sua distribuidora'}.`} />
        <Card style={{ gap: 4 }}>
          <Text style={[type.headlineSm, { color: colors.onSurface }]}>{`UC ${conta.numeroUc}`}</Text>
          <Text style={[type.bodySm, { color: colors.inkSecondary }]}>
            {[conta.titular, conta.mediaKwh ? `média de ${conta.mediaKwh} kWh/mês` : null].filter(Boolean).join(' · ')}
          </Text>
        </Card>
        {planos.isLoading ? <Loading /> : lista.length === 0 ? (
          <Card style={{ gap: 6 }}>
            <Text style={[type.body, { color: colors.onSurface }]}>A equipe B2W define o plano da sua UC.</Text>
            <Text style={[type.bodySm, { color: colors.inkSecondary }]}>Siga com a adesão: o desconto da sua região vale no contrato.</Text>
          </Card>
        ) : lista.map((p) => {
          const ativo = plano?.id === p.id;
          return (
            <Pressable
              key={p.id}
              onPress={() => setPlano(p)}
              accessibilityRole="radio"
              accessibilityLabel={p.nome}
              accessibilityState={{ selected: ativo }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.xl, backgroundColor: colors.surfaceLowest, borderWidth: 1, borderColor: ativo ? colors.primary : colors.borderSubtle }}
            >
              <Icon name={ativo ? 'radio-button-checked' : 'radio-button-unchecked'} color={ativo ? colors.primary : colors.inkMuted} />
              <View style={{ flex: 1 }}>
                <Text style={[type.headlineSm, { color: colors.onSurface }]}>{p.nome}</Text>
                {p.desconto_assinante != null ? <Text style={[type.bodySm, { color: colors.secondary }]}>{`${fmtPct(p.desconto_assinante)} de desconto na conta`}</Text> : null}
              </View>
            </Pressable>
          );
        })}
        <Erro texto={erro} />
        <Button
          label="Continuar"
          icon="arrow-forward"
          disabled={lista.length > 0 && !plano}
          onPress={() => setEtapa('dados')}
        />
        <Button label="Ler outra conta" icon="refresh" variant="ghost" onPress={() => { setConta(null); setEtapa('inicio'); }} />
      </Screen>
    );
  }

  const indicador = perfil.data?.lead?.indicador_nome;
  return (
    <Screen>
      <Hero kicker="Energia por assinatura" title="Vamos fazer sua adesão" subtitle="Leva poucos minutos. Tenha à mão uma conta de energia recente." />
      {indicador ? (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderColor: colors.secondary }}>
          <Icon name="volunteer-activism" color={colors.secondary} />
          <Text style={[type.body, { color: colors.onSurface, flex: 1 }]}>Indicação de <Text style={{ fontWeight: '700' }}>{indicador}</Text> registrada.</Text>
        </Card>
      ) : null}
      <Card style={{ gap: space.md }}>
        {PASSOS.map((p, i) => (
          <View key={p.titulo} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
            <Icon name={p.icon} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[type.headlineSm, { color: colors.onSurface }]}>{i + 1}. {p.titulo}</Text>
              <Text style={[type.bodySm, { color: colors.inkSecondary }]}>{p.texto}</Text>
            </View>
          </View>
        ))}
      </Card>
      <Erro texto={erro} />
      <Card style={{ gap: space.md }}>
        <Passo n={1} titulo="Conta de energia" />
        <Text style={[type.body, { color: colors.onSurface }]}>Fotografe a conta inteira, com boa luz, ou envie o PDF da distribuidora.</Text>
        <EscolherArquivo onArquivo={ler} />
      </Card>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Dados: titular, endereço, vencimento e aceite

function Dados({ conta, arquivo, plano, meta, onVoltar, onCriada }: {
  conta: ContaLida; arquivo: Arquivo; plano: PlanoUc | null; meta: { name?: string; phone?: string };
  onVoltar: () => void; onCriada: () => Promise<void>;
}) {
  const end = conta.endereco ?? {};
  const [nome, setNome] = useState(meta.name ?? '');
  const [celular, setCelular] = useState(meta.phone ?? '');
  const [doc, setDoc] = useState('');
  const [repNome, setRepNome] = useState('');
  const [repCpf, setRepCpf] = useState('');
  const [titularEu, setTitularEu] = useState(true);
  const [titularNome, setTitularNome] = useState(conta.titular ?? '');
  const [titularDoc, setTitularDoc] = useState('');
  const [ligacao, setLigacao] = useState<string>(conta.ligacao || '');
  const [cep, setCep] = useState(end.cep ?? '');
  const [rua, setRua] = useState(end.logradouro ?? '');
  const [numero, setNumero] = useState('');
  const [complemento, setComplemento] = useState(end.complemento ?? '');
  const [bairro, setBairro] = useState(end.bairro ?? '');
  const [cidade, setCidade] = useState(end.cidade ?? '');
  const [uf, setUf] = useState(end.uf ?? '');
  const [ibge, setIbge] = useState('');
  const [dia, setDia] = useState<number | null>(null);
  const [aceite, setAceite] = useState(false);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const ehCnpj = soDigitos(doc).length > 11;

  // O CEP da conta traz o código IBGE do município (desconto da região).
  const aplicarCep = async (valor: string, sobrescrever: boolean) => {
    const e = await buscarCep(valor);
    if (!e) return;
    setIbge(e.ibge);
    if (sobrescrever || !rua) setRua(e.rua || rua);
    if (sobrescrever || !bairro) setBairro(e.bairro || bairro);
    setCidade(e.cidade || cidade);
    setUf(e.uf || uf);
  };
  useEffect(() => { if (soDigitos(end.cep).length === 8) aplicarCep(end.cep!, false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const mudarCep = (t: string) => {
    setCep(t);
    if (soDigitos(t).length === 8) aplicarCep(t, true);
  };

  const enviar = async () => {
    setErro('');
    if (nome.trim().split(/\s+/).length < 2) return setErro('Informe nome e sobrenome.');
    const cel = celularBR(celular);
    if (!cel) return setErro('Celular inválido. Informe DDD + número.');
    if (!documentoValido(doc)) return setErro('CPF ou CNPJ inválido.');
    if (ehCnpj && (!repNome.trim() || tipoDocumento(repCpf) !== 'cpf' || !documentoValido(repCpf))) {
      return setErro('Para CNPJ, informe nome e CPF do representante legal.');
    }
    const docTitular = titularEu ? doc : titularDoc;
    if (!documentoValido(docTitular)) return setErro('Informe o CPF/CNPJ do titular da conta de luz.');
    if (!ligacao) return setErro('Escolha o tipo de ligação da conta (está na conta de luz).');
    if (soDigitos(cep).length !== 8 || !rua.trim() || !numero.trim() || !cidade.trim() || !uf.trim()) {
      return setErro('Confira o endereço da instalação: CEP, rua, número, cidade e UF.');
    }
    if (!dia) return setErro('Escolha o dia de vencimento.');
    if (!aceite) return setErro('Aceite os termos de uso e a política de privacidade para continuar.');

    const endereco = { cep: soDigitos(cep), rua: rua.trim(), numero: numero.trim(), complemento: complemento.trim(), bairro: bairro.trim(), cidade: cidade.trim(), uf: uf.trim().toUpperCase(), ibge };
    setEnviando(true);
    try {
      const visita = await lerVisitaAdesao();
      const r = await criarAdesao({
        name: nome.trim(), cpf_cnpj: soDigitos(doc), phone: cel, ...endereco,
        dia_vencimento: dia, aceite_versao: VERSAO_TERMOS,
        representante_nome: ehCnpj ? repNome.trim() : undefined,
        representante_cpf: ehCnpj ? soDigitos(repCpf) : undefined,
        ucs: [{
          numero_uc: conta.numeroUc, titular_conta: (titularEu ? nome : titularNome).trim(), cpf_cnpj_fatura: soDigitos(docTitular),
          tipo_ligacao: ligacao, concessionaria: conta.concessionaria, franquia: conta.mediaKwh,
          plano_assinatura_id: plano?.id ?? null, ...endereco,
        }],
      }, visita);
      // A conta de luz lida vira o documento da UC. Se falhar, o passo de
      // documentos pede de novo.
      try {
        await enviarDocumentoAdesao(r.onboarding_token, 'conta_energia', arquivo, await idDaUcAdesao(r.onboarding_token, conta.numeroUc));
      } catch { /* segue: o passo de documentos mostra o que falta */ }
      await onCriada();
    } catch (e) {
      setErro(mensagemDeErro(e instanceof Error ? e.message : String(e)));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Screen>
      <Passo n={3} titulo="Seus dados" />
      <Hero title="Seus dados" subtitle={`UC ${conta.numeroUc}${plano ? ` · ${plano.nome}` : ''}`} />
      <Card style={{ gap: space.md }}>
        <Campo label="Nome completo" value={nome} onChangeText={setNome} autoCapitalize="words" />
        <Campo label="CPF ou CNPJ" value={doc} onChangeText={setDoc} keyboardType="number-pad" />
        {ehCnpj ? (
          <>
            <Campo label="Representante legal" value={repNome} onChangeText={setRepNome} autoCapitalize="words" />
            <Campo label="CPF do representante" value={repCpf} onChangeText={setRepCpf} keyboardType="number-pad" />
          </>
        ) : null}
        <Campo label="Celular (WhatsApp)" value={celular} onChangeText={setCelular} keyboardType="phone-pad" placeholder="(84) 99999-9999" />
      </Card>

      <Card style={{ gap: space.md }}>
        <Text style={[type.headlineSm, { color: colors.onSurface }]}>Conta de luz</Text>
        <Caixa marcado={titularEu} onPress={() => setTitularEu(!titularEu)} texto="A conta está no meu nome" />
        {!titularEu ? (
          <>
            <Campo label="Titular da conta" value={titularNome} onChangeText={setTitularNome} autoCapitalize="words" />
            <Campo label="CPF/CNPJ do titular" value={titularDoc} onChangeText={setTitularDoc} keyboardType="number-pad" />
          </>
        ) : null}
        <Text style={[type.labelSm, { color: colors.onSurfaceVariant, textTransform: 'uppercase' }]}>Tipo de ligação</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {Object.entries(LIGACAO).map(([v, rotulo]) => <Chip key={v} label={rotulo} active={ligacao === v} onPress={() => setLigacao(v)} />)}
        </Row>
      </Card>

      <Card style={{ gap: space.md }}>
        <Text style={[type.headlineSm, { color: colors.onSurface }]}>Endereço da instalação</Text>
        <Campo label="CEP" value={cep} onChangeText={mudarCep} keyboardType="number-pad" maxLength={9} />
        <Campo label="Rua" value={rua} onChangeText={setRua} autoCapitalize="words" />
        <Row>
          <View style={{ flex: 1 }}><Campo label="Número" value={numero} onChangeText={setNumero} /></View>
          <View style={{ flex: 2 }}><Campo label="Complemento" value={complemento} onChangeText={setComplemento} autoCapitalize="sentences" /></View>
        </Row>
        <Campo label="Bairro" value={bairro} onChangeText={setBairro} autoCapitalize="words" />
        <Row>
          <View style={{ flex: 3 }}><Campo label="Cidade" value={cidade} onChangeText={setCidade} autoCapitalize="words" /></View>
          <View style={{ flex: 1 }}><Campo label="UF" value={uf} onChangeText={(t) => setUf(t.toUpperCase())} maxLength={2} autoCapitalize="characters" /></View>
        </Row>
      </Card>

      <Card style={{ gap: space.md }}>
        <Text style={[type.headlineSm, { color: colors.onSurface }]}>Dia de vencimento da fatura B2W</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {DIAS_VENCIMENTO.map((d) => <Chip key={d} label={`Dia ${d}`} active={dia === d} onPress={() => setDia(d)} />)}
        </Row>
      </Card>

      <Card style={{ gap: 8 }}>
        <Caixa marcado={aceite} onPress={() => setAceite(!aceite)} texto="Li e aceito os termos de uso e a política de privacidade da B2W Energia." />
        <Row>
          <Button label="Termos de uso" variant="ghost" style={{ flex: 1, minHeight: 36 }} onPress={() => WebBrowser.openBrowserAsync(URL_TERMOS_USO)} />
          <Button label="Privacidade" variant="ghost" style={{ flex: 1, minHeight: 36 }} onPress={() => WebBrowser.openBrowserAsync(PRIVACIDADE_URL)} />
        </Row>
      </Card>

      <Erro texto={erro} />
      <Button label="Continuar para os documentos" icon="arrow-forward" onPress={enviar} loading={enviando} />
      <Button label="Voltar ao plano" icon="arrow-back" variant="ghost" onPress={onVoltar} disabled={enviando} />
    </Screen>
  );
}

function Caixa({ marcado, onPress, texto }: { marcado: boolean; onPress: () => void; texto: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: marcado }} accessibilityLabel={texto}
      style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 4 }}>
      <Icon name={marcado ? 'check-box' : 'check-box-outline-blank'} color={marcado ? colors.primary : colors.inkMuted} />
      <Text style={[type.body, { color: colors.onSurface, flex: 1 }]}>{texto}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Adesão gravada: documentos -> contrato -> assinatura

const NOME_DOCUMENTO: Record<FaltaDocumento['tipo'], string> = {
  identidade: 'Documento com foto (RG ou CNH)',
  contrato_social: 'Contrato social da empresa',
  conta_energia: 'Conta de luz',
};

function Andamento({ adesao, onAtualizar }: { adesao: NonNullable<MinhaAdesao>; onAtualizar: () => Promise<void> }) {
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const token = adesao.token!;

  const enviar = (f: FaltaDocumento) => async (a: Arquivo) => {
    setErro('');
    setEnviando(`${f.tipo}:${f.consumer_unit_id ?? ''}`);
    try {
      await enviarDocumentoAdesao(token, f.tipo, a, f.consumer_unit_id);
      await onAtualizar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(null);
    }
  };

  const [gerando, setGerando] = useState(false);
  const assinar = async (link: string) => {
    await WebBrowser.openBrowserAsync(link);
    await onAtualizar();
  };
  const gerarEAssinar = async () => {
    setErro('');
    setGerando(true);
    try {
      const link = await gerarContratoAdesao(token);
      await assinar(link);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      await onAtualizar();
    } finally {
      setGerando(false);
    }
  };

  if (adesao.etapa === 'documentos') {
    return (
      <Screen>
        <Passo n={4} titulo="Documentos" />
        <Hero title="Envie seus documentos" subtitle="Seus dados foram gravados. Falta pouco: envie o que está abaixo." />
        {(adesao.faltantes ?? []).map((f) => {
          const chave = `${f.tipo}:${f.consumer_unit_id ?? ''}`;
          return (
            <Card key={chave} style={{ gap: space.md }}>
              <Text style={[type.headlineSm, { color: colors.onSurface }]}>
                {f.tipo === 'conta_energia' && f.numero_uc ? `${NOME_DOCUMENTO[f.tipo]} da UC ${f.numero_uc}` : NOME_DOCUMENTO[f.tipo]}
              </Text>
              {f.tipo === 'identidade' ? <Text style={[type.bodySm, { color: colors.inkSecondary }]}>Frente e verso legíveis. Pode ser foto ou PDF.</Text> : null}
              <EscolherArquivo onArquivo={enviar(f)} ocupado={enviando === chave} />
            </Card>
          );
        })}
        <Erro texto={erro} />
      </Screen>
    );
  }

  if (gerando) return <Loading label="Gerando seu contrato… pode levar uns 30 segundos" />;

  if (adesao.etapa === 'enviado') {
    return (
      <Screen>
        <Passo n={5} titulo="Contrato" />
        <Card style={{ alignItems: 'center', paddingVertical: 28, gap: 10 }}>
          <Icon name="draw" size={44} color={colors.primary} />
          <Text style={[type.headlineMd, { color: colors.onSurface, textAlign: 'center' }]}>Contrato pronto para assinar</Text>
          <Text style={[type.body, { color: colors.inkSecondary, textAlign: 'center' }]}>
            O link também foi para o seu WhatsApp e e-mail. Depois de assinado, sua adesão segue para ativação.
          </Text>
          {/* Sem o link guardado, pedir de novo devolve o mesmo documento (não cria outro). */}
          <Button label="Assinar contrato" icon="draw" onPress={() => (adesao.signature_link ? assinar(adesao.signature_link) : gerarEAssinar())} style={{ marginTop: 8, alignSelf: 'stretch' }} />
          <Button label="Já assinei" icon="refresh" variant="ghost" onPress={onAtualizar} style={{ alignSelf: 'stretch' }} />
        </Card>
        <Erro texto={erro} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Passo n={5} titulo="Contrato" />
      <Card style={{ alignItems: 'center', paddingVertical: 28, gap: 10 }}>
        <Icon name="task-alt" size={44} color={colors.secondary} />
        <Text style={[type.headlineMd, { color: colors.onSurface, textAlign: 'center' }]}>Tudo certo! Agora é o contrato</Text>
        <Text style={[type.body, { color: colors.inkSecondary, textAlign: 'center' }]}>
          Geramos o termo de adesão com os seus dados e abrimos a assinatura digital aqui mesmo. Você assina com o dedo, na tela.
        </Text>
        <Button label="Gerar e assinar contrato" icon="draw" onPress={gerarEAssinar} style={{ marginTop: 8, alignSelf: 'stretch' }} />
      </Card>
      <Erro texto={erro} />
    </Screen>
  );
}

function Concluida() {
  return (
    <Screen>
      <Card style={{ alignItems: 'center', paddingVertical: 28, gap: 10 }}>
        <Icon name="verified" size={44} color={colors.secondary} />
        <Text style={[type.headlineMd, { color: colors.onSurface, textAlign: 'center' }]}>Contrato assinado</Text>
        <Text style={[type.body, { color: colors.inkSecondary, textAlign: 'center' }]}>
          Sua adesão segue para ativação com a distribuidora. Acompanhe pela aba Energia.
        </Text>
        <Button label="Ir para Energia" icon="bolt" onPress={() => router.replace('/energia')} style={{ marginTop: 8, alignSelf: 'stretch' }} />
      </Card>
    </Screen>
  );
}
