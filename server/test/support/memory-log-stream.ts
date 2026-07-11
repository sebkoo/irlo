import { Writable } from 'node:stream';

export class MemoryLogStream extends Writable {
  private readonly lines: string[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.lines.push(chunk.toString());
    callback();
  }

  parsedLines(): Record<string, unknown>[] {
    return this.lines
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }
}
