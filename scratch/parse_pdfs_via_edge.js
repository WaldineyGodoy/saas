const invoices = [
    {id: "4f755b4d-6406-490f-9a20-c2829c1c48e3", url: "https://abbysvxnnhwvvzhftoms.supabase.co/storage/v1/object/public/energy-bills/invoices/7030004129/manual_1779845590954.pdf"},
    {id: "06ebf900-bd1b-497a-be6a-795456cdb976", url: "https://abbysvxnnhwvvzhftoms.supabase.co/storage/v1/object/public/energy-bills/invoices/7030004579/manual_1779820723183.pdf"},
    {id: "a71179e8-2bd0-448b-b204-14d67b35f30e", url: "https://abbysvxnnhwvvzhftoms.supabase.co/storage/v1/object/public/energy-bills/invoices/7030003955/manual_1777922921317.pdf"},
    {id: "0936493d-db6d-4165-b389-ec86c23975ab", url: "https://abbysvxnnhwvvzhftoms.supabase.co/storage/v1/object/public/energy-bills/invoices/7030004188/manual_1777923093711.pdf"},
    {id: "7f7330ac-4dde-4d1e-a22b-06acfde0d34d", url: "https://abbysvxnnhwvvzhftoms.supabase.co/storage/v1/object/public/energy-bills/invoices/7030004455/manual_1779798799561.pdf"},
    {id: "0167f372-d662-4ce4-8e3f-35ffb223de7f", url: "https://abbysvxnnhwvvzhftoms.supabase.co/storage/v1/object/public/energy-bills/invoices/7030043183/manual_1779736708763.pdf"},
    {id: "d06fb470-4dcd-4c8f-a934-6f70bfed4d86", url: "https://abbysvxnnhwvvzhftoms.supabase.co/storage/v1/object/public/energy-bills/invoices/7030004021/manual_1779572003981.pdf"},
    {id: "6e32caa3-8552-4530-9692-e61cd7abb8db", url: "https://abbysvxnnhwvvzhftoms.supabase.co/storage/v1/object/public/energy-bills/invoices/7030004366/manual_1779845624598.pdf"}
];

async function run() {
    console.log("Starting PDF extraction...");
    const updates = [];

    for (const inv of invoices) {
        try {
            console.log(`Downloading ${inv.url}...`);
            const res = await fetch(inv.url);
            if (!res.ok) {
                console.error(`Failed to download ${inv.url}`);
                continue;
            }
            const buffer = await res.arrayBuffer();
            const base64 = Buffer.from(buffer).toString("base64");

            console.log(`Parsing invoice ${inv.id}...`);
            const parseRes = await fetch("https://abbysvxnnhwvvzhftoms.supabase.co/functions/v1/parse-invoice", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pdfBase64: base64 })
            });

            if (!parseRes.ok) {
                console.error(`Failed to parse ${inv.id}: ${parseRes.statusText}`);
                continue;
            }

            const data = await parseRes.json();
            if (data.vencimento) {
                const dateStr = data.vencimento.split("T")[0];
                console.log(`Success: ${inv.id} -> ${dateStr}`);
                updates.push(`UPDATE invoices SET vencimento_concessionaria = '${dateStr}' WHERE id = '${inv.id}';`);
            } else {
                console.error(`No vencimento extracted for ${inv.id}`);
            }
        } catch (e) {
            console.error(`Error processing ${inv.id}:`, e);
        }
    }

    console.log("\n=== Generated SQL ===");
    console.log(updates.join("\n"));
}

run();
