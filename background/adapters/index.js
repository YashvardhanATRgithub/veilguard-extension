import { chatgptAdapter } from './chatgpt-adapter.js';
import { claudeAdapter } from './claude-adapter.js';
import { geminiAdapter } from './gemini-adapter.js';
import { genericAdapter } from './generic-adapter.js';

const ORDERED_ADAPTERS = [chatgptAdapter, claudeAdapter, geminiAdapter, genericAdapter];

export function resolveAdapter(url, payload) {
  for (const adapter of ORDERED_ADAPTERS) {
    if (adapter.matches(url, payload)) {
      return adapter;
    }
  }
  return genericAdapter;
}

export { chatgptAdapter, claudeAdapter, geminiAdapter, genericAdapter };
