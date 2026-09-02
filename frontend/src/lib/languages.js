// Module-level memoization so every page that needs the language list
// (Translate, Settings) shares one request instead of each re-fetching it.
import { fetchLanguages } from './api';

let cache = null;

export function getLanguages() {
  if (!cache) {
    cache = fetchLanguages().catch((err) => {
      cache = null; // let the next caller retry instead of caching the failure
      throw err;
    });
  }
  return cache;
}
