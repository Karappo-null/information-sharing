-- 既存のSupabaseプロジェクトのSQL Editorで一度だけ実行してください。
alter table public.topics add column if not exists last_activity_at timestamptz;

update public.topics as topic
set last_activity_at = greatest(
  topic.created_at,
  coalesce((select max(post.created_at) from public.posts as post where post.topic_id = topic.id), topic.created_at),
  coalesce((select max(comment.created_at) from public.posts as post join public.comments as comment on comment.post_id = post.id where post.topic_id = topic.id), topic.created_at)
);

alter table public.topics alter column last_activity_at set default now();
alter table public.topics alter column last_activity_at set not null;

create or replace function public.touch_topic_activity_from_post()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.topics set last_activity_at = now() where id = new.topic_id;
  return new;
end;
$$;

create or replace function public.touch_topic_activity_from_comment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.topics set last_activity_at = now()
  where id = (select topic_id from public.posts where id = new.post_id);
  return new;
end;
$$;

drop trigger if exists posts_update_topic_activity on public.posts;
create trigger posts_update_topic_activity after insert on public.posts for each row execute procedure public.touch_topic_activity_from_post();
drop trigger if exists comments_update_topic_activity on public.comments;
create trigger comments_update_topic_activity after insert on public.comments for each row execute procedure public.touch_topic_activity_from_comment();

create index if not exists topics_last_activity_at_idx on public.topics (last_activity_at desc);
