# Helena: condições comerciais, setup opcional e aceite

Data: 05/11/2026. Método: respostas do dono a partir da base da Gestora (`2026-10-25-base-helena-gestora-design.md`). Em produção a Helena foi de v16 para **v17**; este documento e o script usam "v8" por serem a segunda rodada de regras da Gestora.

## 1. O que o dono definiu

| Tema | Decisão |
|---|---|
| Plano de oferta | **Plano Usina – Ultra Connect** (ativo desde 05/11/2026): taxa de gestão 14%, desconto do assinante 15%, repasse dia 10, corte dia 5. Os planos Padrão e Recorrência Corretor passaram a "somente contratos". Os valores moram em Configurações > Planos e serviços. |
| Setup | **R$ 3.000,00, opcional.** A usina que paga tem prioridade na captação de assinantes: o valor financia campanhas de marketing e tráfego pago exclusivos para ela. Quem não paga fica em segunda prioridade. Os assinantes vão primeiro para a usina prioritária e o excedente da captação vai para a segunda. |
| Primeiro repasse | **120 dias.** Esse prazo é também a carência dos pagamentos ao dono. |
| Dados da usina | Constam do resumo da IA e do histórico do lead. |
| Gravar no negócio | Só depois que o fornecedor **aceita as condições comerciais**. |
| Depois do aceite | Pedir o cadastro de fornecedor; o fornecedor recebe o link do contrato para a adesão da usina. |
| Cadastro | **Automatizar** (projeto à parte). Até lá, a Helena passa para a equipe. |

## 2. Efeito na regra anterior

Na base da Gestora a Helena só citava taxa e desconto se o fornecedor perguntasse. O fluxo de aceite exige que ela **apresente** as condições, então a regra mudou: com os dados básicos da usina, apresenta o plano vigente e pergunta se o fornecedor aceita (sempre dizendo que o especialista confirma o caso dele).

## 3. Banco (`20261105a_gestora_setup_reais.sql`)
- `planos_usina.setup_reais` (≥ 0) substitui `setup_pct`, `setup_base` e `carencia_dias`, que nunca foram preenchidas (a migration aborta se tiverem dado).
- `prazo_primeiro_repasse_dias` passa a ser a carência.
- Ultra Connect: `setup_reais = 3000`, `prazo_primeiro_repasse_dias = 120`.
- `ponte_deskcomm_gestora_planos()` devolve `setup_reais` e `prazo_primeiro_repasse_dias` (só `service_role`).

## 4. Base e Helena
- FAQ da Gestora: a pergunta do setup passou a explicar que é opcional, a prioridade de captação e a segunda prioridade; o repasse cita a carência. Continua **sem nenhum número**.
- Documento "Gestora: planos vigentes": mostra o setup em reais com a regra de prioridade e o prazo como carência.
- Script `scripts/deskcomm/base_helena_v8.sql` (cirúrgico sobre a versão publicada): troca quatro trechos do bloco da v7 — apresenta as condições, setup opcional com prioridade, confirmação de cada dado em uma frase (alimenta resumo e histórico, que o Deskcomm já registra por turno em `crm_lead_activities` e `lead_checkpoints`), aceite → grava no negócio (`crm_update_lead`, `custom_fields`) os dados da usina, a opção de setup (`com_setup`/`sem_setup`) e o aceite, e passa para a equipe com o motivo `cadastro de fornecedor`. Não pede senha nem dados bancários.

## 5. O que o cadastro de fornecedor exige (e a Helena não colhe)
Pela rotina das telas do CRM: fornecedor (nome, CPF/CNPJ, telefone ou e-mail, originador, endereço completo, Pix), UCs (titular, concessionária, credenciais da conta) e usina (módulos, potência, inversor, modalidade GD1/GD2 e ACR/GC, portal com URL, login e senha). Os campos de login e senha são incompatíveis com a regra de não pedir senha: ficam com a equipe, em canal seguro. A automação precisa decidir o que a Helena colhe a mais e o que a equipe completa.

## 6. Pendências
- Projeto da automação do cadastro de fornecedor e do aviso de volta à Helena.
- Teste real: fornecedor que aceita, com e sem setup.
- Setup opcional ainda não tem forma de marcar no CRM qual usina é prioritária na captação; hoje só consta em `custom_fields`.
