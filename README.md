# Shareboard

友人グループ向けの、認証付き情報共有アプリです。Next.js / Supabase / Vercel で構成しています。

## 実装済みのMVP機能

- メールアドレス・パスワードによる登録とログイン
- 登録時の表示名（1〜30文字、重複可）
- Topicの作成・全ログインユーザーによる編集・管理者による削除
- Postの作成、投稿者本人または管理者による編集・削除
- Postに対する一段階コメント
- JPEG / PNG / WebP画像を最大4枚添付（選択時に各5MBまで）
  - ブラウザ内で長辺1920pxまで縮小し、WebP品質0.82へ変換してから保存
  - 元画像はSupabaseへ送信・保存しません

## Supabaseの設定

1. 新しいSupabaseプロジェクトを作成します。
2. SQL Editorで [`supabase/schema.sql`](./supabase/schema.sql) を実行します。
3. Authentication > Providers > Emailで、**Confirm Email** を無効にします。
4. Authentication > General Configurationで、登録受付の間だけ **Allow new users to sign up** を有効にします。友人の登録後は無効にしてください。
5. `.env.example` を `.env.local` にコピーし、Project URLとPublishable keyを設定します。

### 初期管理者の設定

自分のアカウントを登録してから、SQL Editorで以下のSQLを実行します。メールアドレスは自分のものに置き換えてください。

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'your-email@example.com');
```

管理者はTopicを削除でき、すべてのPost・コメント・画像を編集または削除できます。

## ローカル起動

```bash
npm run dev
```

## Vercelへのデプロイ

GitリポジトリをVercelに接続し、`NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` をEnvironment Variablesへ登録してください。Supabase AuthenticationのSite URLもVercelの公開URLへ変更します。
