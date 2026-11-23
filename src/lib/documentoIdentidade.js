/**
 * Leitura de documento de identificação (CNH/RG) no cadastro do assinante.
 *
 * Mesmo desenho da leitura da conta de energia na UC: a equipe envia a foto ou
 * o PDF, a Edge Function `ler-documento-identidade` transcreve nome, CPF e data
 * de nascimento, e o MODAL preenche o formulário para a pessoa conferir. Nada é
 * gravado por aqui; o arquivo segue com o modal e é anexado quando o assinante
 * for salvo. A chamada à função fica em `documentoIdentidadeLeitura.js`, para estas
 * regras rodarem em teste sem o cliente do Supabase.
 *
 * A regra que mais importa está em `aplicarLeituraIdentidade`: o documento
 * NUNCA sobrescreve o que a equipe já digitou, e documento de outra pessoa (CPF
 * diferente do digitado) não preenche nada. Misturar dados de duas pessoas num
 * cadastro vira contrato com o nome de um e o CPF de outro.
 */
import { validateCpf, maskCpfCnpj } from './validators';

const digitos = (v) => String(v ?? '').replace(/\D/g, '');
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '');
const chaveNome = (s) => semAcento(s).toLowerCase().replace(/\s+/g, ' ').trim();
const cpfFormatado = (d) => maskCpfCnpj(digitos(d));
const dataBr = (iso) => String(iso || '').split('-').reverse().join('/');

/**
 * O que a leitura muda no formulário.
 *
 * `form`: campos atuais (cpf_cnpj, name, data_nascimento, representante_nome,
 *   representante_cpf).
 * `leitura`: resposta de `ler-documento-identidade` (cpf só vem se passou na
 *   validação dos dígitos; `cpfLido` é o número como o modelo leu).
 *
 * Devolve `{ patch, avisos, cpfAplicado, anexar }`. `anexar` é false quando o
 * documento não serve a este cadastro (outra pessoa, ou nada legível): o arquivo
 * não deve ser anexado ao assinante. `cpfAplicado` (só dígitos) é o CPF que
 * ENTROU no campo, para o modal não gastar a consulta paga de CPF só porque a
 * pessoa clicou no campo depois.
 */
export function aplicarLeituraIdentidade(form, leitura) {
    const f = form || {};
    const l = leitura || {};
    const patch = {};
    const avisos = [];
    const nome = String(l.nome || '').trim();
    const cpf = l.cpf && validateCpf(l.cpf) ? digitos(l.cpf) : '';
    const cpfLido = digitos(l.cpfLido);
    const nascimento = l.nascimento || '';

    if (!nome && !cpf && !cpfLido && !nascimento) {
        return { patch, avisos: ['Não consegui ler nome, CPF nem data de nascimento neste documento. Tire outra foto, com o documento inteiro e sem reflexo, ou digite os dados.'], cpfAplicado: null, anexar: false };
    }

    // CPF lido que nao passou na validacao dos digitos: nunca entra no campo.
    const avisoCpf = () => {
        if (cpf) return;
        if (cpfLido) avisos.push(`Li o CPF ${cpfFormatado(cpfLido)}, mas ele não passou na validação (foto borrada ou cortada?). Digite o CPF à mão.`);
        else avisos.push('Não encontrei CPF neste documento. Digite o CPF à mão.');
    };

    // ---- Pessoa juridica: o documento e do representante legal ----
    if (digitos(f.cpf_cnpj).length === 14) {
        const repCpf = digitos(f.representante_cpf);
        const repNome = String(f.representante_nome || '').trim();
        let outraPessoa = false;
        if (repCpf.length === 11 && cpf) outraPessoa = repCpf !== cpf;
        else if (repNome && nome) outraPessoa = chaveNome(repNome) !== chaveNome(nome);

        if (outraPessoa) {
            avisos.push(`O documento é de ${nome || 'outra pessoa'}, mas o representante legal do cadastro é ${repNome || cpfFormatado(repCpf)}. Nada foi alterado.`);
            return { patch, avisos, cpfAplicado: null, anexar: false };
        }
        if (nome && !repNome) patch.representante_nome = nome;
        if (cpf && repCpf.length !== 11) patch.representante_cpf = cpfFormatado(cpf);
        avisoCpf();
        return { patch, avisos, cpfAplicado: null, anexar: true };
    }

    // ---- Pessoa fisica ----
    const cpfDigitado = digitos(f.cpf_cnpj);
    const cpfDigitadoCompleto = cpfDigitado.length === 11;

    if (cpf && cpfDigitadoCompleto && cpf !== cpfDigitado) {
        avisos.push(`O CPF do documento (${cpfFormatado(cpf)}) é diferente do CPF digitado (${cpfFormatado(cpfDigitado)}). Nada foi preenchido: confira se o documento é da pessoa certa.`);
        return { patch, avisos, cpfAplicado: null, anexar: false };
    }

    let cpfAplicado = null;
    if (cpf && !cpfDigitadoCompleto) {
        patch.cpf_cnpj = cpfFormatado(cpf);
        cpfAplicado = cpf;
    }
    avisoCpf();

    const nomeAtual = String(f.name || '').trim();
    if (nome) {
        if (!nomeAtual) patch.name = nome;
        else if (chaveNome(nomeAtual) !== chaveNome(nome)) avisos.push(`O nome no documento (${nome}) é diferente do nome do cadastro. Confira.`);
    }
    if (nascimento) {
        if (!f.data_nascimento) patch.data_nascimento = nascimento;
        else if (f.data_nascimento !== nascimento) avisos.push(`A data de nascimento no documento (${dataBr(nascimento)}) é diferente da do cadastro. Confira.`);
    }

    return { patch, avisos, cpfAplicado, anexar: true };
}
