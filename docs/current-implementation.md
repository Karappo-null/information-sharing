# 現在の実装

最終更新: 2026-08-30

## 技術構成

- Next.js 16 / React 19
- Supabase Auth、Postgres Database、Storage
- Vercelへのデプロイを想定
- 画面は現在、主に `src/app/page.tsx` のクライアントコンポーネントとして実装

## 主なファイル

| ファイル | 担当 |
|---|---|
| `src/app/page.tsx` | 認証画面、Topic、Post、画像、コメントの画面とSupabase操作 |
| `src/lib/image.ts` | ブラウザ内での画像検査・縮小・WebP変換 |
| `supabase/schema.sql` | DBテーブル、関数、トリガー、RLS、Storage bucketとStorage RLS |
| `.env.example` | Supabase接続用の環境変数のひな形 |
| `README.md` | Supabase設定、初期管理者、ローカル起動、Vercel公開の手順 |

## データ構造

```text
auth.users (Supabaseが管理する認証ユーザー)
  └─ profiles (表示名、role)
       ├─ topics (作成者)
       ├─ posts (投稿者)
       └─ comments (投稿者)

topics
  └─ posts
       ├─ comments
       └─ post_images (Storage内の画像パス)
```

### テーブル

| テーブル | 主な内容 |
|---|---|
| `profiles` | `id`、`display_name`、`role`、作成日時 |
| `topics` | タイトル、概要、作成者、作成日時 |
| `posts` | 所属Topic、本文、投稿者、作成日時 |
| `comments` | 所属Post、本文、投稿者、作成日時 |
| `post_images` | 所属Post、Storage上の画像パス、作成日時 |

新規登録時にはDBトリガーが動き、`profiles` を自動作成する。新規ユーザーの `role` は `member`。

## 管理者

`profiles.role` が `admin` のユーザーを管理者として扱う。SQL Editorでの設定例:

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'your-email@example.com');
```

アプリ画面へ反映するには、設定後にページを再読み込みするか、ログアウトして再ログインする。

## RLSの実装

RLSは、画面のボタン表示だけではなく、データベースへの操作そのものを制限する仕組み。

| 対象 | 閲覧 | 作成 | 編集 | 削除 |
|---|---|---|---|---|
| Profile | ログイン済み全員 | 登録トリガーのみ | 不可 | 不可 |
| Topic | ログイン済み全員 | ログイン済み全員 | ログイン済み全員 | 管理者のみ |
| Post | ログイン済み全員 | ログイン済み全員 | 投稿者または管理者 | 投稿者または管理者 |
| Comment | ログイン済み全員 | ログイン済み全員 | 投稿者または管理者 | 投稿者または管理者 |
| 画像レコード | ログイン済み全員 | Post投稿者 | 不可 | Post投稿者または管理者 |
| Storage画像 | ログイン済み全員 | 画像アップロード者 | 不可 | 画像所有者または管理者 |

Topic、Post、コメントの作成者IDや親IDは、DBトリガーにより後から変更できない。

## 画像保存

- Storage bucket名: `post-images`
- bucketは非公開
- 保存形式はWebPのみ
- 保存パスは `ユーザーID/Post ID/ランダムID.webp`
- アプリは認証済みのStorageダウンロードで画像を表示するため、公開URLは利用しない。

## Supabase側の必要設定

1. `supabase/schema.sql` をSQL Editorで実行
2. AuthenticationのEmail providerでConfirm Emailを無効化
3. Registration中のみAllow new users to sign upを有効化
4. `.env.local` に `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` を設定

Publishable keyはブラウザで使用する前提のキー。Secret keyやService Role keyはブラウザ・`.env.local`・Gitへ置かない。

## 確認済みの動作

- ローカルでのアカウント登録とログイン
- Topic作成
- Post作成と再読み込み後の表示
- 管理者による全Postの編集・削除
- `npm run lint` と `npm run build` の成功

## 注意点

- `schema.sql` は新しい空のSupabaseプロジェクト向け。一度実行済みの旧プロトタイプDBを保ったまま更新する場合は、専用の移行SQLを作成する。
- 画像はブラウザで縮小するため、非常に大きい画像では端末に一時的な負荷がかかる可能性がある。
- 画像ファイルの削除はアプリ操作でStorageとDBレコードの両方を削除する。将来、サーバー側の削除処理を追加する場合は、孤立ファイル対策を再検討する。
