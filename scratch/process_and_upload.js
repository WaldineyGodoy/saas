import fs from 'fs';
import path from 'path';
import { PDFDocument, rgb } from 'pdf-lib';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://abbysvxnnhwvvzhftoms.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiYnlzdnhubmh3dnZ6aGZ0b21zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2NTcwNzcsImV4cCI6MjA4NDIzMzA3N30.omP9h4ZqFbDX4FMO_lkd5Q3Iv99xgbs5bVz6beIpqfo';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    try {
        console.log("Iniciando processamento da conta de energia...");

        // Caminhos possíveis devido à codificação do terminal
        const paths = [
            "C:\\Users\\Godoy\\Documents\\MEGA\\Associação B2W Energia\\Faturas\\Abril\\7029990055 - Brigitte Caturano - R$ 827.pdf",
            "C:\\Users\\Godoy\\Documents\\MEGA\\Associaço B2W Energia\\Faturas\\Abril\\7029990055 - Brigitte Caturano - R$ 827.pdf"
        ];

        let filePath = "";
        for (const p of paths) {
            if (fs.existsSync(p)) {
                filePath = p;
                break;
            }
        }

        if (!filePath) {
            // Tentar readdir se os caminhos estáticos falharem
            const megaDir = "C:\\Users\\Godoy\\Documents\\MEGA";
            if (fs.existsSync(megaDir)) {
                const subdirs = fs.readdirSync(megaDir);
                const targetDirName = subdirs.find(s => s.toLowerCase().includes("b2w"));
                if (targetDirName) {
                    const faturasDir = path.join(megaDir, targetDirName, "Faturas", "Abril");
                    if (fs.existsSync(faturasDir)) {
                        const files = fs.readdirSync(faturasDir);
                        const targetFile = files.find(f => f.includes("7029990055") && f.includes("827"));
                        if (targetFile) {
                            filePath = path.join(faturasDir, targetFile);
                        }
                    }
                }
            }
        }

        if (!filePath) {
            throw new Error("Arquivo PDF de R$ 827,20 não encontrado no computador.");
        }

        console.log(`Arquivo localizado com sucesso em: ${filePath}`);

        // Ler arquivo original
        const fileBuffer = fs.readFileSync(filePath);
        const pdfDoc = await PDFDocument.load(fileBuffer);
        
        // Criar novo documento e manter apenas a primeira página (ou todas se for página única)
        const trimmedDoc = await PDFDocument.create();
        const [firstPage] = await trimmedDoc.copyPages(pdfDoc, [0]);
        trimmedDoc.addPage(firstPage);

        // Adicionar carimbo "NÃO PAGUE ESSA CONTA"
        const font = await trimmedDoc.embedFont('Helvetica-Bold');
        const fontSize = 14;
        const stampText = "NÃO PAGUE ESSA CONTA - VIA DE CONFERÊNCIA";
        const textWidth = font.widthOfTextAtSize(stampText, fontSize);
        
        const firstPageRef = trimmedDoc.getPages()[0];
        const { width, height } = firstPageRef.getSize();

        const stampX = 40;
        const stampY = height - 80;

        // Desenhar retângulo de fundo
        firstPageRef.drawRectangle({
            x: stampX - 2,
            y: stampY - 3,
            width: textWidth + 10,
            height: fontSize + 8,
            color: rgb(1, 0.9, 0.9), // vermelho bem claro
            borderColor: rgb(0.9, 0.1, 0.1),
            borderWidth: 2,
        });

        // Desenhar texto em vermelho
        firstPageRef.drawText(stampText, {
            x: stampX + 3,
            y: stampY + 1,
            size: fontSize,
            font: font,
            color: rgb(0.9, 0.1, 0.1)
        });

        const stampedBytes = await trimmedDoc.save();
        console.log("PDF recortado e carimbado com sucesso localmente.");

        // Upload para o Supabase Storage
        const storagePath = `invoices/7029990055/manual_${Date.now()}.pdf`;
        console.log(`Fazendo upload do PDF para o bucket energy-bills: ${storagePath}`);

        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('energy-bills')
            .upload(storagePath, stampedBytes, {
                contentType: 'application/pdf',
                upsert: true
            });

        if (uploadError) {
            throw uploadError;
        }

        console.log("Upload concluído com sucesso!");

        // Obter URL pública
        const { data: { publicUrl } } = supabase.storage
            .from('energy-bills')
            .getPublicUrl(storagePath);

        console.log(`URL pública do PDF da Concessionária: ${publicUrl}`);

        // Atualizar a fatura no banco de dados
        const invoiceId = 'e56b8467-2435-497d-a420-a47d7153b0a2';
        console.log(`Atualizando fatura ID ${invoiceId} no banco de dados...`);

        const { error: dbError } = await supabase
            .from('invoices')
            .update({
                concessionaria_pdf_url: publicUrl,
                asaas_pdf_storage_url: null // reset do cache do PDF consolidado para forçar regeneração
            })
            .eq('id', invoiceId);

        if (dbError) {
            throw dbError;
        }

        console.log("Fatura atualizada com sucesso no banco de dados!");
        console.log("Processo concluído com 100% de sucesso!");

    } catch (e) {
        console.error("Erro no processamento:", e);
    }
}

run();
