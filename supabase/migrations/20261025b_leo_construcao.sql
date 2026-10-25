-- Fonte "Construção — Perguntas e respostas" do Leo
-- (spec docs/superpowers/specs/2026-10-25-base-leo-construcao-design.md §5).
-- FAQ estatico: nao ha gatilho nem leitura de tabela, so a linha que a deskcomm-base atualiza.
insert into ponte_deskcomm.fontes_base (chave)
values ('construcao_faq')
on conflict (chave) do nothing;
