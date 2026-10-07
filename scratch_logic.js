const uc = {
  desconto_assinante: "",
  planos_assinatura_energia: null
};

const result = uc.planos_assinatura_energia?.desconto_assinante ?? uc.desconto_assinante ?? 0;
console.log("Result:", result);
console.log("Type:", typeof result);
