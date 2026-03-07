import { chatgptAdapter } from './background/adapters/chatgpt-adapter.js';

const mockPayload = {
  action: "next",
  messages: [
    {
      id: "abc",
      author: { role: "user" },
      content: {
        content_type: "text",
        parts: ["hi my name is prakash and i work for google"]
      }
    }
  ]
};

console.log('Matches URL?:', chatgptAdapter.matches('https://chatgpt.com/backend-api/conversation', mockPayload));
console.log('Matches Schema?:', chatgptAdapter.matches('https://other.com', mockPayload));

const mockCtx = {
  transformText: async (text) => {
    return { text: text.replace('prakash', '[REDACTED]'), replacements: 1, changed: true };
  }
};

(async () => {
  const result = await chatgptAdapter.transformPayload(mockPayload, mockCtx);
  console.log('Transformed Payload:', JSON.stringify(result, null, 2));
})();
