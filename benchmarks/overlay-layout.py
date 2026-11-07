"""Bounded offline planner benchmark: no Resolve, media, dependencies or GPU.

Each measurement runs in a fresh Python process. --source can select a retained
scripts/edit_plan.py from an earlier commit without changing the worktree.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import resource
import subprocess
import sys
import time


def workload(kind, count):
    # Dense input is a stress bound, not a claim that ordinary guides need this
    # many simultaneous callouts. Sparse input checks normal long-guide cost.
    return [dict(file=f'{i}.mov', label=str(i), start=0 if kind == 'dense' else i,
                 length=1) for i in range(count)]


def measure(source, kind, count, trace=False):
    spec = importlib.util.spec_from_file_location('measured_plan', source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    spans = workload(kind, count)
    events = 0

    def on_line(frame, event, arg):
        nonlocal events
        if frame.f_code.co_filename == str(source) and event == 'line':
            events += 1
        return on_line

    if trace:
        sys.settrace(on_line)
    start = time.perf_counter()
    try:
        scheduled, title = module.layout_overlays(spans)
    finally:
        elapsed = time.perf_counter() - start
        sys.settrace(None)
    tracks = [o['track'] for o in scheduled]
    expected = list(range(2, count + 2)) if kind == 'dense' else [2] * count
    assert tracks == expected
    assert title == (max(4, count + 2) if kind == 'dense' else 4)
    assert all('track' not in o for o in spans)
    return dict(kind=kind, count=count, elapsed_ms=elapsed * 1000,
                peak_rss_mib=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024,
                python_line_events=events if trace else None,
                # Include all returned metadata as well as assignments and title.
                output_sha256=hashlib.sha256(json.dumps([scheduled, title], sort_keys=True).encode()).hexdigest())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parents[1]/'scripts/edit_plan.py')
    parser.add_argument('--sizes', nargs='+', type=int, default=[1000, 4000, 12000])
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--child', choices=['dense', 'sparse'])
    parser.add_argument('--trace', action='store_true')
    args = parser.parse_args()
    if not 1 <= args.repeats <= 5 or any(n < 1 or n > 20000 for n in args.sizes):
        parser.error('Use 1..5 repeats and counts in 1..20000')
    source = args.source.resolve()
    if args.child:
        print(json.dumps(measure(source, args.child, args.sizes[0], args.trace)))
        return
    for kind in ['sparse', 'dense']:
        for count in args.sizes:
            for repeat in range(args.repeats):
                result = subprocess.run([sys.executable, '-B', __file__, '--source', str(source),
                    '--child', kind, '--sizes', str(count)], check=True, capture_output=True, text=True, timeout=60)
                print(json.dumps({**json.loads(result.stdout), 'repeat':repeat + 1, 'source':str(source)}), flush=True)
    # Count actual Python line events separately; tracing overhead is excluded
    # from timings. This is not a count of native heap comparisons or CPU work.
    for count in [256, 512, 1024]:
        print(json.dumps({**measure(source, 'dense', count, trace=True), 'trace_only':True}), flush=True)


if __name__ == '__main__':
    main()
