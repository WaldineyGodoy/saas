# Playbook do Sistema (CRM & APP)

Bem-vindo à Base de Conhecimento oficial do sistema. Este diretório contém a documentação viva das funcionalidades, regras de negócio, gatilhos e identidade visual do CRM e do APP.

## Estrutura do Playbook

- **[CRM.md](./CRM.md)**: Documentação focada na gestão administrativa, operacional e back-office.
- **[APP.md](./APP.md)**: Documentação focada na experiência do cliente final, simulações e área do assinante.
- **[HISTORICO_ATUALIZACOES.md](./HISTORICO_ATUALIZACOES.md)**: Registro cronológico de todas as mudanças informadas.

---

## Política de Manutenção (Regras do IA)

Como Assistente de IA, minha função é manter esta base sempre atualizada seguindo estas diretrizes:

1. **Eliminação de Obsoletos**: Ao receber uma nova atualização, devo identificar se ela substitui uma regra anterior. Se sim, a regra antiga deve ser **apagada** do `CRM.md` ou `APP.md`.
2. **Registro de Gatilhos**: Todas as automações e eventos (Triggers) devem ser documentados com clareza (O que acontece? Quando acontece? Qual o resultado?).
3. **Fidelidade Visual**: Cores de status, ícones e simbologias devem ser registrados exatamente como implementados no código.
4. **Detecção de Conflitos**:
    - **Antes de atualizar**, comparo a nova informação com a base atual.
    - Se houver contradição (ex: conflito de cores ou gatilhos que se anulam), informo o usuário imediatamente.
    - A atualização só é feita após a resolução do conflito pelo usuário.

---

## Como Atualizar

Sempre que houver uma mudança no sistema, informe ao assistente:
> "Atualização no Playbook: [Descreva a mudança, novas cores, novos gatilhos, etc]"

O assistente cuidará do registro no histórico e da atualização dos manuais correspondentes.
