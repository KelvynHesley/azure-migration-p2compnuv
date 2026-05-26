require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const { BlobServiceClient } = require('@azure/storage-blob');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static('public'));

// Configurações Iniciais
const containerName = "aluno-kelvyn";
const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_CONN_STRING);
const containerClient = blobServiceClient.getContainerClient(containerName);

// Autenticação Google
const googleCredentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
const auth = new google.auth.GoogleAuth({
    credentials: googleCredentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});
const drive = google.drive({ version: 'v3', auth });

// Rota 1: Listar Google Drive
app.get('/api/drive/files', async (req, res) => {
    try {
        const response = await drive.files.list({
            q: `'${process.env.DRIVE_FOLDER_ID}' in parents`,
            fields: 'files(id, name, mimeType)',
        });
        res.json(response.data.files);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rota 2: Listar Azure Blob
app.get('/api/azure/files', async (req, res) => {
    try {
        let blobs = [];
        for await (const blob of containerClient.listBlobsFlat()) {
            blobs.push({ name: blob.name });
        }
        res.json(blobs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rota 3: Migrar Arquivos
app.post('/api/migrate', async (req, res) => {
    try {
        // 1. Criar container se não existir
        await containerClient.createIfNotExists();

        // 2. Listar arquivos do Drive
        const driveResponse = await drive.files.list({
            q: `'${process.env.DRIVE_FOLDER_ID}' in parents`,
            fields: 'files(id, name)',
        });

        const files = driveResponse.data.files;
        let logs = [];

        // 3. Fazer o download e upload de cada arquivo
        for (const file of files) {
            try {
                console.log(`Iniciando transferência: ${file.name}`);
                const driveFile = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'stream' });

                const blockBlobClient = containerClient.getBlockBlobClient(file.name);
                await blockBlobClient.uploadStream(driveFile.data, undefined, undefined, {
                    blobHTTPHeaders: { blobContentType: file.mimeType }
                });

                const successMsg = `[SUCESSO] ${file.name} transferido para o Azure.`;
                console.log(successMsg);
                logs.push(successMsg);
            } catch (err) {
                const errMsg = `[ERRO] Falha ao transferir ${file.name}: ${err.message}`;
                console.error(errMsg);
                logs.push(errMsg);
            }
        }

        res.json({ message: "Migração finalizada", logs });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/azure/clear', async (req, res) => {
    try {
        let logs = [];
        for await (const blob of containerClient.listBlobsFlat()) {
            const blockBlobClient = containerClient.getBlockBlobClient(blob.name);
            await blockBlobClient.delete();
            logs.push(`[REMOVIDO] ${blob.name} apagado com sucesso.`);
        }

        if (logs.length === 0) {
            logs.push("[AVISO] O contêiner já está vazio.");
        }

        res.json({ message: "Limpeza concluída", logs });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));