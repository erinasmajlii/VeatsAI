import path from "path";

/**
 * Folder for local state: the JSON database, uploaded plans, the dev session secret.
 * Defaults to ./.data (git-ignored). Tests point VEATS_DATA_DIR at a throw-away folder so they never touch real data.
 */
export function dataDir(): string {
  return process.env.VEATS_DATA_DIR ? path.resolve(process.env.VEATS_DATA_DIR) : path.join(process.cwd(), ".data");
}
