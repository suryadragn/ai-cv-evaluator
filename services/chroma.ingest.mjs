// services/chroma.ingest.mjs
import { readFileSync, statSync } from "fs";
import { join } from "path";
import { chroma, ef } from "../chroma.client.mjs";

const UPLOAD_DIR = join(process.cwd(), "uploads");

// --- ambil fungsi pdf-parse secara dinamis (ESM-safe di Node v25)
async function getPdfParseFn() {
  const mod = await import("pdf-parse");           // dynamic import
  // beberapa instalasi mengembalikan function langsung, beberapa via .default
  return typeof mod === "function" ? mod : mod.default;
}

function assertPdfExists(fname, kind) {
  if (!fname) throw new Error(`Missing ${kind} filename`);
  const p = join(UPLOAD_DIR, fname);
  let s;
  try { s = statSync(p); } catch { throw new Error(`${kind} file not found: ${fname}`); }
  if (!s.isFile()) throw new Error(`${kind} path is not a file: ${fname}`);
  return p;
}

async function extractPdfText(filePath) {
  const pdfParse = await getPdfParseFn();          // ← dapatkan fungsi yang valid
  const buf = readFileSync(filePath);
  const data = await pdfParse(buf);
  const text = (data?.text ?? "").replace(/\s+/g, " ").trim();
  return text.length ? text : "(empty)";
}

export async function ingestUploadPairToChroma(record) {
  const { id, cv_name, report_name } = record;

  const col = await chroma.getOrCreateCollection({
    name: "candidates",
    embeddingFunction: ef,
  });

  const cvPath = assertPdfExists(cv_name, "CV");
  const rpPath = assertPdfExists(report_name, "Project report");

  const [cvText, repText] = await Promise.all([
    extractPdfText(cvPath),
    extractPdfText(rpPath),
  ]);

  const ids       = [`${id}_cv`, `${id}_report`];
  const documents = [cvText, repText];
  const metadatas = [
    { group_id: id, kind: "cv",     filename: cv_name,     path: `/uploads/${cv_name}` },
    { group_id: id, kind: "report", filename: report_name, path: `/uploads/${report_name}` },
  ];

  try { await col.delete({ ids }); } catch {}
  await col.add({ ids, documents, metadatas });

  return { added: ids.length, ids, collection: "candidates" };
}

