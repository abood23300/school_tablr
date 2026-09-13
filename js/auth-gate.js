// بوابة الوصول: تمنع استخدام التطبيق بدون تسجيل دخول واشتراك ساري
// التحقق الحقيقي يتم من قاعدة البيانات عبر RLS (راجع supabase/schema.sql) -- هذا الملف واجهة فقط.

(function () {
  const overlay = document.createElement('div');
  overlay.id = 'authGateOverlay';
  overlay.className = 'auth-gate-overlay';
  overlay.innerHTML = '<div class="auth-gate-box"><p>جارٍ التحقق من الحساب...</p></div>';
  document.body.appendChild(overlay);

  function renderBlocked(title, message, showLogout) {
    overlay.innerHTML = `
      <div class="auth-gate-box">
        <h2>${title}</h2>
        <p>${message}</p>
        ${showLogout ? '<button id="authGateLogoutBtn" class="primary">تسجيل الخروج</button>' : ''}
      </div>`;
    if (showLogout) {
      document.getElementById('authGateLogoutBtn').addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        window.location.href = 'login.html';
      });
    }
  }

  function renderAuthBar(email, subscription) {
    const bar = document.getElementById('authBar');
    if (!bar) return;
    let statusText = '';
    if (subscription.status === 'active') {
      statusText = 'اشتراك فعّال';
    } else {
      const daysLeft = Math.max(0, Math.ceil((new Date(subscription.trial_ends_at) - new Date()) / 86400000));
      statusText = `تجربة مجانية — متبقٍ ${daysLeft} يوم`;
    }
    bar.innerHTML = `
      <span>${email}</span>
      <span class="auth-bar-status">${statusText}</span>
      <button id="authGateLogoutBtnBar" class="btn">تسجيل الخروج</button>`;
    document.getElementById('authGateLogoutBtnBar').addEventListener('click', async () => {
      await supabaseClient.auth.signOut();
      window.location.href = 'login.html';
    });
  }

  async function checkAccess() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      window.location.href = 'login.html';
      return;
    }

    const { data: subscription, error } = await supabaseClient
      .from('subscriptions')
      .select('status, trial_ends_at')
      .eq('user_id', session.user.id)
      .single();

    if (error || !subscription) {
      renderBlocked('تعذّر التحقق من الاشتراك', 'حدث خطأ أثناء التحقق من حسابك. حاول تحديث الصفحة أو تواصل مع الدعم.', true);
      return;
    }

    const isTrialValid = subscription.status === 'trial' && new Date(subscription.trial_ends_at) > new Date();
    const isActive = subscription.status === 'active';

    if (!isTrialValid && !isActive) {
      renderBlocked('انتهت فترة الاستخدام', 'انتهت فترتك التجريبية أو اشتراكك. تواصل معنا لتفعيل/تجديد الاشتراك.', true);
      return;
    }

    overlay.remove();
    renderAuthBar(session.user.email, subscription);
  }

  supabaseClient.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') window.location.href = 'login.html';
  });

  checkAccess();
})();
