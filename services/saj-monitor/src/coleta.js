/**
 * Um ciclo de coleta: lê da SAJ o estado de cada inversor, a geração de cada
 * usina e os alarmes das últimas 24 h, e monta o pacote que o banco grava.
 *
 * Quem decide o que entra em cada tabela é `fn_monitor_registrar` no Supabase.
 * Aqui só se traduz o formato da SAJ para o nosso, sem descartar nada: o JSON
 * cru de cada usina vai junto em `dados`, porque a unidade de alguns campos
 * (potência em W ou kW) só se confirma vendo a primeira resposta real.
 */

const FUSO = 'America/Fortaleza';

/** "yyyy-MM-dd HH:mm:ss" no horário das usinas (Nordeste, -03:00). */
export function dataHoraLocal(instante) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(instante).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/**
 * Converte a data que a SAJ devolve em ISO com fuso. Aceita epoch em ms ou
 * texto sem fuso, que é lido como horário local da usina.
 */
export function paraIso(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') return new Date(valor).toISOString();
  const t = String(valor).trim();
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(t)) return new Date(t).toISOString();
  const m = t.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
  if (!m) return null;
  return new Date(`${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}-03:00`).toISOString();
}

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

export async function coletar(saj, agora = new Date()) {
  const clientDate = dataHoraLocal(agora);
  const inicioAlarmes = dataHoraLocal(new Date(agora.getTime() - 24 * 3600 * 1000));
  const erros = [];

  const devs = await saj.dispositivos();
  const dispositivos = devs.map((d) => ({
    device_sn: d.deviceSn,
    modelo: d.deviceType ?? null,
    plant_id: d.plantId != null ? String(d.plantId) : null,
    plant_nome: d.plantName ?? null,
    online: d.isOnline === 1,
    alarme: d.isAlarm === 1,
  }));

  const nomes = new Map(dispositivos.map((d) => [d.plant_id, d.plant_nome]));
  const plantas = [];
  for (const plantId of nomes.keys()) {
    if (!plantId) continue;
    try {
      const e = await saj.estatisticas(plantId, clientDate);
      if (!e) continue;
      plantas.push({
        plant_id: plantId,
        nome: e.plantName ?? nomes.get(plantId),
        potencia_atual: num(e.powerNow),
        status_inversor: num(e.deviceStatus),
        energia_hoje_kwh: num(e.todayPvEnergy),
        energia_mes_kwh: num(e.monthPvEnergy),
        energia_ano_kwh: num(e.yearPvEnergy),
        energia_total_kwh: num(e.totalPvEnergy),
        dados_em: paraIso(e.updateDate ?? e.dataTime),
        dados: e,
      });
    } catch (err) {
      erros.push(`planta ${plantId}: ${err.message}`);
    }
  }

  let alarmes = [];
  try {
    alarmes = (await saj.alarmes(inicioAlarmes, clientDate)).map((a) => ({
      device_sn: a.deviceSn,
      codigo: a.alarmCode != null ? String(a.alarmCode) : null,
      nome: a.alarmName ?? null,
      nivel: num(a.alarmLevel),
      estado: num(a.status),
      inicio: paraIso(a.alarmTime),
    })).filter((a) => a.device_sn && a.codigo && a.inicio);
  } catch (err) {
    erros.push(`alarmes: ${err.message}`);
  }

  return { coletado_em: agora.toISOString(), dispositivos, plantas, alarmes, erros };
}
