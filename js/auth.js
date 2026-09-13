// منطق صفحة تسجيل الدخول (login.html)
// لا يوجد تسجيل حساب ذاتي هنا عمدًا -- الحسابات تُنشأ يدويًا فقط من لوحة Supabase (راجع README/التعليمات).

function showAuthMessage(text, type) {
  const el = document.getElementById('authMsg');
  el.textContent = text;
  el.className = `auth-msg show ${type}`;
}

function clearAuthMessage() {
  const el = document.getElementById('authMsg');
  el.className = 'auth-msg';
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAuthMessage();
  const submitBtn = document.getElementById('loginSubmitBtn');
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  submitBtn.disabled = true;
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  submitBtn.disabled = false;

  if (error) {
    showAuthMessage(translateAuthError(error), 'error');
    return;
  }
  window.location.href = 'timetable.html';
});

function translateAuthError(error) {
  const msg = error?.message || '';
  if (msg.includes('Invalid login credentials')) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
  if (msg.includes('Email not confirmed')) return 'يرجى تأكيد بريدك الإلكتروني أولاً (راجع صندوق الوارد).';
  return 'حدث خطأ: ' + msg;
}

// إن كان المستخدم مسجّلاً دخوله بالفعل، لا داعي لإظهار صفحة الدخول
(async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) window.location.href = 'timetable.html';
})();
