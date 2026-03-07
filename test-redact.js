import { redactWithLocalLlm } from './background/local-llm-redactor.js';

(async () => {
    try {
        const result = await redactWithLocalLlm({
            text: "hi my name is prakash and i work for google",
            settings: {
                localLlmEndpoint: "http://127.0.0.1:11434/api/chat",
                localLlmModel: "qwen2.5:1.5b",
                localLlmTimeoutMs: 60000,
                enableLocalNer: true,
                minEntityConfidence: 0.6
            }
        });
        console.log("REDACTION RESULT:", JSON.stringify(result, null, 2));
    } catch (e) {
        console.error("ERROR:", e);
    }
})();
