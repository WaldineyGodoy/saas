import re
import sys

def main():
    with open('src/components/ConsumerUnitModal.jsx', 'r', encoding='utf8') as f:
        content = f.read()

    # Find the block for "Tipo de Unidade"
    # It starts with <div> then <label...>Tipo de Unidade</label>
    pattern = r"(<div>\s*<label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Tipo de Unidade</label>.*?fatura_consumo_terceiro === null && \(\s*<div.*?Obrigat\u00f3rio\.</div>\s*\)\}\s*</div>\s*\)\}\s*</div>)"

    match = re.search(pattern, content, flags=re.DOTALL)
    if not match:
        print("Could not find the Tipo de Unidade block")
        sys.exit(1)

    block_to_move = match.group(1)
    
    # Remove it from the original location
    content = content.replace(block_to_move, "")

    # Insert it before "Titular da Conta de Energia"
    target = "{/* Titular da Fatura Field */}"
    
    if target not in content:
        print("Could not find Titular da Fatura Field")
        sys.exit(1)
        
    replacement = block_to_move + "\n\n                                                  " + target
    content = content.replace(target, replacement)
    
    # Update logic for subscribersAndSuppliers filter:
    # If geradora -> search suppliers only
    # If beneficiaria -> search subscribers only
    
    # Current code:
    # const subscribersAndSuppliers = [...subscribers, ...suppliers.map(s => ({ ...s, isSupplier: true, cpf_cnpj: s.cnpj }))];
    old_list_def = "const subscribersAndSuppliers = [...subscribers, ...suppliers.map(s => ({ ...s, isSupplier: true, cpf_cnpj: s.cnpj }))];"
    new_list_def = """const subscribersAndSuppliers = formData.tipo_unidade === 'geradora' 
                                                            ? suppliers.map(s => ({ ...s, isSupplier: true, cpf_cnpj: s.cnpj })) 
                                                            : formData.tipo_unidade === 'beneficiaria'
                                                                ? subscribers
                                                                : [...subscribers, ...suppliers.map(s => ({ ...s, isSupplier: true, cpf_cnpj: s.cnpj }))];"""
    
    content = content.replace(old_list_def, new_list_def)

    with open('src/components/ConsumerUnitModal.jsx', 'w', encoding='utf8') as f:
        f.write(content)

    print("Success")

if __name__ == '__main__':
    main()
