export interface RuntimeEvent<T = unknown> {
    type: string;
    timestamp: number;
    payload: T;
}