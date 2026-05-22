import EventEmitter from 'eventemitter3';

export class RuntimeEventBus<
    TEvents extends Record<string, any>
> {
    private emitter = new EventEmitter();

    on<TKey extends keyof TEvents>(
        event: TKey,
        listener: (payload: TEvents[TKey]) => void
    ) {
        this.emitter.on(event as string, listener as any);
    }

    off<TKey extends keyof TEvents>(
        event: TKey,
        listener: (payload: TEvents[TKey]) => void
    ) {
        this.emitter.off(event as string, listener as any);
    }

    emit<TKey extends keyof TEvents>(
        event: TKey,
        payload: TEvents[TKey]
    ) {
        this.emitter.emit(event as string, payload);
    }
}