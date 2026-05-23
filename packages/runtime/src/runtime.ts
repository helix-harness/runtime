import type { AgentContext } from '@helix/core';

export interface RuntimeOptions {
}

export class Runtime {
    constructor(options: RuntimeOptions = {}) {
    }

    async run(input: string, ctx?: AgentContext): Promise<string> {
        const sessionId = ctx?.messages ? 'session' : 'default';

        try {
            // =========================
            // v0.1 CORE LOGIC (NO AI)
            // =========================

            const processed = this.process(input);

            return processed;
        } catch (err) {
            throw err;
        }
    }

    /**
     * v0.1: deterministic transformation only
     * （未来这里才会接 LLM / tools）
     */
    private process(input: string): string {
        return `[helix:v0.1] ${input}`;
    }
}