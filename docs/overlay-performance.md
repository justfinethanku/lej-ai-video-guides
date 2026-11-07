# Callout allocation performance

The offline edit planner assigns callouts to tracks before connecting to Resolve. Dense overlap previously
made it scan every allocated track for each new callout. The planner now keeps busy tracks ordered by end
frame and released tracks ordered by track number, using Python's standard-library
[minimum heap operations](https://docs.python.org/3/library/heapq.html).

The lowest available track still wins, even if a higher track became available earlier. Frame rounding,
manifest order, metadata, input immutability, title placement and interval validation remain unchanged.
The planner still allocates one track per simultaneous callout; this change does not make a huge Resolve
timeline practical or change rendering time.

## Reproduce the measurements

Run from the repository root on Linux with Python 3. No package install, media, Resolve, browser or GPU
is needed. The benchmark limits workloads to 20,000 callouts and each child to 60 seconds.

Measure the current planner with three fresh processes per workload and size:

```bash
python3 -B benchmarks/overlay-layout.py > after.jsonl
```

To compare against the previous planner, save its source outside the worktree and select that file:

```bash
git show 1c8eacff6d142d30b1612454a42a23549c44c604:scripts/edit_plan.py > /tmp/overlay-plan-before.py
python3 -B benchmarks/overlay-layout.py --source /tmp/overlay-plan-before.py > before.jsonl
```

On a Fleet audit host, run each command through the host's required build-slot wrapper. The measurements
below used that wrapper, slow CPU cores and nice level 10 on a DGX Spark, Ubuntu 24.04 ARM64, Python 3.12.3.
No GPU work was performed.

## Observed results

November 7, 2026 measurements use the median of three fresh-process elapsed times. Timing includes only
`layout_overlays`; peak RSS covers the whole child process, including imports and synthetic input.
Dense input starts all callouts at time zero; sparse input uses one nonoverlapping callout per second.

| Input | Callouts | Before, ms | After, ms | Before peak RSS, MiB | After peak RSS, MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Sparse | 1,000 | 2.18 | 1.93 | 17.26 | 17.11 |
| Sparse | 4,000 | 6.81 | 6.01 | 19.45 | 19.29 |
| Sparse | 12,000 | 20.32 | 18.47 | 25.39 | 25.39 |
| Dense | 1,000 | 16.33 | 1.82 | 17.11 | 17.11 |
| Dense | 4,000 | 265.25 | 5.87 | 18.98 | 19.14 |
| Dense | 12,000 | 2,413.71 | 17.75 | 24.45 | 25.07 |

The benchmark asserts exact expected track assignments and title tracks. SHA-256 hashes of the complete
returned layouts match before and after at every size. Dense 12,000-callout allocation was about 136 times
faster in this sample. Sparse inputs showed no material regression in this sample. Peak memory remains
linear in input size; observed peak RSS rose about 0.62 MiB at the largest dense size measured.

Separate traced runs count actual Python line events in the planner module. At 256, 512 and 1,024 dense
callouts, the previous implementation executed 36,998, 139,526 and 541,190 events; the new implementation
executed 4,615, 9,223 and 18,439. These are reproducible Python execution counts, not total CPU operations:
they exclude comparisons inside native heap operations. Tracing overhead is excluded from the timing table.

This is a bounded synthetic scaling measurement, not a representative guide or an end-to-end render
benchmark. Shared-host activity and allocator behavior affect time and RSS. Normal guides use far fewer
simultaneous callouts. No live Resolve timeline, media encoding, caption generation or rendering speed was
measured. Caption publication remains separate from callout scheduling.

## Verify compatibility

Run the existing SDK integration and expanded allocation checks:

```bash
python3 -B tests/overlay-layout-fixture.py
```

The checks compare all returned fields against the previous scan policy over 200 deterministic randomized
manifests, exercise lowest-track reuse when tracks finish out of order, and allocate three touching waves
of 2,000 simultaneous callouts. Existing checks cover invalid intervals, rounding and the actual builder's
requests through a synthetic Resolve SDK. Native editor behavior remains unverified.
