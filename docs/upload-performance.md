# Resumable upload memory

The publisher reads large videos from disk one 6 MiB chunk at a time. Previously, `uploadResumable` in
`scripts/publish.mjs` read the entire video before issuing the first request, so its memory use grew with file size.
[`resumable-upload.mjs`](../scripts/resumable-upload.mjs) keeps one reusable source buffer and reads from an explicit
file offset. After a dropped request, it reads again from the server's acknowledged byte, including a partial chunk.
The upload threshold, metadata, replacement request and retry delays remain the same.

The chunk size follows [Supabase's resumable upload documentation](https://supabase.com/docs/guides/storage/uploads/resumable-uploads).
Offset validation follows the [TUS protocol](https://tus.io/protocols/resumable-upload): a successful PATCH acknowledges
all bytes sent, and HEAD reports where to resume. Missing, malformed or out-of-range offsets fail explicitly.

## Measurements

Measured November 6, 2026 on the DGX Spark (Linux arm64, Node 22.22.2). Each entry is the mean of two separate upload
processes. Peak RSS is the operating system's maximum resident memory for the upload process, including Node and
HTTP request buffers; it excludes the local HTTP sink in the parent process.

| Synthetic video size | Original peak RSS | Chunk reader peak RSS | Original elapsed | Chunk reader elapsed |
| --- | --- | --- | --- | --- |
| 32 MiB | 150.2 MiB | 118.2 MiB | 94 ms | 77 ms |
| 128 MiB | 274.3 MiB | 149.3 MiB | 246 ms | 229 ms |
| 256 MiB | 418.0 MiB | 156.8 MiB | 369 ms | 384 ms |

At 256 MiB, measured peak RSS falls by 62.5%. The source buffer is bounded at 6 MiB; total process memory still
includes `fetch` copies and garbage collection. These short loopback runs establish a memory improvement, not an
Internet upload speed improvement or a strict process memory ceiling. The 256 MiB case is slightly slower here.

The sink receives real HTTP requests and checks the final byte count and SHA-256 hash for every run. The fixtures
are sparse files with start/end markers. No Supabase project, credentials, GPU, media encoding or production files
are involved. Unit tests separately exercise partial receipt, lost acknowledgments, retry exhaustion, invalid
offsets, source truncation and the maximum backing-buffer size.

## Reproduce the comparison

Use Node 20 or later and a Git checkout containing baseline commit
`ae806ad56b4f8de75acc5b1969aa4dab64206d55`. The benchmark needs about 500 MiB of available memory, temporary disk
space and permission to listen on loopback. Run from the repository root:

```bash
node benchmarks/resumable-upload.mjs baseline
node benchmarks/resumable-upload.mjs patched
```

The baseline extracts the original uploader from that pinned commit. The patched mode imports the working uploader.
Both print JSON lines with input size, repetition, HTTP PATCH count, SHA-256, elapsed milliseconds and memory bytes.
Temporary inputs and the HTTP listener are cleaned up when the parent completes.

On the shared Spark, run both commands in one `build_slot.py` slot as described in the audit lane runbook.
Run the functional and memory regressions with the normal suite:

```bash
pnpm test
```

The measured boundary is the resumable transport. Remote Storage authorization, TLS, production bandwidth and the
rest of the publishing pipeline are outside this benchmark. The existing folder-mode publishing tests continue to
exercise the publishing CLI and extracted assets without remote writes.
