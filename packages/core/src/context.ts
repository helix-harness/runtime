import {AgentMessage} from "./message";
import {ToolDef} from "./tool";

export interface AgentContext {
    systemPrompt: string;
    messages: AgentMessage[];
    tools: ToolDef[];
}