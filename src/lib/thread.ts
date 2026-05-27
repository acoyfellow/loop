export type MemoryKind = "preference" | "decision" | "fact" | "failure" | "open_loop";

export type LoopMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
};

export type Memory = {
  id: string;
  kind: MemoryKind;
  text: string;
  committedAt: string;
  state: "kept" | "wrong" | "forgotten";
};

export type Panel = {
  id: string;
  title: string;
  pinned: boolean;
  activeRevisionId: string;
  updatedAt: string;
  revision: {
    id: string;
    panelId: string;
    title: string;
    source: string;
    sourceHash: string;
    clientJs: string;
    css: string;
    svelteVersion: string;
    createdAt: string;
  };
};

export type ThreadSnapshot = {
  messages: LoopMessage[];
  panels: Panel[];
  memories: Memory[];
  stats: {
    messageCount: number;
    panelCount: number;
    memoryCount: number;
  };
};
