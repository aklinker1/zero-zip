/**
 * Benchmarks memory usage when creating zips with `createZip`.
 *
 * For each scenario, it measures:
 *  - baseline memory before any work
 *  - memory retained after buffering all input files (`addFile`)
 *  - peak memory reached while compressing/building the zip (`toBuffer`)
 *  - memory after the zip's output buffer has been produced
 *
 * Run with: `bun run bench/memory.ts`
 *
 * Requires Bun (uses `Bun.gc()` to force GC for stable measurements).
 */
import { createZip } from "../index";

interface Scenario {
  name: string;
  count: number;
  size: number;
  kind: "text" | "random";
}

const KB = 1024;
const MB = 1024 * KB;

const scenarios: Scenario[] = [
  { name: "10,000 x 100 B  (text)", count: 10_000, size: 100, kind: "text" },
  { name: "1,000 x 1 KB    (text)", count: 1_000, size: 1 * KB, kind: "text" },
  {
    name: "1,000 x 1 KB  (random)",
    count: 1_000,
    size: 1 * KB,
    kind: "random",
  },
  { name: "100 x 100 KB    (text)", count: 100, size: 100 * KB, kind: "text" },
  { name: "10 x 5 MB       (text)", count: 10, size: 5 * MB, kind: "text" },
  { name: "10 x 5 MB     (random)", count: 10, size: 5 * MB, kind: "random" },
  { name: "1 x 50 MB       (text)", count: 1, size: 50 * MB, kind: "text" },
];

const TEXT_PHRASE =
  "The quick brown fox jumps over the lazy dog. Zero-zip memory benchmark.\n";

function makeTextContent(size: number): Buffer {
  const phrase = Buffer.from(TEXT_PHRASE, "utf8");
  const buf = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const n = Math.min(phrase.length, size - offset);
    phrase.copy(buf, offset, 0, n);
    offset += n;
  }
  return buf;
}

function makeRandomContent(size: number): Buffer {
  // crypto.getRandomValues has a 65536 byte limit per call, so fill in chunks.
  const buf = Buffer.alloc(size);
  const chunk = 65536;
  for (let offset = 0; offset < size; offset += chunk) {
    const view = buf.subarray(offset, Math.min(offset + chunk, size));
    crypto.getRandomValues(view);
  }
  return buf;
}

async function forceGc(): Promise<NodeJS.MemoryUsage> {
  // Run a couple of passes since a single gc() may not reclaim everything
  // (e.g. buffers referenced by not-yet-settled microtasks).
  Bun.gc(true);
  await Bun.sleep(10);
  Bun.gc(true);
  await Bun.sleep(10);
  return process.memoryUsage();
}

/** Runs `fn`, sampling `process.memoryUsage()` periodically to find the peak RSS reached. */
async function measurePeakDuring<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; peak: NodeJS.MemoryUsage }> {
  let peak = process.memoryUsage();

  const interval = setInterval(() => {
    const mem = process.memoryUsage();
    if (mem.rss > peak.rss) peak = mem;
  }, 5);

  try {
    const result = await fn();
    const mem = process.memoryUsage();
    if (mem.rss > peak.rss) peak = mem;
    return { result, peak };
  } finally {
    clearInterval(interval);
  }
}

interface ScenarioResult {
  scenario: Scenario;
  inputSize: number;
  outputSize: number;
  baseline: NodeJS.MemoryUsage;
  afterAdd: NodeJS.MemoryUsage;
  peak: NodeJS.MemoryUsage;
  afterToBuffer: NodeJS.MemoryUsage;
}

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const baseline = await forceGc();

  const zip = createZip();
  for (let i = 0; i < scenario.count; i++) {
    const content =
      scenario.kind === "text"
        ? makeTextContent(scenario.size)
        : makeRandomContent(scenario.size);
    zip.addFile(`file-${i}.txt`, content);
  }
  const afterAdd = process.memoryUsage();

  const { result: buffer, peak } = await measurePeakDuring(() =>
    zip.toBuffer(),
  );
  const afterToBuffer = process.memoryUsage();

  return {
    scenario,
    inputSize: scenario.count * scenario.size,
    outputSize: buffer.length,
    baseline,
    afterAdd,
    peak,
    afterToBuffer,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 0) return `-${formatBytes(-bytes)}`;
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`;
  if (bytes < 1024 * MB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / (1024 * MB)).toFixed(2)} GB`;
}

function printResults(results: ScenarioResult[]): void {
  const rows = results.map((r) => {
    const retained = r.afterAdd.rss - r.baseline.rss;
    const peakDelta = r.peak.rss - r.baseline.rss;
    const overhead = r.inputSize > 0 ? peakDelta / r.inputSize : 0;

    return {
      Scenario: r.scenario.name,
      "Input size": formatBytes(r.inputSize),
      "Output size": formatBytes(r.outputSize),
      "Retained after addFile (RSS)": formatBytes(retained),
      "Peak RSS delta": formatBytes(peakDelta),
      "Peak heapUsed delta": formatBytes(r.peak.heapUsed - r.baseline.heapUsed),
      "Peak/input ratio": `${overhead.toFixed(2)}x`,
    };
  });

  console.table(rows);
}

async function main() {
  console.log("Benchmarking zero-zip memory usage...\n");

  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    process.stdout.write(`Running: ${scenario.name}...\n`);
    results.push(await runScenario(scenario));
  }

  console.log();
  printResults(results);
}

await main();
