const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function htmlEmailContrato(p: { nome: string; link: string; desconto: number | null; concessionaria: string }) {
  const desconto = p.desconto ? `<p style="margin:0 0 16px">Seu desconto: <strong>${esc(String(p.desconto))}%</strong> na energia compensada${p.concessionaria ? ` (${esc(p.concessionaria)})` : ''}.</p>` : '';
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#1e293b">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;padding:32px">
<tr><td>
<h1 style="margin:0 0 16px;color:#003366;font-size:22px">Falta só assinar, ${esc(p.nome)}</h1>
<p style="margin:0 0 16px">Sua adesão à B2W Energia foi registrada. O contrato é 100% digital e leva menos de 2 minutos.</p>
${desconto}
<p style="margin:24px 0;text-align:center"><a href="${esc(p.link)}" style="background:#FF6600;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold;display:inline-block">Assinar contrato</a></p>
<p style="margin:0;font-size:13px;color:#64748b">Se o botão não abrir, copie: ${esc(p.link)}</p>
</td></tr></table>
<p style="font-size:11px;color:#94a3b8">B2W Energia · atendimento@b2wenergia.com.br</p>
</td></tr></table></body></html>`;
}
