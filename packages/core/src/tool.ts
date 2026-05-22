export interface ToolDefinition<
    TInput = unknown,
    TResult = unknown
> {
    name: string;

    description?: string;

    execute(input: TInput): Promise<TResult>;
}