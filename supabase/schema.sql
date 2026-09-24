-- 新しいSupabaseプロジェクトのSQL Editorで実行してください。
-- 既に旧プロトタイプのスキーマを実行済みの場合は、データを残したまま移行するSQLを別途用意します。

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 30),
  role text not null default 'member' check (role in ('member', 'admin')),
  created_at timestamptz not null default now()
);
create table public.topics (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 100),
  description text check (char_length(description) <= 280),
  author_id uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id),
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create table public.post_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)));
  return new;
end;
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
create or replace function public.prevent_ownership_change()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.author_id is distinct from old.author_id then raise exception 'author_id cannot be changed'; end if;
  return new;
end;
$$;
create or replace function public.prevent_post_relationship_change()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.author_id is distinct from old.author_id or new.topic_id is distinct from old.topic_id then raise exception 'post ownership and topic cannot be changed'; end if;
  return new;
end;
$$;
create or replace function public.prevent_comment_relationship_change()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.author_id is distinct from old.author_id or new.post_id is distinct from old.post_id then raise exception 'comment ownership and post cannot be changed'; end if;
  return new;
end;
$$;
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
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
create trigger topics_keep_author before update on public.topics for each row execute procedure public.prevent_ownership_change();
create trigger posts_keep_relationship before update on public.posts for each row execute procedure public.prevent_post_relationship_change();
create trigger comments_keep_relationship before update on public.comments for each row execute procedure public.prevent_comment_relationship_change();
create trigger posts_update_topic_activity after insert on public.posts for each row execute procedure public.touch_topic_activity_from_post();
create trigger comments_update_topic_activity after insert on public.comments for each row execute procedure public.touch_topic_activity_from_comment();

alter table public.profiles enable row level security;
alter table public.topics enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.post_images enable row level security;
create policy "Authenticated users read profiles" on public.profiles for select to authenticated using (true);
create policy "Authenticated users read topics" on public.topics for select to authenticated using (true);
create policy "Authenticated users create topics" on public.topics for insert to authenticated with check (author_id = auth.uid());
create policy "Authors and admins edit topics" on public.topics for update to authenticated using (author_id = auth.uid() or public.is_admin()) with check (author_id = auth.uid() or public.is_admin());
create policy "Admins delete topics" on public.topics for delete to authenticated using (public.is_admin());
create policy "Authenticated users read posts" on public.posts for select to authenticated using (true);
create policy "Authenticated users create posts" on public.posts for insert to authenticated with check (author_id = auth.uid());
create policy "Authors and admins edit posts" on public.posts for update to authenticated using (author_id = auth.uid() or public.is_admin()) with check (author_id = auth.uid() or public.is_admin());
create policy "Authors and admins delete posts" on public.posts for delete to authenticated using (author_id = auth.uid() or public.is_admin());
create policy "Authenticated users read comments" on public.comments for select to authenticated using (true);
create policy "Authenticated users create comments" on public.comments for insert to authenticated with check (author_id = auth.uid());
create policy "Authors and admins edit comments" on public.comments for update to authenticated using (author_id = auth.uid() or public.is_admin()) with check (author_id = auth.uid() or public.is_admin());
create policy "Authors and admins delete comments" on public.comments for delete to authenticated using (author_id = auth.uid() or public.is_admin());
create policy "Authenticated users read image records" on public.post_images for select to authenticated using (true);
create policy "Post authors add image records" on public.post_images for insert to authenticated with check (exists (select 1 from public.posts where id = post_id and author_id = auth.uid()));
create policy "Admins add image records" on public.post_images for insert to authenticated with check (public.is_admin());
create policy "Post authors and admins delete image records" on public.post_images for delete to authenticated using (exists (select 1 from public.posts where id = post_id and (author_id = auth.uid() or public.is_admin())));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-images', 'post-images', false, 5242880, array['image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/webp'];
create policy "Authenticated users read post images" on storage.objects for select to authenticated using (bucket_id = 'post-images');
create policy "Users upload their own post images" on storage.objects for insert to authenticated with check (bucket_id = 'post-images' and (storage.foldername(name))[1] = (select auth.uid()::text) and storage.extension(name) = 'webp');
create policy "Owners and admins delete post images" on storage.objects for delete to authenticated using (bucket_id = 'post-images' and (owner_id = (select auth.uid()::text) or public.is_admin()));

create index posts_topic_created_at_idx on public.posts (topic_id, created_at);
create index topics_last_activity_at_idx on public.topics (last_activity_at desc);
create index comments_post_created_at_idx on public.comments (post_id, created_at);
create index post_images_post_id_idx on public.post_images (post_id);
