# Plano — Adesão começando pelos documentos (CNH/RG → assinante, conta → UC)

Status: **aprovado para implementar** (respostas abaixo). Nada implementado ainda.

## Decisões do dono (05/10/2026)

- Vale para **todo assinante novo**, na adesão do **site** (`/contrato`) e no **app**.
- Ordem: **CNH/RG** → cria o assinante · **conta de energia** → cria a UC · **contrato** → assinante
  assina · **equipe** faz a TT na concessionária quando o nome da conta é outro.
- A CNH/RG é **lida por IA** (mesma leitura da conta, via OpenRouter) e o cliente **confere e corrige**
  antes de criar o cadastro.
- TT: a equipe decide caso a caso para quem vai a titularidade; o sistema só **sinaliza** que há TT.
- Não se pede documento do titular atual da conta; a equipe resolve depois.
- UC nova com nome diferente: a UC é criada e o WhatsApp padrão sai para o assinante (já é assim).

## Hoje × proposto

| Hoje (`/contrato`) | Proposto |
|---|---|
| 1. Digita dados + UCs → `fn_criar_assinante_publico` cria tudo de uma vez | 1. Envia CNH/RG → lê → confere → **cria o assinante** (com WhatsApp e e-mail digitados) |
| 2. Sobe identidade e conta de cada UC (só arquivo) | 2. Envia a conta → lê → confere → **cria a UC** (repete para mais UCs) |
| 3. Contrato → Autentique | 3. Contrato → Autentique (igual) |
| | 4. Nome da conta ≠ assinante → UC marcada "TT pendente" para a equipe |

O arquivo da CNH e o da conta **já ficam registrados** como os documentos `identidade` e
`conta_energia` da adesão: o passo separado de documentos deixa de existir para quem entra pelo
fluxo novo.

## Peças

1. **Leitura da CNH/RG** — nova Edge Function `ler-documento-identidade` (ou um modo na leitura de
   conta): JSON com nome, CPF, data de nascimento, RG/órgão, filiação, validade. Só transcreve; CPF
   validado pelo dígito; o cliente confere. Mesmo cuidado de LGPD da conta: a imagem vai ao
   provedor do modelo só para a leitura e fica guardada no nosso Storage, como hoje.
2. **Banco** — dividir `fn_criar_assinante_publico` em duas etapas públicas por token:
   - `fn_adesao_criar_assinante(dados, aceite)` → assinante + `onboarding_token` (sem UC);
   - `fn_adesao_incluir_uc(token, conta_lida, plano)` → UC (mesmas validações de hoje: UC já
     cadastrada, ligação, desconto pelo plano/município); marca TT pendente se o nome diferir.
   - A função atual continua para o fluxo antigo até ele sair.
3. **Site `/contrato`** — passos novos: Identidade → Contato → Contas (1 ou mais) → Contrato.
   Reaproveita `PassoDocumentos` (upload por URL assinada) e o `ContratoAdesao`.
4. **App** — tela de cadastro de cliente novo (hoje o app só aceita quem já tem contrato):
   criar login → mesmos passos do site, chamando as mesmas funções. O e-mail do login é o mesmo do
   cadastro, então `handle_new_user` já liga login e assinante.
5. **CRM** — UC com "TT pendente" visível na lista de UCs e no assinante, para a equipe agir.

## Respostas do dono (05/10/2026)

1. **Pessoa jurídica:** lê a CNH do representante; **CNPJ e razão social digitados**.
2. **Endereço do assinante:** vem da **primeira conta lida**; o cliente pode trocar.
3. **Plano:** cliente novo **escolhe o plano** entre os ligados à distribuidora da UC (mesma regra do
   aditivo); o desconto é o do plano. Sem plano para a distribuidora, a UC não pode ser incluída.
4. **Fluxo antigo fica como alternativa** ("não estou com a CNH agora"): preenchimento manual e
   documentos depois, como hoje.

## Ordem sugerida

1. Leitura da CNH + funções do banco (com testes em transação desfeita).
2. Site `/contrato` no fluxo novo.
3. App: cadastro de cliente novo.
4. CRM: sinal de TT pendente.

Estimativa: 4 a 5 dias, depois das respostas acima.
