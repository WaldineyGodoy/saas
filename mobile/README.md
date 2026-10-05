# B2W Energia — App mobile (iOS e Android)

App do cliente B2W, feito em **Expo (React Native) + TypeScript + Expo Router**, lendo o mesmo
Supabase do CRM. Layout fiel ao projeto Stitch `2359134248600550624` ("B2W Energia Mobile App",
design system *Helios Sovereign*). As telas originais exportadas estão em `../mobile-design/stitch/`.

| Tela do Stitch | Rota no app |
|---|---|
| Tela de Início | `src/app/(tabs)/index.tsx` |
| Tela Energia – UCs | `src/app/(tabs)/energia.tsx` |
| Tela Energia – Detalhamento das UCs | `src/app/energia/[ucId].tsx` |
| Tela da usina | `src/app/(tabs)/invest.tsx` |
| Tela da usina – Detalhamento | `src/app/invest/[usinaId].tsx` |
| Tela Home Connect | `src/app/connect/home.tsx` |
| Tela Drive Connect | `src/app/connect/drive.tsx` |
| Tela do Eletroposto | `src/app/(tabs)/eletroposto.tsx` + `src/app/scan.tsx` |
| (sem tela no Stitch) Nova UC pela conta de luz | `src/app/energia/nova-uc.tsx` |

## Acesso aos dados: só pelas funções `app_*`

O app **não lê tabelas direto**. As policies atuais de `subscribers`, `consumer_units`, `usinas`,
`invoices` e `generation_production` liberam a base inteira para qualquer usuário autenticado —
aceitável no CRM (só equipe interna), inaceitável num app aberto ao cliente. Toda leitura passa
pelas funções `app_*` de `supabase/migrations/20261004a_app_mobile_rpcs.sql` (já aplicada em produção), que filtram por
`auth.uid()`. Se ela faltar num banco novo, as telas mostram "Servidor ainda não preparado".

Vínculo login → dados: **só** `subscribers.user_id` (assinante) e `suppliers.user_id` (investidor/usinas e
cotas de eletroposto). O gatilho `handle_new_user` preenche isso pelo e-mail no cadastro. `profile_id` não
é usado: já apareceu apontando para perfil da equipe, o que exporia dados do cliente.

## Rodando

```bash
cd mobile
cp .env.example .env        # preencha EXPO_PUBLIC_SUPABASE_ANON_KEY
npm install
npx expo start              # abre no Expo Go (iOS/Android) ou emulador
```

Modo demonstração, com os dados de exemplo do Stitch e sem login:

```bash
EXPO_PUBLIC_DEMO=1 npx expo start
```

## Qualidade

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # expo lint
npm test            # vitest (formatação, QR de recarga, agrupamento da rede)
```

## Publicando nas lojas (EAS)

```bash
npx eas-cli@latest login
npx eas-cli@latest build --platform all --profile production
npx eas-cli@latest submit --platform ios      # App Store Connect
npx eas-cli@latest submit --platform android  # Google Play
```

Identificadores: `br.com.b2wenergia.app` (iOS e Android). Defina as variáveis `EXPO_PUBLIC_*`
como *EAS environment variables* para os builds de nuvem.

## Nova UC pela conta de luz

O assinante fotografa a conta (ou envia o PDF) em `energia/nova-uc`. A leitura é feita na Edge
Function `parse-invoice-image` (a mesma do CRM, que aceita foto e PDF) e o pedido vai por
`app_solicitar_nova_uc` (migration `20261004h_pedido_nova_uc.sql`): vira um **lead** com a conta lida,
marcado com o assinante. **Não cria UC** — a equipe vê a UC preenchida na aba "Conta de Energia" do
lead, e a UC só nasce depois do termo assinado. Pedido repetido para a mesma UC não duplica; UC que já
é do assinante é recusada.

## Pagamentos

- **Fatura de energia**: PIX copia-e-cola, código de barras e PDF vindos de `invoices`
  (`pix_string`, `linha_digitavel`, `asaas_*`).
- **Recarga no eletroposto**: o app lê o QR do carregador
  (`https://crm.b2wenergia.com.br/recarga?posto=<id>&conector=<n>`) e abre o checkout Stripe já
  existente do CRM no navegador interno. Não há SDK de pagamento nativo no app.

## Ainda não implementado (sem backend hoje)

- Carteira/saldo pré-pago do motorista e mapa ao vivo dos hubs (tela do Eletroposto no Stitch).
- "Solicitar resgate de receita" da usina e relatório de telemetria do inversor em PDF.
- Rede de *motoristas* indicados no Drive Connect (não há tabela de indicação de motorista);
  o app mostra o link de indicação e os eletropostos em que o usuário tem cota.
- Termo aditivo para o assinante assinar a UC nova pedida pelo app (o pedido chega à equipe, mas a
  UC só pode ser criada depois da assinatura).
- Notificações push.
