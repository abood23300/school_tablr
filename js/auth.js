// منطق صفحة تسجيل الدخول / إنشاء حساب (login.html)

function showAuthMessage(text, type) {
  const el = document.getElementById('authMsg');
  el.textContent = text;
  el.className = `auth-msg show ${type}`;
}

function clearAuthMessage() {
  const el = document.getElementById('authMsg');
  el.className = 'auth-msg';
}

function setAuthTab(target) {
  document.querySelectorAll('.auth-tabs button').forEach(b => b.classList.toggle('active', b.dataset.target === target));
  document.querySelectorAll('.auth-form').forEach(f => f.classList.toggle('active', f.id === target));
  clearAuthMessage();
}

document.getElementById('tabLoginBtn').addEventListener('click', () => setAuthTab('loginForm'));
document.getElementById('tabSignupBtn').addEventListener('click', () => setAuthTab('signupForm'));

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

document.getElementById('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAuthMessage();
  const submitBtn = document.getElementById('signupSubmitBtn');
  const schoolName = document.getElementById('signupSchoolName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;

  submitBtn.disabled = true;
  const { data, error } = await supabaseClient.auth.signUp({ email, password });

  if (error) {
    submitBtn.disabled = false;
    showAuthMessage(translateAuthError(error), 'error');
    return;
  }

  // خزّن اسم المدرسة في صف الاشتراك الذي أنشأه الـ trigger تلقائيًا
  if (data?.user) {
    await supabaseClient.from('subscriptions').update({ school_name: schoolName }).eq('user_id', data.user.id);
  }
  submitBtn.disabled = false;

  if (data?.session) {
    // تأكيد البريد غير مُفعّل في إعدادات المشروع -> دخول مباشر
    window.location.href = 'timetable.html';
  } else {
    showAuthMessage('تم إنشاء الحساب. تحقق من بريدك الإلكتروني للتأكيد قبل تسجيل الدخول.', 'success');
    setAuthTab('loginForm');
  }
});

function translateAuthError(error) {
  const msg = error?.message || '';
  if (msg.includes('Invalid login credentials')) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
  if (msg.includes('User already registered')) return 'هذا البريد الإلكتروني مسجّل مسبقًا. جرّب تسجيل الدخول.';
  if (msg.includes('Password should be at least')) return 'كلمة المرور قصيرة جدًا (6 أحرف على الأقل).';
  if (msg.includes('Email not confirmed')) return 'يرجى تأكيد بريدك الإلكتروني أولاً (راجع صندوق الوارد).';
  return 'حدث خطأ: ' + msg;
}

// إن كان المستخدم مسجّلاً دخوله بالفعل، لا داعي لإظهار صفحة الدخول
(async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) window.location.href = 'timetable.html';
})();
