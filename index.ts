import { promisify } from "node:util";
import { deflateRaw, type ZlibOptions } from "node:zlib";

const deflateRawAsync = promisify(deflateRaw);

type FileContent =
  string | ArrayBuffer | NodeJS.ArrayBufferView<ArrayBufferLike>;

export interface Zip {
  addFile(path: string, content: FileContent): void;
  toBuffer(): Promise<Buffer>;
}

export function createZip(options?: ZlibOptions): Zip {
  const entries: Array<{ path: string; buffer: Buffer }> = [];

  // Fast CRC-32 implementation for file integrity
  const crc32 = (buf: Buffer) => {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
      let byte = buf[i]!;
      crc ^= byte;
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ -1) >>> 0;
  };

  const addFile: Zip["addFile"] = (path, content) => {
    entries.push({ path, buffer: fileContentToBuffer(content) });
  };

  // Helpers to minimize file size
  const w16 = (buf: Buffer, value: number, offset: number) =>
    buf.writeUInt16LE(value, offset);
  const w32 = (buf: Buffer, value: number, offset: number) =>
    buf.writeUInt32LE(value, offset);

  const toBuffer: Zip["toBuffer"] = async () => {
    const frozenEntries = entries.slice();
    const processed: Array<
      [
        pathBuf: Buffer,
        data: Buffer,
        method: number,
        crc: number,
        cSize: number,
        uSize: number,
        flags: number,
      ]
    > = [];
    let totalSize = 22; // EOCD

    for (const entry of frozenEntries) {
      const pathBuf = Buffer.from(entry.path);
      const compressed = await deflateRawAsync(entry.buffer, options);
      const useStore = compressed.length >= entry.buffer.length;
      const data = useStore ? entry.buffer : compressed;
      const flags = /[^\x00-\x7F]/.test(entry.path) ? 0x0800 : 0;

      processed.push([
        pathBuf,
        data,
        useStore ? 0 : 8,
        crc32(entry.buffer),
        data.length,
        entry.buffer.length,
        flags,
      ]);

      totalSize += 76 + pathBuf.length * 2 + data.length;
    }

    const result = Buffer.alloc(totalSize);
    let pos = 0;
    let localOff = 0;

    for (const [pathBuf, data, method, crc, cSize, uSize, flags] of processed) {
      const pLen = pathBuf.length;
      // Local header
      w32(result, 0x04034b50, pos);
      w16(result, 20, pos + 4);
      w16(result, flags, pos + 6);
      w16(result, method, pos + 8);
      w32(result, 0, pos + 10);
      w32(result, crc, pos + 14);
      w32(result, cSize, pos + 18);
      w32(result, uSize, pos + 22);
      w16(result, pLen, pos + 26);
      w16(result, 0, pos + 28);
      pathBuf.copy(result, pos + 30);
      pos += 30 + pLen;
      data.copy(result, pos);
      pos += data.length;
    }

    const cdStart = pos;

    for (const [pathBuf, , method, crc, cSize, uSize, flags] of processed) {
      const pLen = pathBuf.length;
      // Central directory header
      w32(result, 0x02014b50, pos);
      w32(result, 0x00140014, pos + 4);
      w16(result, flags, pos + 8);
      w16(result, method, pos + 10);
      w32(result, 0, pos + 12);
      w32(result, crc, pos + 16);
      w32(result, cSize, pos + 20);
      w32(result, uSize, pos + 24);
      w16(result, pLen, pos + 28);
      w32(result, 0, pos + 30);
      w32(result, 0, pos + 34);
      w32(result, 0, pos + 38);
      w32(result, localOff, pos + 42);
      pathBuf.copy(result, pos + 46);
      localOff += 30 + pLen + cSize;
      pos += 46 + pLen;
    }

    // EOCD
    w32(result, 0x06054b50, pos);
    w32(result, 0, pos + 4);
    w16(result, processed.length, pos + 8);
    w16(result, processed.length, pos + 10);
    w32(result, pos - cdStart, pos + 12);
    w32(result, cdStart, pos + 16);
    w16(result, 0, pos + 20);

    return result;
  };

  return { addFile, toBuffer };
}

function fileContentToBuffer(c: FileContent): Buffer {
  if (typeof c === "string") return Buffer.from(c);
  if (ArrayBuffer.isView(c))
    return Buffer.from(c.buffer, c.byteOffset, c.byteLength);
  return Buffer.from(c);
}
