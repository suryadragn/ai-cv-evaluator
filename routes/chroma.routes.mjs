import { Router } from "express";
import { chroma, ef } from "../chroma.client.mjs";

const r = Router();

r.get("/chroma/health", async (_req, res) => {
  try {
    await chroma.getOrCreateCollection({ name: "health", embeddingFunction: ef });
    res.json({ status: "ok" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

r.post("/chroma/add", async (req, res) => {
  try {
    const { name = "docs", ids = [], documents = [], metadatas = [] } = req.body || {};
    const col = await chroma.getOrCreateCollection({ name, embeddingFunction: ef });
    await col.add({ ids, documents, metadatas });
    res.json({ added: ids.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

r.post("/chroma/query", async (req, res) => {
  try {
    const { name = "docs", queryTexts = [], nResults = 3 } = req.body || {};
    const col = await chroma.getOrCreateCollection({ name, embeddingFunction: ef });
    const out = await col.query({ queryTexts, nResults });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default r;
