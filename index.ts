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
    const localHeaders = [];
    const centralHeaders = [];
    let offset = 0;

    for (const entry of frozenEntries) {
      const pathBuffer = Buffer.from(entry.path);
      const pathLen = pathBuffer.length;
      const compressedData = await deflateRawAsync(entry.buffer, options);
      const useStore = compressedData.length >= entry.buffer.length;
      const finalData = useStore ? entry.buffer : compressedData;
      const compressionMethod = useStore ? 0 : 8; // 0 = Store, 8 = Deflate
      const compressedSize = finalData.length;
      const uncompressedSize = entry.buffer.length;
      const crc = crc32(entry.buffer);

      const hasUnicode = /[^\x00-\x7F]/.test(entry.path);
      const generalPurposeFlags = hasUnicode ? 0x0800 : 0;

      // 1. Local File Header (30 bytes + filename + compressed data)
      const localHeader = Buffer.alloc(30 + pathLen);
      w32(localHeader, 0x04034b50, 0); // Signature
      w16(localHeader, 20, 4); // Version needed (2.0)
      w16(localHeader, generalPurposeFlags, 6);
      w16(localHeader, compressionMethod, 8);
      w16(localHeader, 0, 10); // Last mod time
      w16(localHeader, 0, 12); // Last mod date
      w32(localHeader, crc, 14);
      w32(localHeader, compressedSize, 18);
      w32(localHeader, uncompressedSize, 22);
      w16(localHeader, pathLen, 26);
      w16(localHeader, 0, 28); // Extra field length
      pathBuffer.copy(localHeader, 30);

      localHeaders.push(localHeader, finalData);

      // 2. Central Directory Header (46 bytes + filename)
      const centralHeader = Buffer.alloc(46 + pathLen);
      w32(centralHeader, 0x02014b50, 0); // Signature
      w16(centralHeader, 20, 4); // Version made by
      w16(centralHeader, 20, 6); // Version needed
      w16(centralHeader, generalPurposeFlags, 8);
      w16(centralHeader, compressionMethod, 10);
      w16(centralHeader, 0, 12); // Last mod time
      w16(centralHeader, 0, 14); // Last mod date
      w32(centralHeader, crc, 16);
      w32(centralHeader, compressedSize, 20);
      w32(centralHeader, uncompressedSize, 24);
      w16(centralHeader, pathLen, 28);
      w16(centralHeader, 0, 30); // Extra field length
      w16(centralHeader, 0, 32); // Comment length
      w16(centralHeader, 0, 34); // Disk number start
      w16(centralHeader, 0, 36); // Internal file attributes
      w32(centralHeader, 0, 38); // External file attributes
      w32(centralHeader, offset, 42); // Relative offset of local header
      pathBuffer.copy(centralHeader, 46);

      centralHeaders.push(centralHeader);

      offset += localHeader.length + compressedData.length;
    }

    const centralDirOffset = offset;
    let centralDirSize = 0;
    for (const ch of centralHeaders) centralDirSize += ch.length;

    // 3. End of Central Directory Record (EOCD - 22 bytes)
    const eocd = Buffer.alloc(22);
    w32(eocd, 0x06054b50, 0); // Signature
    w16(eocd, 0, 4); // Number of this disk
    w16(eocd, 0, 6); // Disk with start of CD
    w16(eocd, frozenEntries.length, 8); // Total entries on this disk
    w16(eocd, frozenEntries.length, 10); // Total entries
    w32(eocd, centralDirSize, 12); // Size of CD
    w32(eocd, centralDirOffset, 16); // Offset of CD
    w16(eocd, 0, 20); // Comment length

    return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
  };

  return { addFile, toBuffer };
}

function fileContentToBuffer(c: FileContent): Buffer {
  if (typeof c === "string") return Buffer.from(c);
  if (ArrayBuffer.isView(c))
    return Buffer.from(c.buffer, c.byteOffset, c.byteLength);
  return Buffer.from(c);
}
