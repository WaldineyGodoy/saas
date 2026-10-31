# saj-monitor

Robô que lê os inversores SAJ das usinas pela Elekeeper Open Platform e grava no Supabase (`monitor_*`). A cada ciclo ele traz:

- o estado online/alarme de cada inversor;
- a potência e a energia do dia, do mês, do ano e o total de cada usina;
- os alarmes das últimas 24 h.

Os dados servem para acompanhar as usinas e para a tela do investidor. Eles **não** substituem o fechamento em `generation_production`.

## Onde roda

Roda na VPS Contabo, no EasyPanel: projeto `b2w`, serviço `saj-monitor`, origem Git deste repositório com build path `services/saj-monitor`. A SAJ só aceita chamadas dos IPs da whitelist do app `B2W Monitoramento`, que hoje são `173.212.215.231` e `173.212.213.250`.

## Variáveis de ambiente

| Variável | De onde vem |
|---|---|
| `SAJ_APP_ID` | `VH_eQN5ylXQ` |
| `SAJ_APP_SECRET` | developer portal → App Configuration → Development Configuration |
| `SUPABASE_URL` | `https://abbysvxnnhwvvzhftoms.supabase.co` |
| `SUPABASE_ANON_KEY` | chave anon pública do projeto |
| `MONITOR_TOKEN` | `select decrypted_secret from vault.decrypted_secrets where name = 'monitor:saj_token';` |
| `INTERVALO_MIN` | opcional, padrão 10 (mínimo 5) |

## Teste e diagnóstico

```bash
npm test
```

```bash
node src/main.js --uma-vez
```

Cada ciclo grava uma linha em `robo_execucoes` com `robo = 'monitor-saj'`, inclusive quando a SAJ falha. Para conferir:

```sql
select * from fn_saude_robos() where robo = 'monitor-saj';
```

Códigos da SAJ que aparecem no log:

| Código | Significado |
|---|---|
| `200014` | o app ainda não foi publicado |
| `200006` | o inversor não está autorizado no Elekeeper |
| `401` | o IP não está na whitelist |
