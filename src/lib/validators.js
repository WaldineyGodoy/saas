
// Helper to strip non-digits
export const cleanDigits = (value) => {
    return value ? value.replace(/\D/g, '') : '';
};

// Mask CPF/CNPJ
export const maskCpfCnpj = (value) => {
    const clean = cleanDigits(value);
    if (clean.length <= 11) {
        // CPF: 000.000.000-00
        return clean
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d{1,2})/, '$1-$2')
            .replace(/(-\d{2})\d+?$/, '$1');
    } else {
        // CNPJ: 00.000.000/0000-00
        return clean
            .replace(/(\d{2})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d)/, '$1/$2')
            .replace(/(\d{4})(\d)/, '$1-$2')
            .replace(/(-\d{2})\d+?$/, '$1');
    }
};

// Mask Phone: (xx) xxxxx-xxxx
export const maskPhone = (value) => {
    const clean = cleanDigits(value);
    return clean
        .replace(/(\d{2})(\d)/, '($1) $2')
        .replace(/(\d{5})(\d)/, '$1-$2')
        .replace(/(-\d{4})\d+?$/, '$1');
};

// Validate CPF (Modulo 11)
// Validate CPF (Modulo 11 - Ported from Java)
export const validateCpf = (cpf) => {
    const clean = cleanDigits(cpf);

    // Check if length is 11 or if all digits are equal
    if (clean.length !== 11 ||
        clean === "00000000000" || clean === "11111111111" ||
        clean === "22222222222" || clean === "33333333333" ||
        clean === "44444444444" || clean === "55555555555" ||
        clean === "66666666666" || clean === "77777777777" ||
        clean === "88888888888" || clean === "99999999999") {
        return false;
    }

    let dig10, dig11;
    let sm, i, r, num, peso;

    try {
        // 1st Verifier Digit Calculation
        sm = 0;
        peso = 10;
        for (i = 0; i < 9; i++) {
            num = parseInt(clean.charAt(i));
            sm = sm + (num * peso);
            peso = peso - 1;
        }

        r = 11 - (sm % 11);
        if ((r === 10) || (r === 11))
            dig10 = '0';
        else
            dig10 = String.fromCharCode(r + 48); // Converts to char

        // 2nd Verifier Digit Calculation
        sm = 0;
        peso = 11;
        for (i = 0; i < 10; i++) {
            num = parseInt(clean.charAt(i));
            sm = sm + (num * peso);
            peso = peso - 1;
        }

        r = 11 - (sm % 11);
        if ((r === 10) || (r === 11))
            dig11 = '0';
        else
            dig11 = String.fromCharCode(r + 48);

        // Verify if calculated digits match input
        if ((dig10 === clean.charAt(9)) && (dig11 === clean.charAt(10)))
            return true;
        else
            return false;

    } catch (error) {
        return false;
    }
};

// Validate CNPJ (Modulo 11)
export const validateCnpj = (cnpj) => {
    const clean = cleanDigits(cnpj);
    if (clean.length !== 14 || /^(\d)\1{13}$/.test(clean)) return false;

    let length = clean.length - 2
    let numbers = clean.substring(0, length);
    let digits = clean.substring(length);
    let sum = 0;
    let pos = length - 7;

    for (let i = length; i >= 1; i--) {
        sum += numbers.charAt(length - i) * pos--;
        if (pos < 2) pos = 9;
    }

    let result = sum % 11 < 2 ? 0 : 11 - sum % 11;
    if (result != digits.charAt(0)) return false;

    length = length + 1;
    numbers = clean.substring(0, length);
    sum = 0;
    pos = length - 7;

    for (let i = length; i >= 1; i--) {
        sum += numbers.charAt(length - i) * pos--;
        if (pos < 2) pos = 9;
    }

    result = sum % 11 < 2 ? 0 : 11 - sum % 11;
    if (result != digits.charAt(1)) return false;

    return true;
};

// Validate Phone (Must be DDD + 9 digits = 11 digits)
export const validatePhone = (phone) => {
    const clean = cleanDigits(phone);
    return clean.length === 11;
};

// Combined Validator
export const validateDocument = (val) => {
    const clean = cleanDigits(val);
    if (clean.length <= 11) return validateCpf(clean);
    return validateCnpj(clean);
};
