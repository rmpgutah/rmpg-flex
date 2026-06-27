// ============================================================
// ALPR Leaks Collector — Motorola ALPR feed integration
// ============================================================
// Collects license plate data from exposed Motorola ALPR systems.
// Maintains persistent connections to remote systems and buffers
// incoming messages until complete, then parses and persists hits.
//
// NOTE: Most Motorola ALPRs were taken offline following media
// reports and Motorola's remediation efforts (January 2025).

import * as net from 'net';

const FEED_PORT = 8080;
const DATA_PORT = 5001;

export interface ALPRHit {
  uuid: string;
  systemId: string;
  timestamp: string;
  make: string;
  model: string;
  color: string;
  licensePlateNumber: string;
  jpegData?: Buffer;
}

/**
 * Connects to a single Motorola ALPR system and begins streaming hits.
 * Calls onHit for each complete message; errors are logged but don't
 * terminate the collector (reconnect logic is caller's responsibility).
 */
export class ALPRCollector {
  private systemId: string;
  private port: number;
  private messageBuffer: Buffer = Buffer.alloc(0);
  private client: net.Socket | null = null;

  constructor(systemId: string, port: number = DATA_PORT) {
    this.systemId = systemId;
    this.port = port;
  }

  async connect(onHit: (hit: ALPRHit) => Promise<void>, onError?: (err: Error) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client = new net.Socket();

      this.client.on('connect', () => {
        console.log(`[ALPR] Connected to ${this.systemId}:${this.port}`);
        resolve();
      });

      this.client.on('error', (err) => {
        if (onError) onError(err);
        else console.error(`[ALPR] ${this.systemId} error:`, err.message);
        reject(err);
      });

      this.client.on('data', (data: Buffer) => {
        this.handleData(data, onHit).catch((err) => {
          if (onError) onError(err);
          else console.error(`[ALPR] ${this.systemId} parse error:`, err.message);
        });
      });

      this.client.on('end', () => {
        console.log(`[ALPR] Connection closed by ${this.systemId}`);
      });

      this.client.connect(this.port, this.systemId);
    });
  }

  private async handleData(data: Buffer, onHit: (hit: ALPRHit) => Promise<void>): Promise<void> {
    this.messageBuffer = Buffer.concat([this.messageBuffer, data]);
    const messageEnd = '"UseCacheGPS": "1"';

    while (true) {
      const messageEndIndex = this.messageBuffer.indexOf(messageEnd);
      if (messageEndIndex === -1) break;

      const completeMessage = this.messageBuffer.slice(0, messageEndIndex + messageEnd.length);
      await this.processMessage(completeMessage, onHit);
      this.messageBuffer = this.messageBuffer.slice(messageEndIndex + messageEnd.length);
    }
  }

  private async processMessage(message: Buffer, onHit: (hit: ALPRHit) => Promise<void>): Promise<void> {
    try {
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const parts = message.toString('utf-8').split(/[\0\n]+/);

      // Parse vehicle info from message buffer
      const equalsIndex = parts.findIndex((part) => part.startsWith('='));
      if (equalsIndex === -1) return;

      const licensePlate = parts[equalsIndex + 1];
      const uuid = parts[equalsIndex + 2];
      const colorNameIndex = parts.findIndex((part) => part.startsWith('"ColorName'));
      if (colorNameIndex === -1) return;

      const vehicleColor = parts[colorNameIndex].split('"')[3] || '';
      const make = parts[colorNameIndex + 2]?.split('"')[3] || '';
      const model = parts[colorNameIndex + 3]?.split('"')[3] || '';

      // Extract JPEG if present
      const jpegData = this.extractJPEG(message);

      const hit: ALPRHit = {
        uuid,
        systemId: this.systemId,
        timestamp,
        make,
        model,
        color: vehicleColor,
        licensePlateNumber: licensePlate,
        jpegData,
      };

      await onHit(hit);
    } catch (err) {
      console.error(`[ALPR] Failed to parse message from ${this.systemId}:`, err);
      throw err;
    }
  }

  private extractJPEG(message: Buffer): Buffer | undefined {
    const jpegStartMarker = Buffer.from([0xFF, 0xD8]);
    const jpegEndMarker = Buffer.from([0xFF, 0xD9]);
    const jpegStartIndex = message.indexOf(jpegStartMarker);

    if (jpegStartIndex === -1) return undefined;

    const jpegEndIndex = message.indexOf(jpegEndMarker, jpegStartIndex);
    if (jpegEndIndex === -1) return undefined;

    return message.slice(jpegStartIndex, jpegEndIndex + 2);
  }

  disconnect(): void {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
  }
}
