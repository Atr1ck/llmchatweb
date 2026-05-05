import type { Message } from "../store/chatStore";

/** Agent 循环阶段 */
export type AgentStage = "thinking" | "tool_calling" | "observing" | "responding";

/** Agent 状态 */
export type AgentStatus = {
  currentRound: number;
  maxRounds: number;
  stage: AgentStage;
  toolName?: string;
  toolSuccess?: boolean;
  toolDuration?: number;
};

export type SSECallbacks = {
  onText: (content: string) => void;
  onToolCallStart: (call: { id: string; name: string }) => void;
  onToolCallDelta: (call: { id: string; arguments: string }) => void;
  onToolCallEnd: (call: { id: string; name: string; arguments: string }) => void;
  onToolResult: (result: { id: string; name: string; result: string; success: boolean; duration: number }) => void;
  onAgentStatus: (status: AgentStatus) => void;
  onDone: () => void;
};

/**
 * 健壮的 SSE 解析器
 * 标准 SSE 格式：
 *   event: <type>
 *   data: <json>
 *
 *   (空行分隔事件)
 */
class SSEParser {
  private buffer = "";
  private callbacks: SSECallbacks;

  constructor(callbacks: SSECallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * 处理接收到的数据块
   */
  feed(chunk: string) {
    this.buffer += chunk;
    this.processBuffer();
  }

  /**
   * 处理缓冲区，提取完整事件
   */
  private processBuffer() {
    // 持续处理，直到没有完整的 events 为止
    while (true) {
      const eventEnd = this.buffer.indexOf("\n\n");
      if (eventEnd === -1) break;

      const eventBlock = this.buffer.slice(0, eventEnd);
      this.buffer = this.buffer.slice(eventEnd + 2);

      this.parseEventBlock(eventBlock);
    }
  }

  /**
   * 解析单个事件块
   */
  private parseEventBlock(block: string) {
    let eventType = "message";
    let dataStr = "";

    // 按行解析
    const lines = block.split("\n");
    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataStr = line.slice(5).trim();
      }
    }

    if (!dataStr) return;

    // 跳过 comment 行
    if (dataStr === ":") return;

    try {
      const data = JSON.parse(dataStr);
      this.dispatch(eventType, data);
    } catch {
      // JSON 解析失败，忽略该事件
    }
  }

  /**
   * 分发事件到对应回调
   */
  private dispatch(type: string, data: unknown) {
    const d = data as Record<string, unknown>;

    switch (type) {
      case "text":
        if (d.content) {
          this.callbacks.onText(d.content as string);
        }
        break;

      case "tool_call_start":
        this.callbacks.onToolCallStart({
          id: d.id as string,
          name: d.name as string,
        });
        break;

      case "tool_call_delta":
        this.callbacks.onToolCallDelta({
          id: d.id as string,
          arguments: d.arguments as string,
        });
        break;

      case "tool_call_end":
        this.callbacks.onToolCallEnd({
          id: d.id as string,
          name: d.name as string,
          arguments: d.arguments as string,
        });
        break;

      case "tool_result":
        this.callbacks.onToolResult({
          id: d.id as string,
          name: d.name as string,
          result: d.result as string,
          success: d.success as boolean,
          duration: d.duration as number,
        });
        break;

      case "agent_status":
        this.callbacks.onAgentStatus(d as AgentStatus);
        break;

      case "done":
        this.callbacks.onDone();
        break;

      case "error":
        // 忽略错误事件
        break;
    }
  }

  /**
   * flush 剩余数据
   */
  flush() {
    if (this.buffer.trim()) {
      this.parseEventBlock(this.buffer.trim());
      this.buffer = "";
    }
  }
}

export async function streamChat(
  messages: Message[],
  callbacks: SSECallbacks,
  options?: { signal?: AbortSignal }
): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messages }),
    signal: options?.signal,
  });

  if (!response.body) {
    throw new Error("No response body");
  }

  const parser = new SSEParser(callbacks);
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      parser.feed(chunk);
    }
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      throw err;
    }
  }

  // 处理剩余数据
  parser.flush();
}

