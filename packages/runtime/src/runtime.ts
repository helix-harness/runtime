import { RuntimeContext } from '@helix/core';
import { RuntimeEventBus } from '@helix/events';

export interface RuntimeOptions {
    eventBus?: RuntimeEventBus<any>;
}

export class Runtime {
    private eventBus?: RuntimeEventBus<any>;

    constructor(options: RuntimeOptions = {}) {
        this.eventBus = options.eventBus;
    }

    async run(input: string, ctx?: RuntimeContext): Promise<string> {
        const sessionId = ctx?.sessionId ?? 'default';

        this.eventBus?.emit('runtime:start', {
            sessionId,
            input,
            timestamp: Date.now(),
        });

        try {
            // =========================
            // v0.1 CORE LOGIC (NO AI)
            // =========================

            const processed = this.process(input);

            this.eventBus?.emit('runtime:processed', {
                sessionId,
                input,
                output: processed,
                timestamp: Date.now(),
            });

            this.eventBus?.emit('runtime:end', {
                sessionId,
                output: processed,
                timestamp: Date.now(),
            });

            return processed;
        } catch (err) {
            this.eventBus?.emit('runtime:error', {
                sessionId,
                error: err,
                timestamp: Date.now(),
            });

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