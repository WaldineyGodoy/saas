import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    calcularCapacidade,
    ocupacaoDaGeracao,
    chaveMes,
    franquiaDoMes,
    semFranquiaContratada,
    temPerfilMensal,
    geracaoDoAno,
    geracaoEhSazonal,
    capacidadeMensal,
    piorMes,
    mesCorrente,
    resumoCapacidadeMensal,
    carregarGeracaoMensal,
    limparCacheGeracaoMensal,
    MESES,
} from './capacidade.js';

// UFV Bom Jesus I como estava no banco em 12/11/2026 (só leitura).
const BOM_JESUS = { geracao_estimada_kwh: '13558' };
const benef = (franquia, extra = {}) => ({ status: 'ativo', tipo_unidade: 'beneficiaria', franquia, ...extra });
const UCS_BOM_JESUS = [
    { status: 'ativo', tipo_unidade: 'geradora', franquia: 1 },
    benef(4500), benef(3100), benef(1400), benef(1100), benef(800), benef(1000),
    benef(600), benef(600), benef(900), benef(170), benef(100),
    benef(1), // B2W - Conta Saldo
];
// irradiancia de Bom Jesus/RN (cod.ibge 2401701), kWh/kWp jan..dez.
const IRR_BOM_JESUS = [137, 139, 144, 136, 125, 115, 118, 134, 141, 143, 145, 137];
const formaRpc = (geracao) => {
    const soma = IRR_BOM_JESUS.reduce((a, b) => a + b, 0);
    return Object.fromEntries(MESES.map((m, i) => [m, (geracao * 12 * IRR_BOM_JESUS[i]) / soma]));
};

test('chaveMes aceita número, texto e AAAA-MM', () => {
    assert.equal(chaveMes(1), '01');
    assert.equal(chaveMes('12'), '12');
    assert.equal(chaveMes('2026-07'), '07');
    assert.equal(chaveMes(13), null);
    assert.equal(chaveMes(''), null);
});

test('franquiaDoMes: perfil do mês, senão franquia', () => {
    const uc = benef(1000, { historico_consumo: { '01': { kwh: 980, ref: '2026-01', origem: 'cadastro' }, '02': { kwh: 0, origem: 'conta' } } });
    assert.equal(franquiaDoMes(uc, '01'), 980);
    assert.equal(franquiaDoMes(uc, 2), 0); // zero medido é dado, não ausência
    assert.equal(franquiaDoMes(uc, '03'), 1000);
    assert.equal(franquiaDoMes(benef(700), '05'), 700);
    assert.equal(franquiaDoMes({ franquia: null }, '05'), 0);
    assert.equal(temPerfilMensal(uc), true);
    assert.equal(temPerfilMensal(benef(700)), false);
});

test('Conta Saldo (franquia <= 1) ignora o perfil; UG não', () => {
    const saldo = benef(1, { historico_consumo: { '09': { kwh: 353 } } });
    assert.equal(semFranquiaContratada(saldo), true);
    assert.equal(franquiaDoMes(saldo, '09'), 1);
    assert.equal(temPerfilMensal(saldo), false);
    const ug = { tipo_unidade: 'geradora', franquia: 0, historico_consumo: { '09': { kwh: 120 } } };
    assert.equal(semFranquiaContratada(ug), false);
    assert.equal(franquiaDoMes(ug, '09'), 120);
});

test('geracaoDoAno: forma da RPC no nível da usina; sem RPC fica plana', () => {
    assert.equal(geracaoDoAno(null, null), null);
    const plana = geracaoDoAno(null, 1000);
    assert.deepEqual(MESES.map((m) => plana[m]), Array(12).fill(1000));
    const forma = formaRpc(13558);
    const ano = geracaoDoAno(forma, 13558);
    MESES.forEach((m) => assert.ok(Math.abs(ano[m] - forma[m]) < 1e-6));
    // geração editada no modal reescala a mesma forma
    const dobro = geracaoDoAno(forma, 27116);
    assert.ok(Math.abs(dobro['06'] - 2 * forma['06']) < 1e-6);
    // forma incompleta → plana
    assert.equal(geracaoDoAno({ '01': 10 }, 500)['07'], 500);
    assert.equal(geracaoEhSazonal(forma), true);
    assert.equal(geracaoEhSazonal(Object.fromEntries(MESES.map((m) => [m, 5]))), false);
    assert.equal(geracaoEhSazonal(null), false);
});

test('Bom Jesus I: perfil = 12 × franquia e geração plana batem com a leitura única', () => {
    const unica = calcularCapacidade({ ucs: UCS_BOM_JESUS, geracao: BOM_JESUS.geracao_estimada_kwh });
    const tela = ocupacaoDaGeracao(unica);
    assert.equal(unica.comprometido, 14271);
    assert.equal(unica.livre, -714);
    const linhas = capacidadeMensal(BOM_JESUS, UCS_BOM_JESUS, null);
    assert.equal(linhas.length, 12);
    for (const l of linhas) {
        assert.equal(l.geracao, 13558);
        assert.equal(l.consumoUG, unica.autoconsumoUG);
        assert.equal(l.ocupado, unica.comprometido);
        assert.equal(l.livre, unica.livre);
        assert.equal(l.excedente, 714);
        assert.equal(l.disponivel, 0);
        assert.ok(Math.abs(l.pct - tela.pct) < 1e-9);
        assert.equal(l.overbook, true);
    }
});

test('Bom Jesus I com a forma da irradiância: junho é o pior mês', () => {
    const r = resumoCapacidadeMensal(BOM_JESUS, UCS_BOM_JESUS, formaRpc(13558), new Date(2026, 10, 12));
    assert.equal(r.pior.mes, '06');
    assert.equal(Math.round(r.pior.geracao), 11592);
    assert.equal(Math.round(r.pior.excedente), 2680);
    assert.equal(r.corrente.mes, '11');
    assert.equal(r.corrente.overbook, false); // nov gera 14.616 > 14.272
    assert.equal(Math.round(r.corrente.disponivel), 344);
    assert.equal(r.temOverbook, true);
    assert.equal(r.geracaoSazonal, true);
    assert.equal(r.ucsComPerfil, 0);
    // soma do ano preservada
    const somaAno = r.linhas.reduce((a, l) => a + l.geracao, 0);
    assert.ok(Math.abs(somaAno - 13558 * 12) < 1e-6);
});

test('status que devolvem a franquia ficam fora também no mensal', () => {
    const ucs = [benef(500), benef(300, { status: 'cancelado_inadimplente' }), benef(200, { status: 'desligado_por_tt' })];
    const linhas = capacidadeMensal({ geracao_estimada_kwh: 1000 }, ucs, null);
    assert.equal(linhas[0].ocupado, 500);
    assert.equal(linhas[0].disponivel, 500);
});

test('sem geração: linhas sem livre, piorMes null', () => {
    const linhas = capacidadeMensal({ geracao_estimada_kwh: null }, [benef(100)], null);
    assert.equal(linhas[3].geracao, null);
    assert.equal(linhas[3].pct, null);
    assert.equal(linhas[3].overbook, false);
    assert.equal(piorMes(linhas), null);
    assert.equal(mesCorrente(linhas, new Date(2026, 0, 5)).mes, '01');
});

test('carregarGeracaoMensal degrada quando a RPC não existe', async () => {
    limparCacheGeracaoMensal();
    let chamadas = 0;
    const semRpc = { rpc: async () => { chamadas += 1; return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }; } };
    assert.equal(await carregarGeracaoMensal(semRpc, 'u1'), null);
    assert.equal(await carregarGeracaoMensal(semRpc, 'u2'), null);
    assert.equal(chamadas, 1); // marcou indisponível e não insistiu
    assert.equal(await carregarGeracaoMensal(null, 'u1'), null);
});
