# Indicação pelo app: link → loja → cadastro no app

Branch `app-v1.3` · 06/10/2026 · Status: **aprovado em 06/10/2026**. Etapa 1 (banco) pronta e testada, mas ainda não aplicada em produção.

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

## Decisões do dono (06/10/2026)

- **A.** No computador, o site continua como alternativa.
- **B.** A adesão terá **telas próprias do app**. A CNH fica **para depois**.
- **C.** Domínio novo: **`apps.b2wenergia.com.br`**, com o webapp e a rota `/i/<código>`.
  - O `app.b2wenergia.com.br`, que é o portal web de assinante, originador e fornecedor publicado do repositório `WaldineyGodoy/app`, **não muda**.
  - Os logins web continuam como estão.
- **D.** A pergunta da indicação aparece só para **login novo**: sem assinante, sem fornecedor, sem parceiro e com papel `lead`.
- **E.** Enquanto as lojas não existem, o app vai ao ar como **webapp** no `apps.b2wenergia.com.br`.
  - No navegador o código de indicação vai na própria URL e não se perde, nem no iPhone.
  - Quando as lojas estiverem prontas, o mesmo link passa a abrir o app nativo.

## Etapa 1, banco (`20261006d_app_cadastro_indicacao.sql`)

Antes de abrir o cadastro pelo próprio usuário, duas correções:
- **Segurança:** `handle_new_user` ligava o **originador pelo e-mail antes da confirmação**. Com o cadastro aberto, qualquer pessoa poderia criar um login com o e-mail de um parceiro e trocar o id dele, levando a carteira junto. Agora o originador só é ligado com o e-mail confirmado, como já acontecia com assinante e fornecedor.
- **Troca de id do originador:** quem aponta para `originators_v2` passou a acompanhar a troca (ON UPDATE CASCADE): `lead_visitas`, `eletropostos`, o histórico de cargo e `lider_id`. Sem isso, o primeiro login de um parceiro que já tivesse visitas registradas falharia.

O que entra:
- **`leads.user_id`:** o lead do app fica ligado ao login.
- **`fn_indicador_publico`:** devolve só o primeiro nome de quem indicou. Recusa quem não pode indicar e recusa a própria pessoa.
- **`app_registrar_interesse`:**
  - exige e-mail confirmado;
  - recusa quem já é assinante;
  - usa a mesma trava e a mesma regra de último link do site;
  - o e-mail usado é sempre o da conta.
- **`app_perfil`:** ganha `sem_produto` e o lead em andamento, com o nome de quem indicou.
- **Papel do login:** sobe de `lead` para assinante quando o contrato é assinado, pelo webhook. A proteção de papel em `profiles` continua barrando qualquer troca feita na sessão do próprio usuário. O teste 8 confere isso.

Testes: `supabase/tests/app_cadastro_indicacao.test.sql`, rodado em lote desfeito (`SANDBOX_OK`).
