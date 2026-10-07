# Ficha das lojas — B2W Energia (v1.0.0)

Textos prontos para colar no **App Store Connect** e no **Google Play Console**.
Limites de caracteres de cada campo indicados entre parênteses.

## Identificação

| Campo | Valor |
|---|---|
| Nome do app (30) | B2W Energia |
| Pacote / Bundle ID | `br.com.b2wenergia.app` (iOS e Android) |
| Categoria principal | **Utilidades** (Apple) · **Ferramentas** (Google) |
| Categoria secundária (Apple) | Finanças |
| Classificação etária | 4+ (Apple) · Livre (Google, questionário IARC: sem violência, sem conteúdo adulto, sem compras dentro do app) |
| Idioma principal | Português (Brasil) |
| Preço | Gratuito, sem compras dentro do app, sem anúncios |
| Política de privacidade | https://b2wenergia.com.br/politica-de-privacidade/ |
| Site / URL de marketing | https://b2wenergia.com.br |
| URL / e-mail de suporte | https://b2wenergia.com.br · contato@b2wenergia.com.br |


## Textos

**Subtítulo — Apple (30)**
> Energia por assinatura

**Descrição curta — Google (80)**
> Acompanhe suas contas de energia, economia, usinas e indicações da B2W Energia.

**Texto promocional — Apple (170)**
> Veja suas faturas com PIX e código de barras, acompanhe a economia de cada unidade consumidora e a geração das suas usinas, tudo em um só lugar.

**Descrição completa (4000)**
> O app da B2W Energia reúne em um só lugar tudo o que você tem com a gente.
>
> ENERGIA POR ASSINATURA
> • Suas unidades consumidoras (UCs) com consumo, energia compensada e economia de cada mês.
> • Faturas com PIX copia e cola, código de barras e PDF para pagar em segundos.
> • Histórico das últimas contas para acompanhar a sua economia.
> • Inclua um imóvel novo fotografando a conta de luz: lemos os dados, você escolhe o plano e assina o termo pelo próprio app.
>
> PARA QUEM INVESTE EM USINAS
> • Acompanhe a geração mensal de cada usina, o faturamento, as despesas e o saldo a receber.
>
> CONECTE E GANHE
> • Compartilhe seu link de indicação e acompanhe sua rede de indicados e o cashback.
>
> ELETROPOSTOS
> • Encontre os eletropostos B2W, leia o QR Code do carregador e acompanhe suas recargas.
>
> O app é para clientes B2W Energia: entre com o mesmo e-mail do seu contrato. Ainda não é cliente? Faça sua simulação em b2wenergia.com.br.

**Palavras-chave — Apple (100, separadas por vírgula, sem espaço)**
> energia solar,conta de luz,economia,assinatura,usina,geração distribuída,eletroposto,cashback

**Novidades desta versão (4000)**
> Primeira versão do app B2W Energia.

## Privacidade — Apple (App Privacy)

Rastreamento (tracking): **Não**. Sem SDK de anúncios ou analytics.

| Tipo de dado | Coletado? | Vinculado ao usuário | Finalidade |
|---|---|---|---|
| Nome | Sim | Sim | Funcionalidade do app |
| E-mail | Sim | Sim | Funcionalidade do app (login) |
| Telefone | Sim | Sim | Funcionalidade do app (cadastro do contrato) |
| Endereço físico | Sim | Sim | Funcionalidade do app (endereço da UC) |
| Outras informações financeiras | Sim | Sim | Funcionalidade do app (faturas e valores) |
| Fotos | Sim | Sim | Funcionalidade do app (foto da conta de luz, só quando o usuário envia) |
| ID do usuário | Sim | Sim | Funcionalidade do app |
| Dados de diagnóstico / uso | **Não** | — | — |
| Localização | **Não** | — | — |

## Segurança dos dados — Google (Data safety)

- O app coleta ou compartilha dados? **Coleta: sim. Compartilha: não.**
  (A foto da conta é processada por um provedor de IA que trabalha em nome da B2W; pela regra do
  Google isso é *prestador de serviço*, não compartilhamento.)
- Dados criptografados em trânsito: **Sim** (HTTPS).
- O usuário pode pedir exclusão: **Sim** — botão **Mais → Excluir conta** no app.
- Tipos coletados (todos obrigatórios para o funcionamento, nenhum para publicidade):
  Informações pessoais (nome, e-mail, telefone, endereço, ID do usuário) · Informações financeiras
  (histórico de faturas) · Fotos (opcional, só ao enviar a conta de luz).
- URL de exclusão de conta (campo obrigatório no Play): use a política de privacidade ou uma
  página com o passo a passo "Mais → Excluir conta" (ver pendências).

## Informações para a revisão (Apple "App Review Information" / Google "Acesso ao app")

- **Login obrigatório.** Conta de demonstração: _a ser criada pelo dono_ (assinante de teste com UC
  e faturas). Informar e-mail e senha nos dois consoles.
- Notas para o revisor (colar):
  > O app é exclusivo para clientes da B2W Energia, que assinam o contrato pelo site. Use a conta
  > de demonstração informada. A exclusão de conta fica em Mais → Excluir conta. Pagamentos de
  > faturas de energia e de recargas em eletropostos são serviços do mundo físico, feitos por PIX,
  > boleto ou checkout web, fora do app.

## Imagens (a produzir na fase de testes)

| Loja | Formato | Quantidade |
|---|---|---|
| Apple | Capturas iPhone 6,9" (1320 × 2868) — vale para todos os iPhones | 3 a 10 |
| Google | Capturas de celular (mín. 1080 px no lado menor) | 2 a 8 |
| Google | Imagem de destaque 1024 × 500 | 1 |
| Ambas | Ícone (já em `assets/icon.png`) | — |

Telas sugeridas: Início · Energia (UCs) · Detalhe da UC com fatura · Usina · Home Connect.

## Pendências do dono para publicar

1. Contas de desenvolvedor Apple e Google (no roadmap).
2. Conta de demonstração para a revisão.
3. Página (ou seção da política) explicando como excluir a conta — o Google pede uma URL.
4. Capturas de tela (na fase de testes, com a conta de demonstração).
