// AudioWorklet API type declarations for processor files.
// These types are available in the AudioWorklet scope but not in the
// standard DOM lib. We declare them here so TypeScript can check the
// processor source files.

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;
