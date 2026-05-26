export type MemoryKind = "preference" | "decision" | "fact" | "failure" | "open_loop";

export type LoopEvent = {
  revision: number;
  id: string;
  type: string;
  committedAt: string;
  payload: Record<string, unknown>;
};

export type Memory = {
  id: string;
  kind: MemoryKind;
  text: string;
  committedAt: string;
  sourceRevision: number | null;
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
    source: string;
    sourceHash: string;
    clientJs: string;
    css: string;
    svelteVersion: string;
  };
};

export type ThreadSnapshot = {
  events: LoopEvent[];
  panels: Panel[];
  memories: Memory[];
  context: {
    recentEventCount: number;
    memoryCount: number;
    checkpointSummary: string | null;
  };
};
