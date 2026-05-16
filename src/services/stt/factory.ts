import { LiveSttNotConfiguredProvider } from "./base";
import type { SttProvider } from "./types";

export function createSttProvider(): SttProvider {
  return new LiveSttNotConfiguredProvider();
}
