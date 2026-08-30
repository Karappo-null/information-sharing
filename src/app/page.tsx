"use client";
/* eslint-disable @next/next/no-img-element */

import { FormEvent, useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { prepareImage, MAX_IMAGE_COUNT } from "@/lib/image";

type Role = "member" | "admin";
type Profile = { id: string; display_name: string; role: Role };
type Topic = { id: string; title: string; description: string | null; author_id: string; created_at: string; profiles: Profile[] | null };
type ImageRecord = { id: string; storage_path: string };
type Comment = { id: string; post_id: string; author_id: string; body: string; created_at: string; profiles: Profile[] | null };
type Post = { id: string; topic_id: string; author_id: string; body: string; created_at: string; profiles: Profile[] | null; post_images: ImageRecord[] | null; comments: Comment[] };
type CurrentUser = Profile & { email: string | null };

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const supabase = url && key ? createBrowserClient(url, key) : null;
const bucket = "post-images";

export default function Home() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [authReady, setAuthReady] = useState(() => !supabase);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [activeTopic, setActiveTopic] = useState<Topic | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"signIn" | "signUp">("signIn");
  const [topicForm, setTopicForm] = useState<"create" | "edit" | null>(null);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [editingComment, setEditingComment] = useState<Comment | null>(null);
  const [busy, setBusy] = useState(false);
  const isAdmin = currentUser?.role === "admin";

  async function setSignedInUser(user: User | null) {
    if (!supabase || !user) {
      setCurrentUser(null); setTopics([]); setActiveTopic(null); setPosts([]);
      setImageUrls((previous) => { Object.values(previous).forEach(URL.revokeObjectURL); return {}; });
      return;
    }
    const { data, error } = await supabase.from("profiles").select("id,display_name,role").eq("id", user.id).single();
    if (error) { setNotice("プロフィールを読み込めませんでした。Supabaseのスキーマ設定を確認してください。"); return setCurrentUser(null); }
    setCurrentUser({ ...(data as Profile), email: user.email ?? null });
  }
  async function loadImageUrls(records: ImageRecord[]) {
    if (!supabase) return;
    const loaded = await Promise.all(records.map(async (image) => {
      const { data } = await supabase.storage.from(bucket).download(image.storage_path);
      return data ? [image.id, URL.createObjectURL(data)] as const : null;
    }));
    setImageUrls((previous) => { Object.values(previous).forEach(URL.revokeObjectURL); return Object.fromEntries(loaded.filter((v): v is readonly [string, string] => v !== null)); });
  }
  async function loadPosts(topic: Topic) {
    if (!supabase) return;
    const { data: postData, error: postError } = await supabase.from("posts").select("id,topic_id,author_id,body,created_at,profiles!posts_author_id_fkey(id,display_name,role),post_images(id,storage_path)").eq("topic_id", topic.id).order("created_at");
    if (postError) return setNotice(postError.message);
    const basePosts = (postData ?? []) as unknown as Omit<Post, "comments">[];
    const ids = basePosts.map((post) => post.id);
    const { data: commentData, error: commentError } = ids.length === 0 ? { data: [], error: null } : await supabase.from("comments").select("id,post_id,author_id,body,created_at,profiles!comments_author_id_fkey(id,display_name,role)").in("post_id", ids).order("created_at");
    if (commentError) return setNotice(commentError.message);
    const comments = (commentData ?? []) as unknown as Comment[];
    const nextPosts = basePosts.map((post) => ({ ...post, comments: comments.filter((comment) => comment.post_id === post.id) }));
    setPosts(nextPosts); await loadImageUrls(nextPosts.flatMap((post) => post.post_images ?? []));
  }
  async function loadTopics() {
    if (!supabase) return;
    const { data, error } = await supabase.from("topics").select("id,title,description,author_id,created_at,profiles!topics_author_id_fkey(id,display_name,role)").order("created_at", { ascending: false });
    if (error) return setNotice(error.message);
    const nextTopics = (data ?? []) as unknown as Topic[];
    setTopics(nextTopics);
    if (nextTopics.length === 0) { setActiveTopic(null); setPosts([]); return; }
    const selected = activeTopic && nextTopics.find((topic) => topic.id === activeTopic.id) || nextTopics[0];
    setActiveTopic(selected); await loadPosts(selected);
  }
  async function selectTopic(topic: Topic) { setActiveTopic(topic); await loadPosts(topic); }

  useEffect(() => {
    if (!supabase) return;
    const start = async () => { const { data } = await supabase.auth.getUser(); await setSignedInUser(data.user); setAuthReady(true); };
    void start();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => { void setSignedInUser(session?.user ?? null); });
    return () => listener.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (currentUser) void Promise.resolve().then(loadTopics);
    // The effect intentionally runs only when the authenticated user identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return;
    const form = new FormData(event.currentTarget); const email = String(form.get("email")).trim(); const password = String(form.get("password")); const displayName = String(form.get("display_name") ?? "").trim();
    setBusy(true);
    const result = authMode === "signUp" ? await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName } } }) : await supabase.auth.signInWithPassword({ email, password });
    setBusy(false); if (result.error) return setNotice(result.error.message);
    await setSignedInUser(result.data.user);
    if (authMode === "signUp") setNotice("登録しました。");
  }
  async function saveTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase || !currentUser) return;
    const form = new FormData(event.currentTarget); const values = { title: String(form.get("title")).trim(), description: String(form.get("description")).trim() || null };
    setBusy(true); const result = topicForm === "edit" && activeTopic ? await supabase.from("topics").update(values).eq("id", activeTopic.id) : await supabase.from("topics").insert(values); setBusy(false);
    if (result.error) return setNotice(result.error.message); setTopicForm(null); await loadTopics();
  }
  async function deleteTopic() {
    if (!supabase || !activeTopic || !isAdmin || !window.confirm(`「${activeTopic.title}」を削除します。配下の投稿・コメント・画像も削除されます。`)) return;
    setBusy(true); const paths = posts.flatMap((post) => post.post_images ?? []).map((image) => image.storage_path);
    if (paths.length) { const { error } = await supabase.storage.from(bucket).remove(paths); if (error) { setBusy(false); return setNotice(error.message); } }
    const { error } = await supabase.from("topics").delete().eq("id", activeTopic.id); setBusy(false);
    if (error) return setNotice(error.message); setNotice("Topicを削除しました。"); await loadTopics();
  }
  async function createPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase || !activeTopic || !currentUser) return;
    const postForm = event.currentTarget;
    const form = new FormData(postForm); const body = String(form.get("body")).trim(); const files = Array.from(form.getAll("images")).filter((value): value is File => value instanceof File && value.size > 0);
    if (!body) return; if (files.length > MAX_IMAGE_COUNT) return setNotice(`画像は最大${MAX_IMAGE_COUNT}枚です。`);
    try {
      setBusy(true); const images = await Promise.all(files.map(prepareImage));
      const { data: post, error: postError } = await supabase.from("posts").insert({ topic_id: activeTopic.id, body }).select("id").single();
      if (postError || !post) throw new Error(postError?.message ?? "投稿を作成できませんでした。");
      const uploadedPaths: string[] = [];
      try {
        for (const image of images) { const path = `${currentUser.id}/${post.id}/${crypto.randomUUID()}.webp`; const { error } = await supabase.storage.from(bucket).upload(path, image.file, { contentType: "image/webp", upsert: false }); if (error) throw error; uploadedPaths.push(path); }
        if (uploadedPaths.length) { const { error } = await supabase.from("post_images").insert(uploadedPaths.map((storage_path) => ({ post_id: post.id, storage_path }))); if (error) throw error; }
      } catch (error) { if (uploadedPaths.length) await supabase.storage.from(bucket).remove(uploadedPaths); await supabase.from("posts").delete().eq("id", post.id); throw error; }
      postForm.reset(); await loadPosts(activeTopic);
    } catch (error) { setNotice(error instanceof Error ? error.message : "投稿を保存できませんでした。"); } finally { setBusy(false); }
  }
  async function updatePost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase || !editingPost) return;
    const body = String(new FormData(event.currentTarget).get("body")).trim(); if (!body) return;
    setBusy(true); const { error } = await supabase.from("posts").update({ body }).eq("id", editingPost.id); setBusy(false);
    if (error) return setNotice(error.message); setEditingPost(null); if (activeTopic) await loadPosts(activeTopic);
  }
  async function deletePost(post: Post) {
    if (!supabase || !window.confirm("この投稿と画像・コメントを削除します。")) return;
    setBusy(true); const paths = (post.post_images ?? []).map((image) => image.storage_path);
    if (paths.length) { const { error } = await supabase.storage.from(bucket).remove(paths); if (error) { setBusy(false); return setNotice(error.message); } }
    const { error } = await supabase.from("posts").delete().eq("id", post.id); setBusy(false);
    if (error) return setNotice(error.message); if (activeTopic) await loadPosts(activeTopic);
  }
  async function deleteImage(image: ImageRecord) {
    if (!supabase || !window.confirm("この画像を削除します。")) return;
    setBusy(true); const { error: storageError } = await supabase.storage.from(bucket).remove([image.storage_path]);
    if (storageError) { setBusy(false); return setNotice(storageError.message); }
    const { error } = await supabase.from("post_images").delete().eq("id", image.id); setBusy(false);
    if (error) return setNotice(error.message); if (activeTopic) await loadPosts(activeTopic);
  }
  async function saveComment(event: FormEvent<HTMLFormElement>, postId?: string) {
    event.preventDefault(); if (!supabase) return;
    const body = String(new FormData(event.currentTarget).get("body")).trim(); if (!body) return;
    setBusy(true); const result = editingComment ? await supabase.from("comments").update({ body }).eq("id", editingComment.id) : await supabase.from("comments").insert({ post_id: postId, body }); setBusy(false);
    if (result.error) return setNotice(result.error.message); setEditingComment(null); event.currentTarget.reset(); if (activeTopic) await loadPosts(activeTopic);
  }
  async function deleteComment(comment: Comment) {
    if (!supabase || !window.confirm("このコメントを削除します。")) return;
    setBusy(true); const { error } = await supabase.from("comments").delete().eq("id", comment.id); setBusy(false);
    if (error) return setNotice(error.message); if (activeTopic) await loadPosts(activeTopic);
  }

  if (!supabase) return <Setup />;
  if (!authReady) return <Loading />;
  if (!currentUser) return <AuthScreen mode={authMode} setMode={setAuthMode} submit={authenticate} busy={busy} />;
  return <main className="min-h-screen bg-[#f6f8f7] text-[#16251f]"><header className="border-b border-[#dce5df] bg-white px-5 py-4 sm:px-8"><div className="mx-auto flex max-w-6xl items-center justify-between"><span className="text-xl font-bold">Shareboard<span className="text-[#3460fb]"></span></span><div className="flex items-center gap-3 text-sm"><span className="hidden text-[#537064] sm:block">{currentUser.display_name}{isAdmin && "（管理者）"}</span><button className="rounded-full border border-[#cbd9d0] px-4 py-2" onClick={() => void supabase.auth.signOut()}>ログアウト</button></div></div></header>
    <div className="mx-auto grid max-w-6xl gap-6 px-5 py-8 sm:px-8 lg:grid-cols-[300px_1fr]"><aside className="rounded-2xl border border-[#dce5df] bg-white p-4 shadow-sm lg:h-fit"><div className="mb-4 flex justify-between"><h1 className="font-semibold">トピック</h1><button className="text-sm font-semibold text-[#3460fb]" onClick={() => setTopicForm("create")}>＋ 作成</button></div>{topics.length === 0 ? <p className="py-6 text-sm leading-6 text-[#71847b]">まだトピックがありません。最初の話題を作ってみましょう。</p> : <nav className="space-y-1">{topics.map((topic) => <button key={topic.id} onClick={() => void selectTopic(topic)} className={`w-full rounded-xl px-3 py-3 text-left text-sm ${activeTopic?.id === topic.id ? "bg-[#eff6ff] font-semibold text-[#3460fb]" : "hover:bg-[#f4f7f5]"}`}><span className="block truncate">{topic.title}</span>{topic.description && <span className="mt-1 block truncate text-xs font-normal text-[#71847b]">{topic.description}</span>}</button>)}</nav>}</aside>
      <section>{activeTopic ? <><div className="mb-5"><p className="mb-2 text-sm font-semibold text-[#3460fb]">DISCUSSION</p><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-3xl font-bold sm:text-4xl">{activeTopic.title}</h2><p className="mt-2 text-sm text-[#71847b]">作成者: {activeTopic.profiles?.[0]?.display_name ?? "メンバー"}</p></div><div className="flex gap-2"><button className="rounded-full border border-[#cbd9d0] px-3 py-2 text-sm" onClick={() => setTopicForm("edit")}>編集</button>{isAdmin && <button className="rounded-full border border-red-200 px-3 py-2 text-sm text-red-700" onClick={() => void deleteTopic()} disabled={busy}>削除</button>}</div></div>{activeTopic.description && <p className="mt-3 text-[#537064]">{activeTopic.description}</p>}</div><div className="mb-4 text-sm text-[#71847b]">{posts.length} 件の投稿</div><div className="space-y-3">{posts.length === 0 ? <EmptyPosts /> : posts.map((post) => <PostCard key={post.id} post={post} user={currentUser} isAdmin={isAdmin} imageUrls={imageUrls} onEdit={setEditingPost} onDelete={deletePost} onDeleteImage={deleteImage} onEditComment={setEditingComment} onDeleteComment={deleteComment} onSaveComment={saveComment} busy={busy} />)}</div><form onSubmit={createPost} className="mt-5 rounded-2xl border border-[#dce5df] bg-white p-4 shadow-sm"><label className="mb-2 block text-sm font-semibold">投稿を書く</label><textarea name="body" required maxLength={5000} rows={4} placeholder="共有したいこと、質問、補足などを書いてください" className="w-full rounded-xl border border-[#cbd9d0] p-3 text-sm" /><label className="mt-3 block text-sm text-[#537064]">画像（任意・最大4枚・JPEG／PNG／WebP・各5MBまで）<input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple className="mt-2 block w-full text-sm" /></label><div className="mt-3 flex justify-end"><button disabled={busy} className="rounded-full bg-[#3460fb] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "保存中…" : "投稿"}</button></div></form></> : <div className="rounded-2xl border border-dashed border-[#cbd9d0] bg-white p-12 text-center"><h2 className="text-xl font-bold">共有を始めましょう</h2><p className="mt-2 text-sm text-[#71847b]">左側からトピックを作成すると、投稿を追加できます。</p></div>}</section></div>
    {notice && <Notice text={notice} close={() => setNotice(null)} />}{topicForm && <TopicDialog mode={topicForm} topic={activeTopic} close={() => setTopicForm(null)} submit={saveTopic} busy={busy} />}{editingPost && <PostDialog post={editingPost} close={() => setEditingPost(null)} submit={updatePost} busy={busy} />}{editingComment && <CommentDialog comment={editingComment} close={() => setEditingComment(null)} submit={(event) => saveComment(event)} busy={busy} />}
  </main>;
}

function PostCard({ post, user, isAdmin, imageUrls, onEdit, onDelete, onDeleteImage, onEditComment, onDeleteComment, onSaveComment, busy }: { post: Post; user: CurrentUser; isAdmin: boolean; imageUrls: Record<string, string>; onEdit: (post: Post) => void; onDelete: (post: Post) => void; onDeleteImage: (image: ImageRecord) => void; onEditComment: (comment: Comment) => void; onDeleteComment: (comment: Comment) => void; onSaveComment: (event: FormEvent<HTMLFormElement>, postId: string) => void; busy: boolean }) {
  const canEdit = isAdmin || post.author_id === user.id;
  return <article className="rounded-2xl border border-[#dce5df] bg-white p-5 shadow-sm"><div className="mb-2 flex items-start justify-between gap-3 text-sm"><div><span className="font-semibold">{post.profiles?.[0]?.display_name ?? "メンバー"}</span>{post.profiles?.[0]?.role === "admin" && <span className="ml-2 text-xs text-[#3460fb]">管理者</span>}</div><div className="flex items-center gap-2"><time className="text-xs text-[#71847b]">{formatDate(post.created_at)}</time>{canEdit && <><button className="text-xs text-[#3460fb]" onClick={() => onEdit(post)}>編集</button><button className="text-xs text-red-700" onClick={() => void onDelete(post)} disabled={busy}>削除</button></>}</div></div><p className="whitespace-pre-wrap leading-7 text-[#30463b]">{post.body}</p>{post.post_images && post.post_images.length > 0 && <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{post.post_images.map((image) => <div key={image.id} className="relative overflow-hidden rounded-xl bg-[#eef3f0]">{imageUrls[image.id] ? <img src={imageUrls[image.id]} alt="投稿に添付された画像" className="aspect-square h-full w-full object-cover" /> : <div className="aspect-square animate-pulse" />}{canEdit && <button className="absolute right-1 top-1 rounded bg-white/90 px-2 py-1 text-xs text-red-700" onClick={() => void onDeleteImage(image)} disabled={busy}>画像を削除</button>}</div>)}</div>}<div className="mt-5 border-t border-[#e4ebe6] pt-4"><h3 className="text-sm font-semibold">コメント（{post.comments.length}）</h3><div className="mt-3 space-y-3">{post.comments.map((comment) => { const canEditComment = isAdmin || comment.author_id === user.id; return <div key={comment.id} className="rounded-xl bg-[#f4f7f5] p-3 text-sm"><div className="flex justify-between gap-3"><span className="font-semibold">{comment.profiles?.[0]?.display_name ?? "メンバー"}</span><span className="flex gap-2 text-xs text-[#71847b]"><time>{formatDate(comment.created_at)}</time>{canEditComment && <><button className="text-[#3460fb]" onClick={() => onEditComment(comment)}>編集</button><button className="text-red-700" onClick={() => void onDeleteComment(comment)} disabled={busy}>削除</button></>}</span></div><p className="mt-1 whitespace-pre-wrap leading-6">{comment.body}</p></div>; })}</div><form className="mt-3 flex gap-2" onSubmit={(event) => onSaveComment(event, post.id)}><input name="body" required maxLength={2000} placeholder="コメントを書く" className="min-w-0 flex-1 rounded-xl border border-[#cbd9d0] px-3 py-2 text-sm" /><button disabled={busy} className="rounded-xl border border-[#cbd9d0] px-3 text-sm font-semibold text-[#3460fb] disabled:opacity-50">送信</button></form></div></article>;
}
function AuthScreen({ mode, setMode, submit, busy }: { mode: "signIn" | "signUp"; setMode: (mode: "signIn" | "signUp") => void; submit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean }) { return <main className="grid min-h-screen place-items-center bg-[#f6f8f7] p-5 text-[#16251f]"><div className="w-full max-w-md rounded-2xl border border-[#dce5df] bg-white p-7 shadow-sm"><p className="text-sm font-semibold text-[#3460fb]">SHAREBOARD</p><h1 className="mt-2 text-2xl font-bold">{mode === "signUp" ? "アカウントを作成" : "ログイン"}</h1><p className="mt-2 text-sm leading-6 text-[#537064]">ログインすると内容を閲覧できます。</p><form className="mt-6 space-y-3" onSubmit={submit}>{mode === "signUp" && <input name="display_name" required minLength={1} maxLength={30} placeholder="表示名（1〜30文字）" className="w-full rounded-xl border border-[#cbd9d0] p-3 text-sm" />}<input name="email" type="email" required placeholder="メールアドレス" className="w-full rounded-xl border border-[#cbd9d0] p-3 text-sm" /><input name="password" type="password" required minLength={6} placeholder="パスワード（6文字以上）" className="w-full rounded-xl border border-[#cbd9d0] p-3 text-sm" /><button disabled={busy} className="w-full rounded-xl bg-[#3460fb] p-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "処理中…" : mode === "signUp" ? "登録する" : "ログイン"}</button></form><button className="mt-4 text-sm text-[#3460fb]" onClick={() => setMode(mode === "signUp" ? "signIn" : "signUp")}>{mode === "signUp" ? "すでにアカウントをお持ちの方" : "アカウントを作成"}</button></div></main>; }
function Modal({ children, close }: { children: React.ReactNode; close: () => void }) { return <div className="fixed inset-0 z-10 grid place-items-center bg-[#16251f]/40 p-5"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"><button aria-label="閉じる" onClick={close} className="float-right text-xl text-[#71847b]">×</button>{children}</div></div>; }
function TopicDialog({ mode, topic, close, submit, busy }: { mode: "create" | "edit"; topic: Topic | null; close: () => void; submit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean }) { return <Modal close={close}><h2 className="text-xl font-bold">{mode === "create" ? "トピックを作成" : "トピックを編集"}</h2><form className="mt-5 space-y-3" onSubmit={submit}><input name="title" required minLength={1} maxLength={100} defaultValue={mode === "edit" ? topic?.title : ""} placeholder="トピック名" className="w-full rounded-xl border border-[#cbd9d0] p-3 text-sm" /><textarea name="description" maxLength={280} rows={3} defaultValue={mode === "edit" ? topic?.description ?? "" : ""} placeholder="概要（任意）" className="w-full rounded-xl border border-[#cbd9d0] p-3 text-sm" /><button disabled={busy} className="w-full rounded-xl bg-[#3460fb] p-3 text-sm font-semibold text-white disabled:opacity-50">{mode === "create" ? "作成する" : "保存する"}</button></form></Modal>; }
function PostDialog({ post, close, submit, busy }: { post: Post; close: () => void; submit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean }) { return <Modal close={close}><h2 className="text-xl font-bold">投稿を編集</h2><form className="mt-5 space-y-3" onSubmit={submit}><textarea name="body" required maxLength={5000} rows={6} defaultValue={post.body} className="w-full rounded-xl border border-[#cbd9d0] p-3 text-sm" /><button disabled={busy} className="w-full rounded-xl bg-[#3460fb] p-3 text-sm font-semibold text-white disabled:opacity-50">保存する</button></form></Modal>; }
function CommentDialog({ comment, close, submit, busy }: { comment: Comment; close: () => void; submit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean }) { return <Modal close={close}><h2 className="text-xl font-bold">コメントを編集</h2><form className="mt-5 space-y-3" onSubmit={submit}><textarea name="body" required maxLength={2000} rows={4} defaultValue={comment.body} className="w-full rounded-xl border border-[#cbd9d0] p-3 text-sm" /><button disabled={busy} className="w-full rounded-xl bg-[#3460fb] p-3 text-sm font-semibold text-white disabled:opacity-50">保存する</button></form></Modal>; }
function Notice({ text, close }: { text: string; close: () => void }) { return <div role="status" className="fixed bottom-5 left-1/2 z-20 -translate-x-1/2 rounded-full bg-[#16251f] px-5 py-3 text-sm text-white shadow-lg">{text}<button aria-label="閉じる" onClick={close} className="ml-3">×</button></div>; }
function EmptyPosts() { return <div className="rounded-2xl border border-dashed border-[#cbd9d0] bg-white p-8 text-center text-sm text-[#71847b]">最初の投稿を追加して、会話を始めましょう。</div>; }
function Loading() { return <main className="grid min-h-screen place-items-center bg-[#f6f8f7] text-sm text-[#537064]">読み込み中…</main>; }
function Setup() { return <main className="grid min-h-screen place-items-center bg-[#f6f8f7] p-6 text-[#16251f]"><div className="max-w-lg rounded-2xl border border-[#dce5df] bg-white p-8 shadow-sm"><p className="text-sm font-semibold text-[#3460fb]">SHAREBOARD</p><h1 className="mt-2 text-3xl font-bold">Supabase を接続してください</h1><p className="mt-4 leading-7 text-[#537064]">環境変数を設定すると、ログイン、Topic、Post、画像添付を利用できます。</p><code className="mt-6 block rounded-xl bg-[#eef3f0] p-4 text-sm">NEXT_PUBLIC_SUPABASE_URL<br />NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code></div></main>; }
function formatDate(value: string) { return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
