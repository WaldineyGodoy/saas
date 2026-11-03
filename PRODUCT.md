# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primário — equipe interna da B2W Energia** (papéis `admin` e `super_admin`). Opera o ciclo de cobrança de geração distribuída: confere o que a concessionária lançou, apura a fatura do assinante, emite boleto, acompanha pagamento e persegue o que ficou para trás. Trabalha com dinheiro real em produção e precisa saber, de um assinante, o que está pago, o que está aberto e o que nunca foi faturado — por UC e por mês.

**Secundário — o assinante** (condomínios, empresas, pessoas físicas). Vê os próprios dados em tela separada, o "Meu Painel" (`src/pages/dashboards/SubscriberDashboard.jsx`), amarrado ao `user_id`. Confirmado em 03/11/2026: o dashboard interno **não** substitui essa tela.

## Product Purpose

CRM da B2W Energia para geração distribuída solar no Rio Grande do Norte, concessionária Neoenergia Cosern. Fecha o ciclo: lê a conta de energia no portal da concessionária, apura quanto o assinante deve, emite o boleto, entrega ao cliente e concilia o pagamento. Sucesso é cobrar o valor certo, da UC certa, no ciclo certo — e saber o que não foi cobrado.

## Positioning

O ciclo não é um botão: são cinco estágios com guarda própria em cada um. Robôs cuidam da parte repetitiva (faturista lê às 08:00 UTC, emissor emite às 10:00, enviador entrega às 11:00), mas cada estágio recusa avançar com dado que não fecha — o emissor só emite ciclo fechado, a auditoria barra fatura inconsistente, e dispensar uma UC do ciclo não extingue a cobrança dela. O valor de um painel aqui é mostrar onde o ciclo parou, não só o que já saiu.

## Operating Context

- **Fonte do dado:** portal da Cosern, raspado pelo robô faturista. Conta que a concessionária não postou simplesmente não existe no sistema — e isso é estado legítimo, não defeito.
- **Cobrança:** consolidada por assinante (`consolidated_invoices`, um boleto para várias UCs) ou individual por UC. O dia de vencimento do consolidado vem de `subscribers.consolidated_due_day`.
- **Asaas em produção.** Boleto emitido é cobrança real contra um cliente real.
- **Ciclo de referência e vencimento caem em meses diferentes.** Uma fatura de 07/2026 pode vencer em 08/09/2026.
- **Dispensa de ciclo** (`dispensas_ciclo`): UC sem conta disponível sai do ciclo com motivo registrado e volta retroativamente quando a conta aparecer.

## Capabilities and Constraints

- **Duas obrigações na mesma linha de `invoices`.** `status` + `valor_a_pagar` é a fatura do assinante (o que ele deve à B2W); `energy_bill_status` + `valor_concessionaria` é a conta de energia (o que a B2W deve à concessionária). Cancelar uma nunca extingue a outra. Confirmado em 03/11/2026: o dashboard interno mede a **fatura do assinante**.
- **Eixo temporal do relatório:** `mes_referencia` (ciclo de leitura), não `vencimento`. Confirmado em 03/11/2026.
- **`fatura_status`:** `ag_emissao_boleto`, `a_vencer`, `atrasado`, `pago`, `cancelado`, `erro`, `confirmado`, `sem_faturamento`, `cancelada`.
- **`sem_faturamento` é como o robô grava toda conta baixada.** Pode ter valor apurado e esperar boleto, ou estar em R$ 0,00 porque a leitura falhou. São estados diferentes com o mesmo rótulo.
- **Zero não é ausência.** `COALESCE` não trata zero, e o default de várias colunas numéricas é 0 — valor zerado já significou "tarifa não cadastrada" e "conta não apurada" em defeitos reais desta base.
- UC pode ser `nao_faturavel`; UC geradora não cobra do assinante.
- **Funções financeiras exigem sessão de administrador** (`requireAdmin` em `supabase/functions/_shared/auth.ts`). `verify_jwt` sozinho não protege: a chave anon é um JWT válido e viaja no bundle público.
- Terminologia: **UC** = unidade consumidora; **ciclo** = mês de referência; **consolidado** = um boleto para várias UCs do mesmo assinante; **repasse** = UC sem compensação, em que o assinante paga a conta inteira.

## Brand Commitments

- Nome: **B2W Energia**. CRM servido em `crm.b2wenergia.com.br` (GitHub Pages, repo público `saas`).
- Identidade incumbente em `src/index.css`: azul-marinho `#003366`, laranja `#FF6600`, tipografia Inter, cartões com `--radius-md` e `--shadow-sm`. Semânticos existentes: `--color-success` `#10b981`, `--color-warning` `#f59e0b`, `--color-error` `#ef4444`, cada um com par `-bg`.
- Não há token semântico azul: `--color-blue` é o azul-marinho da marca, usado em ação primária.

## Evidence on Hand

- **Base real em produção** (Supabase `abbysvxnnhwvvzhftoms`). Todo valor, status e UC sai do banco. Não há dado de exemplo a inventar, e inventar número aqui é o pior defeito possível nesta tela.
- Assinante de foco imediato: **GUANABARA AUTO DIESEL LTDA** ("Guarauto"), 8 UCs, cobrança consolidada, `consolidated_due_day = 8`.
- Caso real que a tela precisa tornar visível: a cobertura da Guarauto caiu de 8 UCs em 05/2026 para 4 em 06/2026 e 2 em 07/2026, e quatro UCs estão sem faturar desde maio — buraco de aproximadamente R$ 2.095 por mês que nenhuma tela atual mostra.

## Product Principles

1. **Número mostrado é número apurado.** Nenhuma célula exibe valor recalculado na tela ou derivado por palpite; se não foi apurado, a tela diz que não foi.
2. **Zero não é ausência, e ausência não é zero.** "Não faturado com R$ 0,00" e "não faturado com valor apurado" são estados distintos e precisam se distinguir à vista.
3. **O que não foi cobrado importa tanto quanto o que foi.** O painel existe para expor o buraco, não para exibir o que já deu certo.
4. **Fatura do assinante e conta de energia nunca se misturam** no mesmo número.
5. **Nada de cobrança por iniciativa própria.** A tela informa e navega; emitir e enviar são ações deliberadas de uma pessoa com sessão de administrador.

## Accessibility & Inclusion

O relatório de faturas codifica significado em cor por decisão do dono do produto (verde pago, amarelo aberto, azul não faturado, vermelho atrasado). Cor sozinha não pode carregar esse significado: cada estado precisa de um segundo canal — rótulo, forma ou padrão — legível por quem não distingue verde de vermelho, que é a confusão mais comum e exatamente o par de maior consequência aqui.
