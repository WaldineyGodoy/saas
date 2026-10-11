import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Button, Card, Hero, Icon, Screen } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { confirmarIndicador, registrarInteresse, resolverLinkCurto } from '../lib/api';
import { celularBR, extrairIndicador, guardarIndicacaoPendente, lerIndicacaoPendente, limparIndicacaoPendente } from '../lib/indicacao';
import { guardarVisitaAdesao } from '../lib/adesao';
import { colors, radius, space, type } from '../theme/tokens';

type Meio = 'link' | 'qr' | 'app';
type Indicador = { id: string; nome: string; meio: Meio };

/**
 * Pergunta da indicação (decisão do dono, 05–06/10/2026): login novo, sem
 * nenhum produto, informa quem indicou lendo o QR ou colando o link. O botão
 * "não tenho link/QR Code" segue sem indicação (a Apple recusa app que
 * trava o cadastro exigindo convite).
 */
export default function Indicacao() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const meta = (session?.user?.user_metadata ?? {}) as { name?: string; phone?: string };
  const [indicador, setIndicador] = useState<Indicador | null>(null);
  const [camera, setCamera] = useState(false);
  const [perm, pedirPerm] = useCameraPermissions();
  const [link, setLink] = useState('');
  const [celular, setCelular] = useState(meta.phone ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const lido = useRef(false);

  // Indicação que chegou antes (link aberto, ou guardada no cadastro).
  useEffect(() => {
    lerIndicacaoPendente().then((p) => p && aplicar(p.id, p.meio));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const aplicar = async (id: string, meio: Meio) => {
    const r = await confirmarIndicador(id);
    if (!r?.valido || !r.id) {
      throw new Error(r?.motivo === 'proprio' ? 'Você não pode usar o seu próprio link.' : 'Este link de indicação não é válido.');
    }
    setIndicador({ id: r.id, nome: r.primeiro_nome || 'um assinante B2W', meio });
    await guardarIndicacaoPendente(r.id, meio);
  };

  const processar = async (raw: string, meio: Meio) => {
    setErro(null);
    setLendo(true);
    try {
      const leitura = extrairIndicador(raw);
      if (!leitura) throw new Error('Este QR Code ou link não é de indicação da B2W.');
      const id = 'id' in leitura ? leitura.id : await resolverLinkCurto(leitura.curto);
      await aplicar(id, meio);
      setCamera(false);
      setLink('');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setLendo(false);
      lido.current = false;
    }
  };

  const colar = async () => {
    const txt = await Clipboard.getStringAsync().catch(() => '');
    if (!txt) return setErro('Nada copiado. Copie o link que você recebeu e toque em colar.');
    setLink(txt);
    processar(txt, 'link');
  };

  const seguir = async (comIndicacao: boolean) => {
    setErro(null);
    const cel = celularBR(celular);
    if (!cel) return setErro('Informe seu celular com DDD para continuar.');
    setEnviando(true);
    try {
      const visita = await registrarInteresse(
        { name: meta.name || session?.user?.email || 'Cliente', phone: cel },
        comIndicacao ? indicador?.id ?? null : null,
        comIndicacao ? indicador?.meio ?? 'app' : 'app',
      );
      await limparIndicacaoPendente();
      await guardarVisitaAdesao(visita);
      await qc.invalidateQueries({ queryKey: ['perfil'] });
      router.replace('/adesao');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Screen>
      <Hero kicker="Bem-vindo à B2W" title="Você recebeu um convite?" subtitle="Quem indica a B2W ganha desconto na própria conta. Leia o QR Code ou cole o link que você recebeu." />

      {indicador ? (
        <Card style={{ gap: space.sm, borderColor: colors.secondary }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="volunteer-activism" color={colors.secondary} />
            <Text style={[type.headlineSm, { color: colors.onSurface, flex: 1 }]}>Você foi indicado por {indicador.nome}</Text>
          </View>
          <Button label={`Continuar com a indicação de ${indicador.nome}`} icon="arrow-forward" onPress={() => seguir(true)} loading={enviando} />
          <Button label="Trocar indicação" variant="ghost" onPress={() => { setIndicador(null); limparIndicacaoPendente(); }} />
        </Card>
      ) : (
        <>
          {camera && perm?.granted ? (
            <View style={{ height: 300, borderRadius: radius.xl, overflow: 'hidden', borderWidth: 2, borderColor: colors.primary }}>
              <CameraView
                style={{ flex: 1 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={({ data }) => {
                  if (lido.current) return;
                  lido.current = true;
                  processar(data, 'qr');
                }}
              />
            </View>
          ) : null}
          <Card style={{ gap: space.sm }}>
            <Button
              label={camera ? 'Fechar câmera' : 'Ler QR Code'}
              icon="qr-code-scanner"
              loading={lendo && camera}
              onPress={async () => {
                if (camera) return setCamera(false);
                if (!perm?.granted) {
                  const r = await pedirPerm();
                  if (!r.granted) return setErro('Sem a câmera, cole o link que você recebeu.');
                }
                setCamera(true);
              }}
            />
            <Button label="Colar link" icon="content-paste" variant="secondary" onPress={colar} disabled={lendo} />
            <TextInput
              value={link}
              onChangeText={setLink}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Ou digite/cole o link aqui"
              placeholderTextColor={colors.inkMuted}
              onSubmitEditing={() => link.trim() && processar(link, 'link')}
              style={[type.body, { height: 46, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.borderStrong, color: colors.onSurface, paddingHorizontal: 12 }]}
            />
            {link.trim() ? <Button label="Usar este link" variant="ghost" loading={lendo && !camera} onPress={() => processar(link, 'link')} /> : null}
          </Card>
        </>
      )}

      {!celularBR(meta.phone ?? '') ? (
        <Card style={{ gap: 6 }}>
          <Text style={[type.labelSm, { color: colors.onSurfaceVariant, textTransform: 'uppercase' }]}>Seu celular (WhatsApp)</Text>
          <TextInput
            value={celular}
            onChangeText={setCelular}
            keyboardType="phone-pad"
            placeholder="(84) 99999-9999"
            placeholderTextColor={colors.inkMuted}
            style={[type.body, { height: 46, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.borderStrong, color: colors.onSurface, paddingHorizontal: 12 }]}
          />
        </Card>
      ) : null}

      {erro ? <Text style={[type.bodySm, { color: colors.error }]}>{erro}</Text> : null}

      {!indicador ? (
        <Pressable onPress={() => seguir(false)} disabled={enviando} style={{ alignSelf: 'center', padding: 10 }} accessibilityRole="button">
          <Text style={[type.bodySm, { color: colors.inkMuted, textDecorationLine: 'underline' }]}>
            {enviando ? 'Aguarde…' : 'Não tenho link/QR Code'}
          </Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}
