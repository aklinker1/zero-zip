<div align="center">

# `@aklinker1/zero-zip`

[![JSR](https://jsr.io/badges/@aklinker1/zero-zip)](https://jsr.io/@aklinker1/zero-zip)
[![NPM Version](https://img.shields.io/npm/v/%40aklinker1%2Fzero-zip?logo=npm&labelColor=red&color=white)](https://www.npmjs.com/package/@aklinker1/zero-zip)
[![API Reference](https://img.shields.io/badge/API%20Reference-blue?logo=readme&logoColor=white)](https://jsr.io/@aklinker1/zero-zip/doc)
[![License](https://img.shields.io/npm/l/%40aklinker1%2Fzero-zip)](https://github.com/aklinker1/zero-zip/blob/main/LICENSE)

Zero dependency, tiny util for creating ZIP files.

</div>

```sh
bun add @aklinker1/zero-zip
```

## Usage

```ts
import { writeFile } from "node:fs/promises"
import { createZip, type Zip } from '@aklinker1/zero-zip'

const zip = createZip();
zip.addFile("hello.txt", "Hello, world!")
const buffer = await zip.toBuffer()

await writeFile("example.zip", buffer)
```

## Supported Runtimes

- ✅ Node, Deno, Bun - any runtime with `node:zlib`
- ❌ Browser

## Features

- Compression options
- Files & files in directories

### Not Supported

- Unzipping
- Standalone directory entries
- Unix permissions not supported
