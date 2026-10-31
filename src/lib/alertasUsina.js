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

/** O que vai ao banco: só números completos (DDD + celular), em dígitos, sem repetição. */
export const alertasParaGravar = (numeros) =>
    [...new Set((numeros || []).map(cleanDigits).filter(validatePhone))];
