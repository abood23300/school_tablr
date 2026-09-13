-- شغّل هذا الملف مرة واحدة من: Supabase Dashboard -> SQL Editor -> New query
-- يُنشئ نظام الاشتراكات (تجربة محدودة المدة، حساب واحد لكل مستخدم عبر Supabase Auth)

-- 1) جدول الاشتراك: صف واحد لكل مستخدم، ينشأ تلقائيًا عند التسجيل
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  school_name text,
  status text not null default 'trial' check (status in ('trial', 'active', 'expired', 'canceled')),
  trial_ends_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

drop policy if exists "select own subscription" on public.subscriptions;
create policy "select own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- لا توجد سياسة insert/update/delete للمستخدم العادي عمدًا:
-- تمديد الاشتراك أو تفعيله يتم فقط من طرفك (صاحب المشروع) عبر SQL Editor
-- أو مفتاح service_role، بحيث لا يستطيع أي مستخدم تمديد تجربته بنفسه.

-- 2) دالة + trigger: إنشاء صف اشتراك تجريبي تلقائيًا عند تسجيل مستخدم جديد
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.subscriptions (user_id, trial_ends_at)
  values (new.id, now() + interval '14 days')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 3) جدول المشاريع (لمرحلة لاحقة: نقل بيانات الجدول من IndexedDB المحلي إلى السحابة)
-- غير مُفعّل الاستخدام في التطبيق بعد -- فقط جاهز للمرحلة الثانية.
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'مشروع جديد',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects enable row level security;

drop policy if exists "manage own projects while subscription valid" on public.projects;
create policy "manage own projects while subscription valid"
  on public.projects for all
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.subscriptions s
      where s.user_id = auth.uid()
        and (s.status = 'active' or (s.status = 'trial' and s.trial_ends_at > now()))
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.subscriptions s
      where s.user_id = auth.uid()
        and (s.status = 'active' or (s.status = 'trial' and s.trial_ends_at > now()))
    )
  );

-- ملاحظات للاستخدام اليومي:
--
-- إنشاء حساب لمدرسة جديدة (التسجيل الذاتي معطّل عمدًا -- أنت فقط من ينشئ الحسابات):
--   1) Supabase Dashboard -> Authentication -> Users -> Add user
--   2) أدخل بريد المدرسة وكلمة مرور، وفعّل "Auto Confirm User" حتى تدخل مباشرة بلا حاجة لتأكيد بريد
--   3) الـ trigger أعلاه سينشئ تلقائيًا صف اشتراك تجريبي لمدة 14 يومًا لهذا المستخدم
--   4) (اختياري) عدّل اسم المدرسة والمدة من هنا:
--      update public.subscriptions set school_name = 'اسم المدرسة' where user_id = '<uuid المستخدم>';
--
-- تمديد/تفعيل اشتراك مدرسة بعد الدفع:
--   update public.subscriptions set status = 'active' where user_id = '<uuid المستخدم>';
--
-- تمديد فترة تجريبية يدويًا:
--   update public.subscriptions set trial_ends_at = now() + interval '7 days' where user_id = '<uuid المستخدم>';
--
-- إيجاد uuid مستخدم عبر بريده الإلكتروني:
--   select id, email from auth.users where email = 'someone@example.com';
--
-- تعطيل التسجيل الذاتي من طرف الخادم أيضًا (وليس فقط بإخفاء الزر من الواجهة):
--   Authentication -> Sign In / Providers -> Email -> أطفئ "Allow new users to sign up"
--   هذا يمنع أي شخص من استدعاء signUp() مباشرة عبر الشبكة متجاوزًا الواجهة.
