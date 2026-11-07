"""Own a render attempt and expose its plan only after a verified complete render.

An interrupted attempt deliberately keeps its .pending directory: Resolve may still
be writing there after this Python process exits. Never delete or reuse it blindly.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import time


class RenderArtifacts:
    def __init__(self, media, slug, version):
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", slug) or type(version) is not int or version < 1:
            raise ValueError("Use a guide slug and a positive version number")
        root = Path(media) / slug / "renders"
        root.mkdir(parents=True, exist_ok=True)
        self.name = f"{slug}-guide-v{version}"
        self.video = root / f"{self.name}.mp4"
        self.plan = root / f"{self.name}.plan.json"
        self.pending = root / f".{self.name}.pending"
        self._check_unused()
        # Atomic reservation; stale attempts are evidence, not permission to retry.
        self.pending.mkdir()
        self._check_unused()
        print(f"Render attempt: {self.pending}", flush=True)
        self.staged_video = self.pending / self.video.name
        self.receipt = {"status": "not_rendered"}

    def _check_unused(self):
        if os.path.lexists(self.video) or os.path.lexists(self.plan):
            raise FileExistsError(f"Version already has render artifacts: {self.name}; use a new version")

    def render(self, project):
        if project.IsRenderingInProgress():
            raise RuntimeError("Resolve is already rendering; no new job was started")
        if not project.SetCurrentRenderFormatAndCodec("mp4", "H264"):
            raise RuntimeError("Resolve rejected the render format")
        if not project.SetRenderSettings({"SelectAllFrames": True, "TargetDir": str(self.pending),
                "CustomName": self.name, "FormatWidth": 1920, "FormatHeight": 1080, "FrameRate": 30,
                "VideoQuality": 12000, "ExportVideo": True, "ExportAudio": True, "AudioCodec": "aac",
                "AudioBitDepth": 16, "AudioSampleRate": 48000}):
            raise RuntimeError("Resolve rejected the render settings")
        job = project.AddRenderJob()
        if not job:
            raise RuntimeError("Resolve did not create a render job")
        (self.pending / "job.json").write_text(json.dumps({"job": job}, indent=2))
        if not project.StartRendering([job], False):
            raise RuntimeError(f"Resolve did not start render job {job}; inspect {self.pending}")
        # On KeyboardInterrupt or process death, leave the job/output alone. StopRendering
        # is project-wide and could stop someone else's work; no final plan is exposed.
        while project.IsRenderingInProgress():
            time.sleep(2)
        status = project.GetRenderJobStatus(job)
        if not isinstance(status, dict) or status.get("JobStatus") != "Complete":
            raise RuntimeError(f"Render job {job} did not complete: {status}; inspect {self.pending}")
        info = self.staged_video.lstat()
        if not stat.S_ISREG(info.st_mode) or not info.st_size:
            raise RuntimeError("Completed render has no nonempty regular video file")
        with self.staged_video.open("rb") as f:
            opened = os.fstat(f.fileno())
            if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                raise RuntimeError("Render file changed during verification")
            checksum = hashlib.sha256()
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                checksum.update(chunk)
            after = os.fstat(f.fileno())
            if (after.st_size, after.st_mtime_ns) != (opened.st_size, opened.st_mtime_ns):
                raise RuntimeError("Render file changed during verification")
            digest = checksum.hexdigest()
        self.receipt = {"status": "complete", "file": self.video.name, "bytes": info.st_size, "sha256": digest}
        return status

    def commit(self, plan):
        saved = {**plan, "schema_version": 3, "render": self.receipt}
        staged_plan = self.pending / self.plan.name
        with staged_plan.open("x") as f:
            json.dump(saved, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        self._check_unused()
        if self.receipt["status"] == "complete":
            # Exclusive links never overwrite an older artifact. The plan is the commit
            # marker: a crash between links leaves an unpublishable video, not a false plan.
            os.link(self.staged_video, self.video)
        os.link(staged_plan, self.plan)
        shutil.rmtree(self.pending)
