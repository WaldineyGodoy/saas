# Indicação pelo app: link → loja → cadastro no app

Branch `app-v1.3` · 06/10/2026 · Status: **plano para aprovação**. Nada foi implementado.

## O que o dono pediu (05–06/10/2026)

- O link ou o QR Code de indicação leva a pessoa a **baixar o app** na Play Store ou na App Store.
- O indicado **se cadastra pelo app** e conclui a adesão dentro dele.
- Ao criar um login novo, quem ainda não tem nenhum produto (Energia ou Eletroposto) vê um pedido do link ou do QR de indicação. Há também um **botão pequeno, "não tenho link/QR Code"**.
- Regras de atribuição (já valem no banco desde 06/10/2026, migração `20261006b`):
  - vale o último link;
  - o contrato assinado trava a indicação;
  - indicador e originador são tratados juntos.

## O ponto técnico que define o desenho

A loja de aplicativos **apaga o link** no meio do caminho. Quem instala o app a partir de um link chega ao app sem saber de onde veio. Cada sistema trata isso de um jeito:

| | Android | iPhone |
|---|---|---|
| App ainda não instalado | A Play Store repassa um código ao app instalado (Install Referrer). O `expo-application` lê esse código com `getInstallReferrerAsync()`. **A indicação chega sozinha.** | A App Store **não repassa nada**. A pessoa lê o QR ou cola o link no app. O desenho do dono já resolve isso. |
| App já instalado | O link abre o app direto (App Links) | O link abre o app direto (Universal Links) |

O botão "não tenho link/QR Code" é importante também para a aprovação da Apple: ela recusa app que trava o cadastro exigindo um código de convite.

No iPhone há uma melhoria opcional. A página do link copia o código para a área de transferência antes de mandar para a loja, e no primeiro uso o app pergunta "Colar convite?". O iOS mostra um aviso de colar, então a sugestão é fazer isso numa versão depois.

## As peças

### 1. Página do link (o destino do link curto e do QR)
- Uma página leve, `…/i/<id do indicador>`, que identifica o aparelho:
  - **Android:** Play Store, com `&referrer=indicador%3D<id>`;
  - **iPhone:** App Store;
  - **computador:** os dois botões das lojas e o QR para ler com o celular, mais a opção de continuar pelo site (ver a decisão A).
- A mesma página serve de Universal Link e App Link. Para isso o domínio precisa publicar os arquivos `/.well-known/apple-app-site-association` e `/.well-known/assetlinks.json`.
- **Os links e QRs que já existem continuam valendo.** Basta trocar o destino dos links curtos no encurtador (YOURLS) para a página nova. Nenhum QR impresso precisa ser refeito.

### 2. App: criar conta
- A tela de entrada ganha **"Criar conta"**, com nome, celular, e-mail e senha.
- O e-mail é confirmado por **código de 6 dígitos**, no mesmo padrão do "esqueci minha senha", que já usa código e não link.
- Se o e-mail já pertence a um cadastro do CRM (assinante ou fornecedor), o login se liga a ele sozinho. O gatilho `handle_new_user` já faz isso hoje.

### 3. App: a pergunta da indicação
- Ela aparece quando o login **não tem nenhum produto**: não é assinante, nem fornecedor, nem dono de eletroposto.
- Se a indicação já chegou sozinha (Android, ou link aberto com o app instalado), a tela já vem preenchida: "**Você foi indicado por Maria.** Continuar". A pessoa pode trocar.
- Sem indicação, a tela tem três caminhos:
  - **[Ler QR Code]**, que reaproveita a câmera do `scan.tsx`;
  - **[Colar link]**;
  - um botão pequeno, *"não tenho link/QR Code"*.
- Uma função nova devolve **só o primeiro nome** de quem indicou, para confirmar na tela. Ela recusa quem não pode indicar e recusa a própria pessoa.

### 4. Banco: o lead do app
- `app_registrar_interesse(indicador, meio)` cria ou atualiza o lead pela mesma regra de `fn_registrar_lead_publico` (último link e trava após o contrato).
- Ela usa o **login** como identidade: o celular e o e-mail vêm da conta, não de um formulário. O lead fica ligado ao `user_id`, e isso fecha a brecha de alguém digitar o celular de outra pessoa.
- Cada leitura de QR ou link vira uma visita com `meio = 'qr'` ou `'app'`, e aparece na aba "Visitas e Indicações" do CRM.

### 5. App: a adesão
- São as mesmas etapas da adesão do site, em telas do app. Muita coisa já existe no app por causa da "Nova UC":
  1. ler a conta de energia (foto ou PDF);
  2. conferir;
  3. escolher o plano da distribuidora;
  4. dados de contato e vencimento;
  5. contrato no Autentique, assinado no próprio app.
- A criação do cadastro passa pela `fn_criar_assinante_publico` com o id da visita, então **a atribuição vale pela sessão que concluiu**. A regra de adesão refeita, que cancela o cadastro nunca assinado, também se aplica.
- Depois de assinar, o app mostra o andamento: "Contrato assinado → UC em ativação → primeira fatura".

### 6. Pré-requisitos que não são código
- **Contas de desenvolvedor Apple e Google**, que estão no roteiro do dono. Sem o app nas lojas, a página do link não tem para onde mandar. Até lá ela pode mandar para o site.
- **Domínio da página do link:** sugiro `app.b2wenergia.com.br`, que já é GitHub Pages ("B2W App da energia"). É preciso saber de qual repositório ele sai.

## Decisões do dono

- **A. Quem abre o link no computador**: continua pela simulação do site (o fluxo de hoje) ou só vê "baixe o app"? **Sugestão:** manter o site como alternativa. Muita gente recebe o link no WhatsApp Web.
- **B. Adesão no app**: telas nativas, como descrito (sugerido), ou o `/contrato` do site dentro do app, que é mais rápido mas tem uma experiência pior? E **a leitura da CNH** (o fluxo por documentos que está suspenso) entra agora ou fica para depois? **Sugestão:** nativo e com a conta de energia agora; a CNH quando o fluxo por documentos for retomado.
- **C. Domínio** da página do link (ver o item 6).
- **D. Eletroposto:** quem só usa a recarga, sem ser assinante de energia, também deve ver a pergunta da indicação ao conhecer a energia por assinatura? Ou a pergunta é só para o login totalmente novo, como foi dito ("login novo")? **Sugestão:** só o login novo, como o dono definiu.

## Ordem sugerida e estimativa

1. Banco: `app_registrar_interesse` e a função que confirma o indicador, com testes em lote desfeito (0,5 dia).
2. App: criar conta com código por e-mail, e a tela da indicação com QR, colar link e o Install Referrer (1,5 dia).
3. App: adesão nativa, reaproveitando as telas da Nova UC (2 dias).
4. Página do link e arquivos de Universal Link e App Link, com a troca do destino dos links curtos (1 dia). Essa parte só fica completa com o app publicado nas lojas.
5. Build de teste (APK) e roteiro de teste no Android e no iPhone pelo Expo Go (0,5 dia).

Total: cerca de **5 dias**. O que depende das lojas fica pronto e é ligado no dia da publicação.
