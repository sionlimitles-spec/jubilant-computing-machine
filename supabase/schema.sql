-- ==========================================
-- 1. TABEL CONVERSATIONS
-- ==========================================
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  title text not null default 'Obrolan Baru',
  model text not null default 'gpt-4o-mini',
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ==========================================
-- 2. TABEL MESSAGES
-- ==========================================
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null default '',
  thinking text,
  image_url text,
  created_at timestamptz default now() not null
);

create index if not exists idx_conversations_user_id on public.conversations(user_id);
create index if not exists idx_messages_conversation_id on public.messages(conversation_id);

-- Trigger auto-update updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_conversations_updated_at on public.conversations;
create trigger trg_conversations_updated_at
  before update on public.conversations
  for each row execute function update_updated_at();

-- ==========================================
-- 3. ROW LEVEL SECURITY
-- ==========================================
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- Conversations policies
create policy "conv_select_own" on public.conversations
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "conv_insert_own" on public.conversations
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "conv_update_own" on public.conversations
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "conv_delete_own" on public.conversations
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Messages policies (via ownership conversation)
create policy "msg_select_own" on public.messages
  for select to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and c.user_id = (select auth.uid())
  ));

create policy "msg_insert_own" on public.messages
  for insert to authenticated
  with check (exists (
    select 1 from public.conversations c
    where c.id = conversation_id and c.user_id = (select auth.uid())
  ));

create policy "msg_update_own" on public.messages
  for update to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and c.user_id = (select auth.uid())
  ));

create policy "msg_delete_own" on public.messages
  for delete to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and c.user_id = (select auth.uid())
  ));

-- ==========================================
-- 4. STORAGE BUCKETS
-- ==========================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('chat-uploads', 'chat-uploads', true, 5242880,
   array['image/png','image/jpeg','image/webp','image/gif']),
  ('ai-generated', 'ai-generated', true, 5242880,
   array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

-- Storage policies
create policy "storage_public_read" on storage.objects
  for select using (bucket_id in ('chat-uploads','ai-generated'));

create policy "storage_auth_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('chat-uploads','ai-generated'));

create policy "storage_auth_delete" on storage.objects
  for delete to authenticated
  using (bucket_id in ('chat-uploads','ai-generated'));
