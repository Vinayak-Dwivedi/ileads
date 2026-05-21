import "server-only";
import { EventEmitter } from "node:events";

// In-process pub/sub for call status events. Single-instance only — when we
// move to multi-instance Next deployments (phase 3+), swap the underlying
// emitter for Redis pub/sub. Public API stays the same.

export type CallEvent =
  | { type: "status"; status: string }
  | { type: "transcribed"; model?: string; segments?: number; usedFallback?: boolean }
  | { type: "completed"; auditRunNo?: number; model?: string; scorePercent?: number | null }
  | { type: "failed"; stage: "stt" | "audit" | "other"; code?: string; message?: string }
  | { type: "heartbeat" };

class CallEventBus {
  // Use a global so HMR in dev doesn't fragment the bus across hot reloads.
  private emitter: EventEmitter;
  constructor() {
    const g = globalThis as unknown as { __qmsCallEventBus?: EventEmitter };
    if (!g.__qmsCallEventBus) {
      g.__qmsCallEventBus = new EventEmitter();
      g.__qmsCallEventBus.setMaxListeners(0);
    }
    this.emitter = g.__qmsCallEventBus;
  }
  publish(callId: string, event: CallEvent): void {
    this.emitter.emit(`call:${callId}`, event);
  }
  subscribe(callId: string, handler: (event: CallEvent) => void): () => void {
    const ch = `call:${callId}`;
    this.emitter.on(ch, handler);
    return () => this.emitter.off(ch, handler);
  }
}

const bus = new CallEventBus();

export function publishCallEvent(callId: string, event: CallEvent): void {
  bus.publish(callId, event);
}

export function subscribeCallEvents(
  callId: string,
  handler: (event: CallEvent) => void,
): () => void {
  return bus.subscribe(callId, handler);
}
