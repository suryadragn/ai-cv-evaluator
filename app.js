import 'dotenv/config';
import express from 'express';
import { join, extname, basename } from 'path';
import { existsSync, mkdirSync,readFileSync,writeFileSync,unlinkSync,readFile } from 'fs';
import multer from 'multer';
import { fileURLToPath } from 'url';
import path from 'path';
import { chroma, ef } from "./chroma.client.mjs";
import { GoogleGenAI } from '@google/genai';
import { getDocument } from 'pdfjs-dist/build/pdf.mjs';


const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const port = 3000;

app.use(express.json());
// app.use(chromaRoutes);

app.get('/check', async (req, res) => {
  // res.json({ status: 'ok', time: new Date().toISOString() });
  try {
      await chroma.getOrCreateCollection({ name: "health", embeddingFunction: ef });
      res.json({ status: "ok" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// folder & data file
const UPLOAD_DIR = join(process.cwd(), "uploads");
const DATA_FILE = join(process.cwd(), "data", "uploads.json");

if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
if (!existsSync(join(process.cwd(), "data"))) mkdirSync(join(process.cwd(), "data"), { recursive: true });
if (!existsSync(DATA_FILE)) writeFileSync(DATA_FILE, JSON.stringify([], null, 2), "utf8");

// baca/simpan data
// const loadData = () => JSON.parse(readFileSync(DATA_FILE, "utf8"));
function loadData() {
  try {
    const raw = readFileSync(DATA_FILE, "utf8");
    if (!raw?.trim()) {
      // kosong → re-init
      writeFileSync(DATA_FILE, "[]", "utf8");
      return [];
    }
    return JSON.parse(raw);
  } catch (err) {
    // kalau gagal parse (korup), reset ke []
    console.warn("uploads.json corrupt/empty, reinitializing:", err.message);
    writeFileSync(DATA_FILE, "[]", "utf8");
    return [];
  }
}
const saveData = (d) => writeFileSync(DATA_FILE, JSON.stringify(d, null, 2), "utf8");

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const ext = extname(file.originalname || "");
    cb(null, Date.now() + ext);
  },
});
const fileFilter = (_, file, cb) => {
  const ok = file.mimetype === "application/pdf" || /\.pdf$/i.test(file.originalname || "");
  if (!ok) return cb(new Error("Hanya file PDF yang diizinkan"), false);
  cb(null, true);
};
const upload = multer({ storage, fileFilter });


const saveChroma = async (record) => {
  // contoh fungsi untuk menyimpan data ke ChromaDB  
  const id = record.id.toString();
  const documentContent = `
        --- CV FILE: ${record.cv_name} ---
        ${record.cvText} 

        --- PROJECT REPORT FILE: ${record.report_name} ---
        ${record.reportText} 

        Uploaded At: ${record.uploaded_at}
    `;
  const metadata = {
    cv_name: record.cv_name,
    report_name: record.report_name,
    uploaded_at: record.uploaded_at,
  };
  const col = await chroma.getOrCreateCollection({ name: "candidates", embeddingFunction: ef });
  const saveData = { 
      ids: [id], 
      documents: [documentContent], 
      metadatas: [metadata] 
    }
    //   console.log(saveData);
    //   process.exit(0);
    // 3. Tambahkan data
    await col.add(saveData);
    
    console.log(`Record ID ${id} saved to ChromaDB.`);
};
const getAllChromaData = async (collectionName) => {
    // Asumsi: 'chroma' dan 'ef' (embeddingFunction) sudah diinisialisasi
    try {
        const col = await chroma.getOrCreateCollection({ 
            name: collectionName, 
            // Jika Anda sudah membuat koleksi, Anda hanya perlu: 
            // const col = await chroma.getCollection({ name: collectionName });
        });

        // Panggil get() tanpa filter IDs.
        // Include: meminta semua field yang Anda butuhkan (documents dan metadatas)
        const allData = await col.get({
            // Tidak menyertakan 'ids' atau 'where' berarti ambil semua
            include: ["metadatas", "documents"] 
        });

        return allData;
    } catch (error) {
        console.error(`Gagal mendapatkan data dari koleksi ${collectionName}:`, error);
        return { ids: [], metadatas: [], documents: [] };
    }
};
app.post(
  "/upload",
  upload.fields([{ name: "cv", maxCount: 1 }, { name: "project_report", maxCount: 1 }]),
  async (req, res, next) => {
    try {
        const cv = req.files?.cv?.[0];
        const pr = req.files?.project_report?.[0];

        // pastikan dua-duanya ada
        if (!cv || !pr) {
            for (const f of [cv, pr]) if (f?.path) try { unlinkSync(f.path); } catch {}
            return res.status(400).json({
            error: "Kirimkan kedua persyaratan: 'cv' dan 'project_report' (PDF).",
            });
        }

        // data dinyatakan lolos -> simpan ke "DB" (file json / database)
        const allCandidates = await getAllChromaData('candidates');
        console.log(`Total Kandidat: ${allCandidates.length}`)
        // const all = loadData();
        const id = allCandidates.length + 1; // auto increment sederhana

        const cvPath = join(UPLOAD_DIR, cv.filename);
        const reportPath = join(UPLOAD_DIR, pr.filename);
        
        const cvText = await readPdfText(cvPath);
        const reportText = await readPdfText(reportPath);

        const record = {
            id,
            cv_name: cv.filename,
            cvText:cvText,
            report_name: pr.filename,
            reportText:reportText,
            uploaded_at: new Date().toISOString(),
        };
        // all.push(record);
        // saveData(all);
        saveChroma(record).catch((err) => {
            console.error("Gagal simpan ke ChromaDB:", err);
        });      

        // respon ke client
        res.json({
            id,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Upload failed" });
    }
  }
);

// app.js (Tambahkan ini)

app.get('/chroma-check/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const name = "candidates"; // Nama koleksi default
        const col = await chroma.getCollection({ name, embeddingFunction: ef });
        
        // Ambil data. Batasi jumlahnya (misalnya, 10 data terbaru)
        // const count = await col.count();
        const data = await col.get({
            ids: [id.toString()],
            include: ["documents", "metadatas"],
        });
        const formattedResult = {
            collections: name,
            data:{
              id: data.ids[0],
              document: data.documents[0], // Ini akan berisi teks yang diekstrak dari PDF
              metadata: data.metadatas[0],
            }
        };

        res.json(formattedResult);
    } catch (e) { 
        console.error("Error retrieving from ChromaDB:", e.message);
        res.status(500).json({ 
            error: "Gagal mengambil data dari ChromaDB.",
            detail: e.message 
        }); 
    }
});

// --- Fungsi Pembaca PDF ---
// Pastikan readFileSync juga sudah diimpor dari 'fs'
async function readPdfText(filePath) {
    try {
        const dataBuffer = readFileSync(filePath);
        const data = new Uint8Array(dataBuffer);

        // getDocument sekarang memuat dari pdf.node.mjs
        const doc = await getDocument({ data }).promise;
        let fullText = '';
        
        for (let i = 1; i <= doc.numPages; i++) {
            const page = await doc.getPage(i);
            const content = await page.getTextContent();
            
            fullText += content.items.map(item => item.str).join(' ') + '\n\n';
        }
        
        return fullText.trim();
    } catch (error) {
        console.error("Error membaca PDF dengan pdfjs-dist:", error.message);
        throw new Error(`Gagal mengekstrak teks dari file ${filePath}: ${error.message}`);
    }
}
const saveChromaEvaluate = async (id,status,result = null) => {
  // contoh fungsi untuk menyimpan data ke ChromaDB  
  const documentContent = `On Evaluate Request for Record ID: ${id} , and status set to ${status}`;
  const metadata = {
    status:status 
  };
  const col = await chroma.getOrCreateCollection({ name: "eval_candidates", embeddingFunction: ef });
    //   cek data existing dulu, kalau ada update aja
    const existing = await col.get({
        ids: [id],
        include: ["documents", "metadatas"],
    });
    if (existing.ids.length > 0) {
        // ada data existing, lakukan update dengan menghapus dulu
        await col.delete({ ids: [id] });
        console.log(`Record ID ${id} existing data deleted for update.`);
    }
    // 3. Tambahkan data
    if(result){
        metadata['cv_match_rate'] = result.cv_match_rate;
        metadata['cv_feedback'] = result.cv_feedback;
        metadata['project_score'] = result.project_score;
        metadata['project_feedback'] = result.project_feedback;
        metadata['overall_summary'] = result.overall_summary;
    }
    await col.add({ 
        ids: [id], 
        documents: [documentContent], 
        metadatas: [metadata] 
    });
    
    console.log(`Record ID ${id} saved to ChromaDB.`);
};
// --- Endpoint /evaluate ---
app.post('/evaluate', express.urlencoded({ extended: true }), async (req, res) => {
    try {
        const { id, job_title } = req.body;

        if (!id || !job_title) {
            return res.status(400).json({ error: "Permintaan harus menyertakan 'id' dan 'job_title'." });
        }

        // 1. Cari Record berdasarkan ID dari data JSON
        const allRecords = loadData();
        const record = allRecords.find(r => String(r.id) === String(id));

        if (!record) {
            return res.status(404).json({ error: `Record dengan ID ${id} tidak ditemukan.` });
        }

        // 2. Tentukan file yang akan dievaluasi (kita gabungkan CV dan Laporan)

        if (!existsSync(cvPath) || !existsSync(reportPath)) {
             return res.status(404).json({ error: "Satu atau kedua file (CV/Laporan) tidak ditemukan di folder uploads." });
        }
        saveChromaEvaluate(id.toString(),'processing').catch((err) => {
            console.error("Gagal simpan ke ChromaDB:", err);
        });
        res.json({ id,status: "processing" });
        // 3. Baca dan Gabungkan Teks dari Kedua File
        
        
        const combinedText = `
            --- TEXT CV ---
            ${cvText}
            --- TEXT LAPORAN PROYEK ---
            ${reportText}
        `;

        // 4. Buat Prompt untuk Gemini
const prompt = `
        Anda adalah seorang **Analisis Perekrutan AI** yang sangat teliti. Tugas Anda adalah mengevaluasi seorang kandidat berdasarkan **CV** dan **Laporan Proyek** mereka terhadap suatu posisi pekerjaan.

        ### I. INPUT: TEKS KANDIDAT & POSISI PEKERJAAN
        1.  **POSISI PEKERJAAN:** "${job_title}"
        2.  **TEKS GABUNGAN KANDIDAT:** Teks berikut adalah hasil ekstraksi dari CV dan Laporan Proyek:
            ---
            ${combinedText}
            ---

        ### II. METODE EVALUASI (1-5 SKALA)
        Lakukan evaluasi dua bagian berdasarkan panduan di bawah ini, berikan skor pada skala 1 hingga 5 (hanya angka).

        #### A. CV Match Evaluation (Bobot Total: 100%)
        | Parameter | Deskripsi | Bobot | Scoring Guide (Skala 1-5) |
        | :--- | :--- | :--- | :--- |
        | **Technical Skills Match** | Kesesuaian keterampilan teknis (backend, database, APIs, cloud, AI/LLM) dengan persyaratan pekerjaan. | 40% | 1=Irrelevant, 5=Excellent Match |
        | **Experience Level** | Jumlah tahun pengalaman dan kompleksitas proyek sebelumnya. | 25% | 1=<1 yr/trivial, 5=>5 yrs/high-impact |
        | **Relevant Achievements** | Dampak hasil kerja masa lalu (scaling, performance, adoption). | 20% | 1=No measurable impact, 5=Major measurable impact |
        | **Cultural / Collaboration Fit** | Komunikasi, pembelajaran, mindset teamwork/leadership. | 15% | 1=Not demonstrated, 5=Excellent & well-demonstrated |

        #### B. Project Deliverable Evaluation (Skala 1-5)
        | Parameter | Deskripsi | Bobot | Scoring Guide (Skala 1-5) |
        | :--- | :--- | :--- | :--- |
        | **Correctness (Prompt & Chaining)** | Implementasi prompt design, LLM chaining, RAG context injection. | 30% | 1=Not implemented, 5=Fully correct & thoughtful |
        | **Code Quality & Structure** | Bersih, modular, reusable, diuji. | 25% | 1=Poor, 5=Excellent quality + strong tests |
        | **Resilience & Error Handling** | Penanganan *long jobs*, *retries*, *randomness*, kegagalan API. | 20% | 1=Missing, 5=Robust, production-ready |
        | **Documentation & Explanation** | Kejelasan README, instruksi setup, *trade-off* explanation. | 15% | 1=Missing, 5=Excellent, 5=Excellent & insightful |
        | **Creativity / Bonus** | Fitur ekstra di luar persyaratan. | 10% | 1=None, 5=Outstanding creativity |

        ### III. OUTPUT: JSON TERSTRUKTUR

        Berikan seluruh analisis dan skor dalam satu objek JSON.

        \`\`\`json
        {
            "cv_match_rate": 0.0,
            "cv_feedback": "Ringkasan 2-3 kalimat mengenai kecocokan CV, mencakup kekuatan dan kelemahan dalam Technical Match dan Experience Level.",
            "project_score": 0.0,
            "project_feedback": "Ringkasan 2-3 kalimat mengenai kualitas Proyek, mencakup poin positif (Code Quality, Correctness) dan kekurangan (Resilience, Documentation).",
            "overall_summary": "Ringkasan menyeluruh 3-5 kalimat mengenai kecocokan kandidat secara total (gabungan CV dan Proyek) dan rekomendasi rekrutmen."
        }
        \`\`\`

        Berikan hanya objek JSON, tidak ada teks pendahuluan atau penutup lainnya.`;

        // 5. Panggil Gemini API (Asumsikan Anda sudah memiliki klien Gemini yang terinisialisasi)
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        
        if (!ai) { // Tambahkan pengecekan jika klien AI belum ada
             return res.status(500).json({ error: "Klien Gemini API tidak diinisialisasi." });
        }

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash", 
            contents: prompt,
            config: {
                responseMimeType: "application/json", // Minta respons JSON
            },
        });
        const jsonResponse = JSON.parse(response.text);

        saveChromaEvaluate(id.toString(),'completed',jsonResponse).catch((err) => {
            console.error("Gagal simpan ke ChromaDB:", err);
        });
        
        // // 6. Parsing dan Kirim Hasil
        // const jsonResponse = JSON.parse(response.text);

        // res.json({
        //     status: "success",
        //     job_title,
        //     evaluation: jsonResponse
        // });

    } catch (err) {
        console.error("Gagal mengevaluasi data:", err);
        res.status(500).json({ error: "Gagal memproses evaluasi.", detail: err.message });
    }
});

app.get('/result/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const name = "eval_candidates"; // Nama koleksi default
        const col = await chroma.getCollection({ name, embeddingFunction: ef });
        const existing = await col.get({
            ids: [id],
            include: ["documents", "metadatas"],
        });
        if (existing.ids.length === 0) {
            return res.status(404).json({ error: `Record dengan ID ${id} tidak ditemukan.` });
        }
        let meta = existing.metadatas[0];
        const formattedResult = {    
            id: existing.ids[0],
            status: meta.status,
        };
        if(meta.status === 'completed'){
            formattedResult.result = {
                cv_match_rate:meta.cv_match_rate,
                cv_feedback:meta.cv_feedback,
                project_score:meta.project_score,
                project_feedback:meta.project_feedback,
                overall_summary:meta.overall_summary
            }
            // formattedResult.result.cv_feedback = meta.cv_feedback;
        }
        

        res.json(formattedResult);
    } catch (e) { 
        console.error("Error retrieving from ChromaDB:", e.message);
        res.status(500).json({ 
            error: "Gagal mengambil data dari ChromaDB.",
            detail: e.message 
        }); 
    }
});

app.get('/', (req, res) => res.send('Hello??'));

app.use((req, res) => res.status(404).json({ message: 'Not Found' }));

app.listen(port, '0.0.0.0', () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
