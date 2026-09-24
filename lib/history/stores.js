import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonical } from "./contracts.js";
const validId = id => { if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid observation ID"); return id; };
export class MemoryObservationStore {
  #records = new Map();
  async appendIfAbsent(id, record) {
    validId(id); if (id !== record.observation_id) throw new Error("Identity mismatch");
    if (this.#records.has(id)) return false;
    this.#records.set(id, structuredClone(record)); return true;
  }
  async get(id) { return structuredClone(this.#records.get(validId(id)) ?? null); }
}
/** Local/offline worker only. Exclusive creation prevents refreshes/concurrent writers overwriting observations. */
export class FileObservationStore {
  constructor(directory) { if (process.env.VERCEL) throw new Error("Filesystem history is not durable on Vercel"); this.directory = directory; }
  async appendIfAbsent(id, record) {
    validId(id); if (id !== record.observation_id) throw new Error("Identity mismatch");
    await mkdir(this.directory, { recursive: true });
    try { await writeFile(join(this.directory, `${id}.json`), JSON.stringify(canonical(record)), { flag: "wx" }); return true; }
    catch (e) { if (e.code === "EEXIST") return false; throw e; }
  }
  async get(id) { try { return JSON.parse(await readFile(join(this.directory, `${validId(id)}.json`), "utf8")); } catch (e) { if (e.code === "ENOENT") return null; throw e; } }
}
