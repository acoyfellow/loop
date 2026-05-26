export type EventType =
  | "user_message"
  | "assistant_message"
  | "panel_created"
  | "panel_revised"
  | "memory_committed"
  | "memory_signaled"
  | "summary_checkpoint";

export type LoopEvent = {
  revision: number;
  id: string;
  type: EventType;
  committedAt: string;
  payload: Record<string, unknown>;
};

export type MemoryKind = "preference" | "decision" | "fact" | "failure" | "open_loop";

export type Memory = {
  id: string;
  kind: MemoryKind;
  text: string;
  committedAt: string;
  sourceRevision: number | null;
  state: "kept" | "wrong" | "forgotten";
};

export type PanelRevision = {
  id: string;
  panelId: string;
  title: string;
  source: string;
  sourceHash: string;
  clientJs: string;
  css: string;
  svelteVersion: string;
  createdAt: string;
  promptedByRevision: number | null;
};

export type Panel = {
  id: string;
  title: string;
  pinned: boolean;
  activeRevisionId: string;
  updatedAt: string;
  revision: PanelRevision;
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

export type ToolAction =
  | {
      name: "create_panel" | "revise_panel";
      input: { id: string; title: string; source: string; pin?: boolean };
    }
  | {
      name: "remember";
      input: { kind: MemoryKind; text: string };
    };
