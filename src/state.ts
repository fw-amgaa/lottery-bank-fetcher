import fs from "fs";
import path from "path";

const STATE_FILE = path.join(__dirname, "..", "state.json");

interface State {
  lastFetchedAt: string | null;
}

export function readState(): State {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return { lastFetchedAt: null };
  }
}

export function writeState(state: State): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
