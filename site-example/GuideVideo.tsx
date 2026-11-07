"use client";

import { useEffect, useId, useRef, useState } from "react";

type Props = {
  src: string;
  name: string;
  className: string;
  poster?: string;
  captions?: string;
  preload: "none" | "metadata";
  muted?: boolean;
  loop?: boolean;
  writtenGuideId?: string;
};

// A refreshed signed URL or a different cut starts a separate media attempt.
export default function GuideVideo(props: Props) {
  return <VideoAttempt key={JSON.stringify([props.src, props.captions])} {...props} />;
}

function VideoAttempt({ src, name, className, poster, captions, preload, muted, loop, writtenGuideId }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const statusId = useId();
  const [state, setState] = useState<"idle" | "failed" | "retrying" | "ready">("idle");

  useEffect(() => {
    // An SSR video can fail before hydration attaches its error handler.
    if (video.current?.error) setState("failed");
  }, []);

  function retry() {
    setState("retrying");
    try {
      video.current?.load();
    } catch {
      setState("failed");
    }
  }

  const message = state === "failed"
    ? `${name}: could not load the video. Retry, or reload the page for a fresh media link.`
    : state === "retrying"
      ? `${name}: retrying. Playback will stay paused.`
      : state === "ready" ? `${name}: ready to play.` : "";

  return (
    <span className="gd-media">
      <video ref={video} className={className} src={src} poster={poster} controls playsInline
        crossOrigin={captions ? "anonymous" : undefined}
        preload={preload} muted={muted} loop={loop} aria-label={name} aria-describedby={statusId}
        onError={() => setState("failed")}
        onCanPlay={() => setState(current => current === "idle" ? current : "ready")}>
        {captions ? <track kind="captions" src={captions} srcLang="en" label="English" default /> : null}
      </video>
      <span id={statusId} className="gd-media-status" role="status" aria-atomic="true">{message}</span>
      {state !== "idle" ? (
        <span className="gd-media-actions">
          {/* Keep these controls mounted after recovery so keyboard focus survives. */}
          <button type="button" onClick={retry}>Retry video<span className="gd-sr-only">: {name}</span></button>
          {writtenGuideId ? (
            <a href={`#${writtenGuideId}`} onClick={event => {
              const details = document.getElementById(writtenGuideId);
              if (details instanceof HTMLDetailsElement) {
                event.preventDefault();
                details.open = true;
                details.querySelector("summary")?.focus();
              }
            }}>Open written guide<span className="gd-sr-only">: {name}</span></a>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
