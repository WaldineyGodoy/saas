import { cleanDigits, validatePhone } from './validators';

// Alertas do monitoramento dos inversores, configurados por usina
// (usinas.alertas_tipos / usinas.alertas_whatsapp). Os ids batem com os tipos
// que fn_monitor_avaliar_alertas dispara (migração 20261031b).
export const TIPOS_ALERTA = [
    { id: 'offline', titulo: 'Inversor offline', detalhe: 'Sem comunicar por 30 min ou mais entre 07h e 17h. Avisa também quando volta.' },
    { id: 'alarme', titulo: 'Alarme do inversor', detalhe: 'Falha registrada pela SAJ de nível importante ou urgente, e quando ela é encerrada.' },
    { id: 'geracao_zero', titulo: 'Geração zero ao meio-dia', detalhe: 'Inversor comunicando, mas sem gerar por 30 min entre 10h e 14h.' },
    { id: 'robo_parado', titulo: 'Monitoramento parado', detalhe: 'O robô ficou 40 min ou mais sem trazer dados das usinas.' }
];

/** SN como o banco guarda: maiúsculo, sem espaços. */
export const normalizarSn = (sn) => (sn || '').replace(/\s/g, '').toUpperCase();

/**
 * SN de datalogger (módulo de comunicação, aba Module do Elekeeper) começa com
 * M5. A API identifica o equipamento pelo SN do INVERSOR (deviceSn); o do
 * datalogger não acha nada. O banco também recusa (fn_usina_inversores_validar).
 */
export const ehSnDatalogger = (sn) => /^M5/.test(normalizarSn(sn));

/** Inversores que vão ao banco: normalizados, sem vazios nem repetição. */
export const inversoresParaGravar = (sns) =>
    [...new Set((sns || []).map(normalizarSn).filter(Boolean))];

/** O que vai ao banco: só números completos (DDD + celular), em dígitos, sem repetição. */
export const alertasParaGravar = (numeros) =>
    [...new Set((numeros || []).map(cleanDigits).filter(validatePhone))];
