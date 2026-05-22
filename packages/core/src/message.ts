export type MessageRole =
    | 'system'
    | 'user'
    | 'assistant'
    | 'tool';

export interface AgentMessage {
    id: string;
    role: MessageRole;
    content: string;
    createdAt: number;
}