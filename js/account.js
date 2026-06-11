// ── ACCOUNTS & PAYWALL ────────────────────────────────
// Supabase auth + Stripe checkout + feature gating.
//
// Free tier (no account needed): draw plays and run 2D motion on up to
// PD_CONFIG.FREE_PLAY_LIMIT distinct plays. Everything else — 3D film room,
// saving/opening plays, exports, custom formations, cloud playbook —
// requires the one-time Pro purchase.

const Account = (() => {
  const cfg = window.PD_CONFIG || {};
  const hasBackend = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  let sb = null;          // supabase client
  let user = null;        // supabase user
  let profile = null;     // { is_pro, ... }
  let authBusy = false;

  if (hasBackend && window.supabase) {
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }

  // ── Free play slots (localStorage, also keyed per-account) ──
  const FREE_LIMIT = cfg.FREE_PLAY_LIMIT || 3;
  let currentPlayId = newPlayId();

  function newPlayId() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function slotsKey() {
    return 'pd.freeplays.' + (user ? user.id : 'anon');
  }
  function usedSlots() {
    try { return JSON.parse(localStorage.getItem(slotsKey()) || '[]'); }
    catch { return []; }
  }
  function useSlot(id) {
    const s = usedSlots();
    if (!s.includes(id)) {
      s.push(id);
      localStorage.setItem(slotsKey(), JSON.stringify(s));
    }
  }
  function slotsLeft() {
    return Math.max(0, FREE_LIMIT - usedSlots().length);
  }

  function isPro() { return !!(profile && profile.is_pro); }

  // ── Profile ─────────────────────────────────────────
  async function refreshProfile() {
    if (!sb || !user) { profile = null; return; }
    const { data } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    profile = data || null;
    renderHeader();
  }

  // ── Header UI ───────────────────────────────────────
  function renderHeader() {
    const el = document.getElementById('accountArea');
    if (!el) return;
    if (!hasBackend) {
      el.innerHTML = `<button class="btn" onclick="Account.showUpgrade('setup')">🔒 Unlock Pro ${cfg.PRICE_LABEL || '$25'}</button>`;
      return;
    }
    if (!user) {
      el.innerHTML =
        `<button class="btn" onclick="Account.showAuth('signin')">Sign in</button>` +
        `<button class="btn primary" onclick="Account.showUpgrade()">Unlock Pro ${cfg.PRICE_LABEL || '$25'}</button>`;
    } else if (isPro()) {
      el.innerHTML =
        `<span style="font-size:12px;color:var(--muted)">${esc(user.email || '')}</span>` +
        `<span class="v-badge" style="background:rgba(73,181,100,.18);border-color:rgba(73,181,100,.4);color:var(--success)">PRO</span>` +
        `<button class="btn" onclick="Account.signOut()">Sign out</button>`;
    } else {
      el.innerHTML =
        `<span style="font-size:12px;color:var(--muted)">${esc(user.email || '')}</span>` +
        `<button class="btn primary" onclick="Account.showUpgrade()">Unlock Pro ${cfg.PRICE_LABEL || '$25'}</button>` +
        `<button class="btn" onclick="Account.signOut()">Sign out</button>`;
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  // ── Modals ──────────────────────────────────────────
  function modalShell(id, inner) {
    closeModals();
    const wrap = document.createElement('div');
    wrap.id = id;
    wrap.className = 'pd-modal-backdrop';
    wrap.innerHTML = `<div class="pd-modal">${inner}</div>`;
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) closeModals(); });
    document.body.appendChild(wrap);
    return wrap;
  }
  function closeModals() {
    document.querySelectorAll('.pd-modal-backdrop').forEach(m => m.remove());
  }

  function showAuth(mode = 'signin', note = '') {
    if (!hasBackend) { showUpgrade('setup'); return; }
    const isUp = mode === 'signup';
    modalShell('pdAuthModal', `
      <h2>${isUp ? 'Create your account' : 'Sign in'}</h2>
      ${note ? `<p class="pd-modal-note">${esc(note)}</p>` : ''}
      <label>Email</label>
      <input class="input" id="pdAuthEmail" type="email" autocomplete="email" placeholder="coach@team.com">
      <label style="margin-top:8px">Password</label>
      <input class="input" id="pdAuthPass" type="password" autocomplete="${isUp ? 'new-password' : 'current-password'}" placeholder="${isUp ? 'At least 8 characters' : 'Your password'}">
      <div class="pd-modal-err" id="pdAuthErr"></div>
      <button class="btn primary full" style="margin-top:12px" id="pdAuthGo">${isUp ? 'Create account' : 'Sign in'}</button>
      <p class="pd-modal-switch">
        ${isUp ? 'Already have an account?' : 'New here?'}
        <a href="#" id="pdAuthSwitch">${isUp ? 'Sign in' : 'Create an account'}</a>
      </p>
    `);
    document.getElementById('pdAuthSwitch').onclick = e => {
      e.preventDefault();
      showAuth(isUp ? 'signin' : 'signup', note);
    };
    const go = document.getElementById('pdAuthGo');
    const submit = async () => {
      if (authBusy) return;
      const email = document.getElementById('pdAuthEmail').value.trim();
      const pass = document.getElementById('pdAuthPass').value;
      const errEl = document.getElementById('pdAuthErr');
      errEl.textContent = '';
      if (!email || !pass) { errEl.textContent = 'Email and password are required.'; return; }
      authBusy = true;
      go.textContent = '…';
      try {
        const { data, error } = isUp
          ? await sb.auth.signUp({ email, password: pass })
          : await sb.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
        if (isUp && data.user && !data.session) {
          // email confirmation enabled in Supabase
          errEl.style.color = 'var(--success)';
          errEl.textContent = 'Check your email to confirm your account, then sign in.';
          authBusy = false;
          go.textContent = 'Create account';
          return;
        }
        closeModals();
      } catch (e2) {
        errEl.textContent = e2.message || 'Something went wrong.';
      }
      authBusy = false;
      go.textContent = isUp ? 'Create account' : 'Sign in';
    };
    go.onclick = submit;
    document.getElementById('pdAuthPass').addEventListener('keydown', e => {
      if (e.key === 'Enter') submit();
    });
    document.getElementById('pdAuthEmail').focus();
  }

  const FEATURE_NAMES = {
    openPOV: '3D Film Room',
    savePlay: 'Saving plays',
    openPlayFile: 'Opening saved plays',
    saveToSession: 'Session saves',
    exportPNG: 'PNG export',
    exportVideo: 'Video export',
    copyJSON: 'Copying play data',
    saveFormation: 'Custom formations',
    savePOVPNG: '3D screenshots',
    startPOVVideo: '3D video export',
    loadSaved: 'Opening saved plays',
  };

  function showUpgrade(reason = '') {
    const price = cfg.PRICE_LABEL || '$25';
    const why = reason === 'setup'
      ? `<p class="pd-modal-note" style="color:#ff9090">Payments aren't configured yet — the site owner needs to fill in js/config.js (see README).</p>`
      : reason === 'playLimit'
        ? `<p class="pd-modal-note">🔒 You've used all <b>${FREE_LIMIT} free plays</b>. Unlock Pro for unlimited plays.</p>`
        : reason && FEATURE_NAMES[reason]
          ? `<p class="pd-modal-note">🔒 <b>${esc(FEATURE_NAMES[reason])}</b> is a Pro feature.</p>`
          : '';
    modalShell('pdUpgradeModal', `
      <h2>⚡ Play Designer <span style="color:var(--gold)">Pro</span></h2>
      ${why}
      <div class="pd-price">${price} <span>one-time · yours forever</span></div>
      <ul class="pd-feat">
        <li>🏈 Unlimited plays with full 2D motion</li>
        <li>🎥 3D Film Room — rigged players, 5 camera angles, first-person view</li>
        <li>☁️ Cloud playbook — save plays to your account</li>
        <li>💾 Save &amp; open .pdpro play files</li>
        <li>📸 PNG screenshots &amp; 🎬 video export (2D and 3D)</li>
        <li>📐 Save custom formations</li>
      </ul>
      <div class="pd-modal-err" id="pdUpErr"></div>
      <button class="btn primary full" style="margin-top:10px;font-size:15px;padding:11px" id="pdBuyBtn">Unlock everything — ${price}</button>
      <p class="pd-modal-switch">Free tier: draw &amp; run 2D motion on ${FREE_LIMIT} plays${user ? '' : ' · no account needed'}</p>
    `);
    document.getElementById('pdBuyBtn').onclick = startCheckout;
  }

  async function startCheckout() {
    const errEl = document.getElementById('pdUpErr');
    if (!hasBackend) {
      if (errEl) errEl.textContent = 'Payments are not configured yet (js/config.js).';
      return;
    }
    if (!user) {
      showAuth('signup', 'Create a free account first so your purchase is linked to it.');
      return;
    }
    const btn = document.getElementById('pdBuyBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Opening secure checkout…'; }
    try {
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch(cfg.SUPABASE_URL + '/functions/v1/create-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + session.access_token,
          'apikey': cfg.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ origin: location.origin + location.pathname }),
      });
      const out = await res.json();
      if (!res.ok || !out.url) throw new Error(out.error || 'Could not start checkout.');
      location.href = out.url;
    } catch (e) {
      if (errEl) errEl.textContent = e.message || 'Could not start checkout.';
      if (btn) { btn.disabled = false; btn.textContent = 'Unlock everything — ' + (cfg.PRICE_LABEL || '$25'); }
    }
  }

  // After returning from Stripe: poll until the webhook flips is_pro
  async function handleCheckoutReturn() {
    const params = new URLSearchParams(location.search);
    if (params.get('checkout') !== 'success') return;
    history.replaceState(null, '', location.pathname);
    if (!sb) return;
    modalShell('pdWaitModal', `
      <h2>Finishing your purchase…</h2>
      <p class="pd-modal-note" id="pdWaitNote">Confirming payment — this usually takes a few seconds.</p>
    `);
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1500));
      await refreshProfile();
      if (isPro()) {
        modalShell('pdDoneModal', `
          <h2>🎉 You're Pro!</h2>
          <p class="pd-modal-note">Everything is unlocked — 3D Film Room, saving, exports, cloud playbook. Thanks for the support, coach.</p>
          <button class="btn primary full" style="margin-top:10px" onclick="document.querySelectorAll('.pd-modal-backdrop').forEach(m=>m.remove())">Let's go</button>
        `);
        renderCloudPanel();
        return;
      }
    }
    const note = document.getElementById('pdWaitNote');
    if (note) note.textContent = 'Payment received — your account will unlock within a minute. Refresh the page if it doesn’t.';
  }

  // ── Feature gating ───────────────────────────────────
  function gate(fnName) {
    const orig = window[fnName];
    if (typeof orig !== 'function') return;
    window[fnName] = function (...args) {
      if (!isPro()) { showUpgrade(fnName); return; }
      return orig.apply(this, args);
    };
  }

  function gateRunPlay() {
    const orig = window.runPlay;
    if (typeof orig !== 'function') return;
    window.runPlay = function (...args) {
      if (!isPro()) {
        const used = usedSlots();
        if (!used.includes(currentPlayId) && used.length >= FREE_LIMIT) {
          showUpgrade('playLimit');
          return;
        }
        useSlot(currentPlayId);
        updateFreeCounter();
      }
      return orig.apply(this, args);
    };
  }

  // New play design → new free-play slot
  function gateNewPlay() {
    ['hardReset', 'deserialize'].forEach(fnName => {
      const orig = window[fnName];
      if (typeof orig !== 'function') return;
      window[fnName] = function (...args) {
        const out = orig.apply(this, args);
        currentPlayId = newPlayId();
        return out;
      };
    });
  }

  function updateFreeCounter() {
    let el = document.getElementById('freePlayCounter');
    if (isPro()) { if (el) el.remove(); return; }
    if (!el) {
      const bar = document.querySelector('.bar-row');
      if (!bar) return;
      el = document.createElement('span');
      el.id = 'freePlayCounter';
      el.style.cssText = 'font:700 10px "Barlow Condensed";letter-spacing:1px;color:var(--gold);background:rgba(200,168,75,.12);border:1px solid rgba(200,168,75,.3);border-radius:999px;padding:3px 9px;white-space:nowrap;cursor:pointer';
      el.title = 'Free plays used — click to unlock unlimited';
      el.onclick = () => showUpgrade();
      bar.appendChild(el);
    }
    el.textContent = `FREE ${Math.min(usedSlots().length, FREE_LIMIT)}/${FREE_LIMIT}`;
  }

  // ── Cloud playbook (Pro) ─────────────────────────────
  async function cloudSave() {
    if (!isPro() || !sb) { showUpgrade('savePlay'); return; }
    const data = serialize();
    if (!data.name || data.name === 'Untitled Play') {
      const n = prompt('Name this play:', data.name || '');
      if (!n) return;
      data.name = n;
      document.getElementById('playName').value = n;
    }
    const { error } = await sb.from('plays').upsert(
      { user_id: user.id, name: data.name, data, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,name' });
    if (error) { status('Cloud save failed: ' + error.message, 'error'); return; }
    status('Saved "' + data.name + '" to your cloud playbook.', 'success');
    refreshCloudList();
  }

  async function refreshCloudList() {
    const sel = document.getElementById('cloudPlays');
    if (!sel || !sb || !user) return;
    const { data, error } = await sb.from('plays')
      .select('id,name,updated_at').order('updated_at', { ascending: false });
    if (error || !data || !data.length) {
      sel.innerHTML = '<option value="">No cloud plays yet…</option>';
      return;
    }
    sel.innerHTML = '<option value="">Load from cloud playbook…</option>' +
      data.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  }

  async function cloudLoad(id) {
    if (!id || !sb) return;
    const { data, error } = await sb.from('plays').select('data').eq('id', id).single();
    if (error || !data) { status('Could not load play.', 'error'); return; }
    deserialize(data.data);
    status('Loaded from cloud playbook.', 'success');
    const sel = document.getElementById('cloudPlays');
    if (sel) sel.value = '';
  }

  async function cloudDelete() {
    const sel = document.getElementById('cloudPlays');
    if (!sel || !sel.value) { status('Pick a cloud play to delete first.', 'error'); return; }
    const name = sel.options[sel.selectedIndex].textContent;
    if (!confirm('Delete "' + name + '" from your cloud playbook?')) return;
    await sb.from('plays').delete().eq('id', sel.value);
    refreshCloudList();
    status('Deleted from cloud playbook.', 'success');
  }

  function renderCloudPanel() {
    let panel = document.getElementById('cloudPanel');
    if (!hasBackend || !isPro()) { if (panel) panel.remove(); return; }
    if (panel) { refreshCloudList(); return; }
    const playsTab = document.getElementById('rtab-plays');
    if (!playsTab) return;
    panel = document.createElement('div');
    panel.id = 'cloudPanel';
    panel.style.cssText = 'background:#0a121f;border:1px solid #1a2c4a;border-radius:6px;padding:9px;margin-bottom:10px';
    panel.innerHTML = `
      <div style="font-size:11px;color:#6ab0f3;font-weight:700;margin-bottom:5px">☁️ CLOUD PLAYBOOK (your account)</div>
      <p class="hint" style="margin-bottom:8px">Plays saved to your account — available on any device you sign in on.</p>
      <button class="btn blue full" style="margin-bottom:7px" onclick="Account.cloudSave()">☁️ Save to Cloud</button>
      <select class="select" id="cloudPlays" onchange="Account.cloudLoad(this.value)"></select>
      <button class="btn full" style="margin-top:6px;font-size:11px" onclick="Account.cloudDelete()">✕ Delete selected</button>`;
    playsTab.insertBefore(panel, playsTab.children[1]);
    refreshCloudList();
  }

  // ── Init ─────────────────────────────────────────────
  async function init() {
    // gate features regardless of backend availability
    ['openPOV', 'savePlay', 'openPlayFile', 'saveToSession', 'exportPNG',
     'exportVideo', 'copyJSON', 'saveFormation', 'savePOVPNG', 'startPOVVideo',
     'loadSaved']
      .forEach(gate);
    gateRunPlay();
    gateNewPlay();
    renderHeader();
    updateFreeCounter();

    if (!sb) return;
    sb.auth.onAuthStateChange(async (_event, session) => {
      user = session ? session.user : null;
      await refreshProfile();
      renderHeader();
      updateFreeCounter();
      renderCloudPanel();
    });
    const { data: { session } } = await sb.auth.getSession();
    user = session ? session.user : null;
    await refreshProfile();
    renderHeader();
    updateFreeCounter();
    renderCloudPanel();
    handleCheckoutReturn();
  }

  async function signOut() {
    if (sb) await sb.auth.signOut();
    user = null; profile = null;
    renderHeader();
    updateFreeCounter();
    renderCloudPanel();
  }

  init();

  return {
    isPro, showAuth, showUpgrade, signOut,
    cloudSave, cloudLoad, cloudDelete,
    closeModals,
  };
})();
