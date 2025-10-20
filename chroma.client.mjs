import { ChromaClient } from "chromadb";
import { DefaultEmbeddingFunction } from "@chroma-core/default-embed";

export const chroma = new ChromaClient({
  host: process.env.CHROMA_HOST || "localhost",
  port: Number(process.env.CHROMA_PORT || 8000),
  ssl: false,
});

export const ef = new DefaultEmbeddingFunction(); // dipakai jika kirim "documents"
