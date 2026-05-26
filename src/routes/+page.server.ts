import { getThread } from "./data.remote.js";

export async function load() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return { initialThread: await getThread(), loadError: null };
    } catch (error) {
      if (attempt === 4) {
        return {
          initialThread: null,
          loadError: error instanceof Error ? error.message : String(error),
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  return { initialThread: null, loadError: "unreachable" };
}
