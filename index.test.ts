import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createZip, type Zip } from "./index";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("createZip", () => {
  let testDir: string;

  async function writeZip(zip: Zip): Promise<string> {
    const buffer = await zip.toBuffer();
    const zipPath = join(testDir, "test.zip");
    await Bun.write(zipPath, buffer);
    return zipPath;
  }

  async function unzip(zipPath: string): Promise<void> {
    // Use -O UTF8 flag for unicode filenames
    await Bun.$`unzip -q -O UTF8 ${zipPath} -d ${testDir}`;
  }

  async function unzipInMemory(zipPath: string): Promise<string> {
    return await Bun.$`unzip -l ${zipPath}`.text();
  }

  async function expectFileContent(
    filePath: string,
    expectedContent: string,
  ): Promise<void> {
    const file = Bun.file(join(testDir, filePath));
    const content = await file.text();
    expect(content).toBe(expectedContent);
  }

  async function expectBinaryFileContent(
    filePath: string,
    expectedContent: Buffer<ArrayBuffer>,
  ): Promise<void> {
    const file = Bun.file(join(testDir, filePath));
    const content = await file.arrayBuffer();
    expect(Buffer.from(content)).toEqual(expectedContent);
  }

  async function expectFileSize(
    filePath: string,
    expectedSize: number,
  ): Promise<void> {
    const file = Bun.file(join(testDir, filePath));
    expect(file.size).toBe(expectedSize);
  }

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "zero-zip-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("creates a valid zip with a single file", async () => {
    const zip = createZip();
    zip.addFile("hello.txt", "Hello, World!");

    const zipPath = await writeZip(zip);
    await unzip(zipPath);

    await expectFileContent("hello.txt", "Hello, World!");
  });

  it("creates a valid zip with multiple files", async () => {
    const zip = createZip();
    zip.addFile("file1.txt", "Content 1");
    zip.addFile("file2.txt", "Content 2");
    zip.addFile("nested/file3.txt", "Content 3");

    const zipPath = await writeZip(zip);
    await unzip(zipPath);

    await expectFileContent("file1.txt", "Content 1");
    await expectFileContent("file2.txt", "Content 2");
    await expectFileContent("nested/file3.txt", "Content 3");
  });

  it("unzips binary content correctly", async () => {
    const zip = createZip();
    const binaryData = Buffer.from([0, 1, 2, 3, 4, 5, 255, 254, 253]);
    zip.addFile("binary.bin", binaryData);

    const zipPath = await writeZip(zip);
    await unzip(zipPath);

    await expectBinaryFileContent("binary.bin", binaryData);
  });

  it("handles unicode filenames correctly", async () => {
    const zip = createZip();
    zip.addFile("文件.txt", "Chinese content");
    zip.addFile("файл.txt", "Cyrillic content");

    const zipPath = await writeZip(zip);
    await unzip(zipPath);

    await expectFileContent("文件.txt", "Chinese content");
    await expectFileContent("файл.txt", "Cyrillic content");
  });

  it("unzips large compressed files correctly", async () => {
    const zip = createZip();
    const largeContent =
      "This is a test sentence that will be repeated many times.\n".repeat(
        1000,
      );
    zip.addFile("large.txt", largeContent);

    const zipPath = await writeZip(zip);
    await unzip(zipPath);

    await expectFileContent("large.txt", largeContent);
    await expectFileSize("large.txt", largeContent.length);
  });

  it("lists correct files using unzip -l", async () => {
    const zip = createZip();
    zip.addFile("file1.txt", "Content 1");
    zip.addFile("file2.txt", "Content 2");
    zip.addFile("nested/file3.txt", "Content 3");

    const zipPath = await writeZip(zip);
    const result = await unzipInMemory(zipPath);

    // Verify all filenames are listed
    expect(result).toContain("file1.txt");
    expect(result).toContain("file2.txt");
    expect(result).toContain("nested/file3.txt");
    expect(result).toContain("3 files");
  });
});
