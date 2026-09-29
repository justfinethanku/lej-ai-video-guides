-- The Guides page (/guides): one narrated video and one written guide per page of the app (see docs/publishing.md).
-- Text lives here so a guide can be corrected without a deploy; the videos, posters, screenshots and motion loops live
-- in the private Storage bucket `guides`, signed per visit by the page.
create table guides (
  slug text primary key,                  -- 'requests', 'settings', …: the page it explains
  position int not null,                  -- order on /guides, low first
  title text not null,                    -- the page's name as the nav shows it
  summary text not null,                  -- one line under the title: what the page is for
  video_path text,                        -- object in bucket `guides`, e.g. 'requests/v1/requests-guide-v1.mp4'
  poster_path text,                       -- the video's still before it plays
  video_seconds int,
  body_md text not null default '',       -- the written guide; ![alt](asset:<path>) images and .mp4 loops from the bucket
  as_of date not null,                    -- the day the guide matched the page; shown on /guides
  version int not null default 1,         -- bumped on every re-cut; matches the render's -vN suffix
  hidden boolean not null default false,
  updated_by text not null,
  updated_at timestamptz not null default now()
);
alter table guides enable row level security;
create policy service_role_all on guides for all to service_role using (true) with check (true);

insert into storage.buckets (id, name, public, file_size_limit)
values ('guides', 'guides', false, 1073741824)
on conflict (id) do nothing;
