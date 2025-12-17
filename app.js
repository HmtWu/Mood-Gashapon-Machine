// === Firebase 初始化 ===
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, arrayUnion, collection, addDoc, getDocs, query, orderBy, limit, increment, where, onSnapshot }
  from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

// ⚙️ Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyCcbtsjKSFRBg66x-nVyOB0wljwilxTVqY",
  authDomain: "mood-gacha.firebaseapp.com",
  projectId: "mood-gacha",
  storageBucket: "mood-gacha.firebasestorage.app",
  messagingSenderId: "439343502117",
  appId: "1:439343502117:web:a09add8afb9de07ed5c0cc",
  measurementId: "G-7HCLV1Y6H8"
};

// ✅ 初始化
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const bottlesCollectionRef = collection(db, 'bottles');

// === AI 後端 API ===
const BACKEND_URL = "https://cloud-xi08.onrender.com";

// === 全域狀態 ===
let userDocRef = null;
let currentUser = null;
let userData = { logs: [], favs: [], pending: [] };
let chosenEmotion = null;
let uiInitialized = false;
let currentPage = 'sec-gacha';
let lastDescription = '';
let lastDiaryText = '';
let diaryFilter = 'ALL';
let lastGeneratedTaskTs = null;
let shouldRequestVariant = false;
let currentBottle = null;
let bottleWatcherUnsub = null;
const userBottleState = new Map();

const MOOD_TYPES = ['壓力', '焦慮', '開心', '疲憊', '迷茫', '平靜'];
const MOOD_STYLES = {
  壓力: { gradient: 'linear-gradient(135deg, #ff9a9e, #fecfef)', dot: '#ff9a9e' },
  焦慮: { gradient: 'linear-gradient(135deg, #a1c4fd, #c2e9fb)', dot: '#a1c4fd' },
  開心: { gradient: 'linear-gradient(135deg, #f6d365, #fda085)', dot: '#f6d365' },
  疲憊: { gradient: 'linear-gradient(135deg, #d4fc79, #96e6a1)', dot: '#96e6a1' },
  迷茫: { gradient: 'linear-gradient(135deg, #e0c3fc, #8ec5fc)', dot: '#e0c3fc' },
  平靜: { gradient: 'linear-gradient(135deg, #84fab0, #8fd3f4)', dot: '#84fab0' }
};
const DEFAULT_MOOD_STYLE = { gradient: 'linear-gradient(135deg, #dfe9f3, #ffffff)', dot: '#dfe9f3' };

const spinAudio = createSafeAudio('assets/spin.mp3');
const dropAudio = createSafeAudio('assets/drop.mp3');
let gachaAnimation = null;
let lottieScriptPromise = null;
let aiWeeklyStatusTimer = null;

// === 輔助函數 ===
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);
const getDescription = () => {
  const el = $('#emotionDescription');
  return el ? el.value.trim() : '';
};
const getDiaryInput = () => {
  const el = $('#moodDiary');
  return el ? el.value.trim() : '';
};
const getDiaryText = (entry) => {
  if (!entry) return '';
  const diary = typeof entry.diary === 'string' ? entry.diary.trim() : '';
  if (diary) return diary;
  const note = typeof entry.note === 'string' ? entry.note.trim() : '';
  return note;
};
const isBottleShareEnabled = () => {
  const checkbox = $('#sendToBottle');
  return checkbox ? checkbox.checked : false;
};
const resetBottleShareToggle = () => {
  const checkbox = $('#sendToBottle');
  if (checkbox) checkbox.checked = false;
};

function createSafeAudio(src) {
  try {
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    return audio;
  } catch (err) {
    console.warn(`音效載入失敗：${src}`, err);
    return null;
  }
}

function playSfx(audio) {
  if (!audio) return;
  try {
    audio.currentTime = 0;
    const promise = audio.play();
    if (promise && typeof promise.catch === 'function') {
      promise.catch((err) => console.warn('音效播放失敗', err));
    }
  } catch (err) {
    console.warn('音效播放錯誤', err);
  }
}

function stopSfx(audio, resetTime = true) {
  if (!audio) return;
  try {
    audio.pause();
    audio.loop = false;
    if (resetTime) audio.currentTime = 0;
  } catch (err) {
    console.warn('音效停止異常', err);
  }
}

function loadLottieScript() {
  if (window.lottie) return Promise.resolve(window.lottie);
  if (lottieScriptPromise) return lottieScriptPromise;
  lottieScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js';
    script.async = true;
    script.onload = () => resolve(window.lottie);
    script.onerror = (err) => reject(err);
    document.head.appendChild(script);
  }).catch((err) => {
    console.warn('Lottie 載入失敗', err);
    lottieScriptPromise = null;
    throw err;
  });
  return lottieScriptPromise;
}

async function ensureGachaAnimation() {
  try {
    const lottieLib = await loadLottieScript();
    if (!lottieLib) return null;
    const container = document.getElementById('gachaAnim');
    if (!container) return null;
    if (!gachaAnimation) {
      gachaAnimation = lottieLib.loadAnimation({
        container,
        renderer: 'svg',
        loop: false,
        autoplay: false,
        path: 'Generator.json'
      });
    }
    return gachaAnimation;
  } catch (err) {
    return null;
  }
}

function warmupGachaAnimation() {
  ensureGachaAnimation();
}

function playGachaDropAnimation() {
  if (gachaAnimation) {
    gachaAnimation.loop = false;
    gachaAnimation.goToAndPlay(0, true);
    return;
  }
  warmupGachaAnimation().then((anim) => {
    if (anim) {
      anim.loop = false;
      anim.goToAndPlay(0, true);
    }
  });
}

function startAIWeeklyStatus(container) {
  stopAIWeeklyStatus();
  const messages = [
    '🔍 正在翻閱您的心情紀錄...',
    '💭 正在感受文字中的情緒...',
    '✍️ 導師正在為您撰寫建議...'
  ];
  let index = 0;
  container.innerHTML = `<div class="ai-weekly-card analyzing">${messages[index]}</div>`;
  aiWeeklyStatusTimer = setInterval(() => {
    index = (index + 1) % messages.length;
    container.innerHTML = `<div class="ai-weekly-card analyzing">${messages[index]}</div>`;
  }, 2500);
}

function stopAIWeeklyStatus() {
  if (aiWeeklyStatusTimer) {
    clearInterval(aiWeeklyStatusTimer);
    aiWeeklyStatusTimer = null;
  }
}

async function sendMoodBottle(content, emotion) {
  const trimmed = (content || '').trim();
  if (!trimmed || !emotion) return;
  try {
    await addDoc(bottlesCollectionRef, {
      content: trimmed,
      emotion,
      ts: Date.now(),
      likes: 0,
      author: currentUser?.uid || null,
      replies: []
    });
  } catch (err) {
    console.warn('送出漂流瓶失敗', err);
  }
}

async function pickRandomBottle() {
  const display = $('#bottleDisplay');
  if (!display) return;
  display.innerHTML = '<div class="bottle-loading">🌊 正在撈取漂流瓶...</div>';
  try {
    const q = query(bottlesCollectionRef, orderBy('ts', 'desc'), limit(20));
    const snapshot = await getDocs(q);
    const bottles = snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .filter((bottle) => bottle.author !== currentUser?.uid);
    if (!bottles.length) {
      currentBottle = null;
      display.innerHTML = "<div class='bottle-empty'>海上目前只有你自己的瓶子，靜待其他漂流瓶漂過來吧～</div>";
      return;
    }
    const randomBottle = bottles[Math.floor(Math.random() * bottles.length)];
    renderBottle(randomBottle);
  } catch (err) {
    console.error('撈取漂流瓶失敗', err);
    display.innerHTML = "<div class='bottle-error'>撈瓶子失敗，稍後再試。</div>";
  }
}

function renderBottle(bottle) {
  const display = $('#bottleDisplay');
  if (!display) return;
  if (!bottle) {
    display.innerHTML = "<div class='bottle-empty'>海上暫時沒瓶子，先寫一則日記試試！</div>";
    currentBottle = null;
    return;
  }
  currentBottle = bottle;
  display.innerHTML = `
    <div class="bottle-glass">
      <div class="bottle-emotion">${bottle.emotion || '未知心情'}</div>
      <div class="bottle-content">${bottle.content || '（這則漂流瓶沒有文字）'}</div>
      <div class="bottle-footer">
        <div class="bottle-likes">❤️ ${bottle.likes || 0}</div>
        <button class="btn bottle-hug-btn" data-action="hug-bottle">給予抱抱</button>
      </div>
      <div class="bottle-reply-area">
        <textarea class="bottle-reply-input" placeholder="寫下你的鼓勵..."></textarea>
        <button class="btn bottle-reply-btn" data-action="send-reply">送出鼓勵</button>
      </div>
      <div class="bottle-message">撈起這顆漂流瓶，讓我們互相取暖。</div>
    </div>`;
  const hugBtn = display.querySelector('[data-action="hug-bottle"]');
  if (hugBtn) {
    hugBtn.addEventListener('click', () => sendHug(bottle.id));
  }
  const replyBtn = display.querySelector('[data-action="send-reply"]');
  if (replyBtn) {
    replyBtn.addEventListener('click', () => {
      const input = display.querySelector('.bottle-reply-input');
      replyToBottle(bottle.id, input?.value || '');
      if (input) input.value = '';
    });
  }
  display.classList.remove('floating');
  requestAnimationFrame(() => display.classList.add('floating'));
}

async function sendHug(bottleId) {
  if (!bottleId) return;
  try {
    const bottleRef = doc(db, 'bottles', bottleId);
    await updateDoc(bottleRef, { likes: increment(1) });
    if (currentBottle && currentBottle.id === bottleId) {
      currentBottle.likes = (currentBottle.likes || 0) + 1;
      renderBottle(currentBottle);
    }
    showBottleMessage('你送出了一個溫暖的抱抱！');
  } catch (err) {
    console.error('送抱抱失敗', err);
    showBottleMessage('抱抱暫時送不出去，稍候再試。');
  }
}

function showBottleMessage(text) {
  const messageEl = document.querySelector('#bottleDisplay .bottle-message');
  if (messageEl) {
    messageEl.textContent = text;
  }
}

async function replyToBottle(bottleId, text) {
  if (!bottleId) return;
  const trimmed = (text || '').trim();
  if (!trimmed) {
    showBottleMessage('寫點鼓勵再送出吧！');
    return;
  }
  try {
    const payload = { text: trimmed, ts: Date.now() };
    const bottleRef = doc(db, 'bottles', bottleId);
    await updateDoc(bottleRef, {
      replies: arrayUnion(payload),
      likes: increment(1)
    });
    if (currentBottle && currentBottle.id === bottleId) {
      currentBottle.likes = (currentBottle.likes || 0) + 1;
      if (!Array.isArray(currentBottle.replies)) currentBottle.replies = [];
      currentBottle.replies = [...currentBottle.replies, payload];
      renderBottle(currentBottle);
    }
    showBottleMessage('鼓勵已漂出！');
  } catch (err) {
    console.error('送出鼓勵失敗', err);
    showBottleMessage('暫時無法送出鼓勵，稍後再試。');
  }
}

function showToast(message) {
  if (!message) return;
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, 5000);
}

function stopBottleNotifications() {
  if (bottleWatcherUnsub) {
    bottleWatcherUnsub();
    bottleWatcherUnsub = null;
  }
  userBottleState.clear();
}

function startBottleNotifications() {
  if (!currentUser) return;
  stopBottleNotifications();
  const q = query(bottlesCollectionRef, where('author', '==', currentUser.uid));
  bottleWatcherUnsub = onSnapshot(q, (snapshot) => {
    snapshot.docs.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const prev = userBottleState.get(docSnap.id) || { likes: 0, replies: [] };
      const likes = typeof data.likes === 'number' ? data.likes : 0;
      const replies = Array.isArray(data.replies) ? data.replies : [];
      if (prev.likes < likes) {
        showToast('有人給了你的漂流瓶一個大大的抱抱 ❤️');
      }
      if (replies.length > prev.replies.length) {
        const latest = replies[replies.length - 1];
        const text = typeof latest?.text === 'string' ? latest.text : '匿名的暖心留言';
        showToast(`陌生人留下了鼓勵：「${text}」✨`);
      }
      userBottleState.set(docSnap.id, { likes, replies: replies.slice() });
    });
  }, (err) => console.error('bottle snapshot error', err));
}

async function playGachaSpinAnimation() {
  const anim = await ensureGachaAnimation();
  if (anim) {
    anim.loop = true;
    anim.goToAndPlay(0, true);
  }
}

function showPage(pageId) {
  if (!pageId) return;
  currentPage = pageId;
  const sections = document.querySelectorAll('.page-section');
  sections.forEach((section) => {
    if (!section) return;
    const isTarget = section.id === pageId;
    section.classList.toggle('active', isTarget);
    section.style.display = isTarget ? 'block' : 'none';
  });
  document.querySelectorAll('#topNav .nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.target === pageId);
  });
}

// === 等待 DOM 完成後綁定 ===
document.addEventListener('DOMContentLoaded', () => {
  onAuthStateChanged(auth, async (user) => {
    currentUser = user || null;
    const emailEl = document.getElementById('userEmail');
    if (emailEl) {
      emailEl.textContent = user?.email ? `🔐 ${user.email}` : '🔐 使用者未顯示信箱';
    }

    const isLoginPage = window.location.pathname.endsWith('login.html');

    if (!user) {
      stopBottleNotifications();
      if (!isLoginPage) {
        window.location.href = 'login.html';
      }
      return;
    }

    if (isLoginPage) {
      window.location.href = 'index.html';
      return;
    }

    userDocRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userDocRef);
    if (!snap.exists()) {
      await setDoc(userDocRef, { logs: [], favs: [], pending: [] });
    }
    const data = (await getDoc(userDocRef)).data();
    userData = { logs: [], favs: [], pending: [], ...data };

    await migrateLocalToCloud();

    setupUIBindings();
    updateAll();
    showPage(currentPage);
    pickRandomBottle();
    startBottleNotifications();
  });
});

// === 綁定所有 UI 事件 ===
function setupUIBindings() {
  if (uiInitialized) return;
  uiInitialized = true;

  window.logout = async () => {
    await signOut(auth);
    window.location.href = 'login.html';
  };

  const modal = $('#gachaModal');
  const openModal = $('#openModal');
  const closeModal = $('#closeModal');

  if (modal && openModal && closeModal) {
    openModal.onclick = () => {
      modal.classList.add('show');
      $$('.emotions button').forEach((x) => (x.style.filter = 'none'));
      const desc = $('#emotionDescription');
      if (desc) desc.value = '';
      chosenEmotion = null;
      const loadingEl = $('#loading');
      if (loadingEl) loadingEl.style.display = 'none';
      const resultEl = $('#result');
      if (resultEl) resultEl.style.display = 'none';
      warmupGachaAnimation();
    };
    closeModal.onclick = () => modal.classList.remove('show');
    window.onclick = (e) => {
      if (e.target === modal) modal.classList.remove('show');
    };
  }

  $$('.emotions button').forEach((button) => {
    button.addEventListener('click', () => {
      chosenEmotion = button.dataset.emotion;
      $$('.emotions button').forEach((x) => (x.style.filter = 'grayscale(60%)'));
      button.style.filter = 'none';
    });
  });

  const clearBtn = $('#clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      if (!confirm('確定清除所有雲端資料？這無法復原！')) return;
      userData = { logs: [], favs: [], pending: [] };
      if (userDocRef) await setDoc(userDocRef, userData);
      updateAll();
    });
  }

  const exportDataBtn = $('#exportData');
  if (exportDataBtn && !exportDataBtn.dataset.bound) {
    exportDataBtn.dataset.bound = "true";
    exportDataBtn.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(logs(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'mood-log.json';
      a.click();
    });
  }

  const exportJpgBtn = $('#exportJPG');
  if (exportJpgBtn && !exportJpgBtn.dataset.bound) {
    exportJpgBtn.dataset.bound = "true";
    exportJpgBtn.addEventListener('click', () => exportToJPG());
  }

  const reSpinBtn = $('#reSpin');
  if (reSpinBtn && !reSpinBtn.dataset.bound) {
    reSpinBtn.dataset.bound = 'true';
    reSpinBtn.addEventListener('click', () => handleRespin());
  }

  const closeAndCancelBtn = $('#closeAndCancel');
  if (closeAndCancelBtn && !closeAndCancelBtn.dataset.bound) {
    closeAndCancelBtn.dataset.bound = 'true';
    closeAndCancelBtn.addEventListener('click', () => closeAndArchiveLast());
  }

  const pullBottleBtn = $('#pullBottle');
  if (pullBottleBtn && !pullBottleBtn.dataset.bound) {
    pullBottleBtn.dataset.bound = 'true';
    pullBottleBtn.addEventListener('click', () => pickRandomBottle());
  }

  const aiWeeklyBtn = $('#generateWeeklyAI');
  if (aiWeeklyBtn && !aiWeeklyBtn.dataset.bound) {
    aiWeeklyBtn.dataset.bound = 'true';
    aiWeeklyBtn.addEventListener('click', () => handleAIWeeklySummary());
  }

  const nav = document.getElementById('topNav');
  if (nav && !nav.dataset.bound) {
    nav.dataset.bound = 'true';
    nav.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.target;
        if (target) showPage(target);
      });
    });
    showPage(currentPage);
  }

  const diaryFiltersEl = $('#diaryFilters');
  if (diaryFiltersEl && !diaryFiltersEl.dataset.bound) {
    diaryFiltersEl.dataset.bound = 'true';
    diaryFiltersEl.addEventListener('click', (event) => {
      const target = event.target.closest('button[data-emotion]');
      if (!target) return;
      diaryFilter = target.dataset.emotion || 'ALL';
      diaryFiltersEl.querySelectorAll('button[data-emotion]').forEach((btn) => {
        btn.classList.toggle('active', btn === target);
      });
      renderDiaries();
    });
  }
}

// === 本地資料遷移 ===
async function migrateLocalToCloud() {
  const oldLogs = JSON.parse(localStorage.getItem('mh.logs') || '[]');
  const oldFavs = JSON.parse(localStorage.getItem('mh.favs') || '[]');
  const oldPending = JSON.parse(localStorage.getItem('mh.pending') || '[]');
  if (oldLogs.length || oldFavs.length || oldPending.length) {
    await updateDoc(userDocRef, { logs: oldLogs, favs: oldFavs, pending: oldPending });
    localStorage.removeItem('mh.logs');
    localStorage.removeItem('mh.favs');
    localStorage.removeItem('mh.pending');
  }
}

// === API 互動 ===
export async function handleSpin() {
  if (!chosenEmotion) {
    alert('請先選擇心情！');
    throw new Error('未選擇心情');
  }

  if (spinAudio) {
    spinAudio.loop = true;
    playSfx(spinAudio);
  }
  playGachaSpinAnimation();
  const description = getDescription();
  const diaryEntry = getDiaryInput();
  lastDescription = description;
  lastDiaryText = diaryEntry;
  const shareToBottle = isBottleShareEnabled();
  if (shareToBottle && diaryEntry) {
    sendMoodBottle(diaryEntry, chosenEmotion);
  }
  const loadingEl = $('#loading');
  const resultEl = $('#result');
  if (loadingEl) loadingEl.style.display = 'block';
  if (resultEl) resultEl.style.display = 'none';

  const variantHint = shouldRequestVariant;
  if (variantHint) shouldRequestVariant = false;
  const promptDescription = variantHint
    ? `請提供與剛才不同類型的建議。\n${description}`
    : description;

  try {
    const response = await fetch(`${BACKEND_URL}/generate-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emotion: chosenEmotion, description: promptDescription, diary: diaryEntry })
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 呼叫失敗: ${errorText}`);
    }
    const data = await response.json();
    if (!data.task || data.w === undefined) {
      throw new Error('AI 任務格式錯誤');
    }
    stopSfx(spinAudio);
    playSfx(dropAudio);
    playGachaDropAnimation();
    return { ...data, description: promptDescription, diary: diaryEntry };
  } catch (error) {
    console.error('生成任務失敗:', error);
    stopSfx(spinAudio);
    const fallbackTask = pickTask(chosenEmotion);
    if (fallbackTask) {
      alert(`AI 生成失敗，提供備援任務：${fallbackTask.t}`);
      if (loadingEl) loadingEl.style.display = 'none';
      playSfx(dropAudio);
      playGachaDropAnimation();
      return { task: fallbackTask, w: 0, description: promptDescription, diary: diaryEntry };
    }
    if (loadingEl) loadingEl.style.display = 'none';
    alert(`生成任務失敗: ${error.message}`);
    throw error;
  }
}

async function handleAIWeeklySummary() {
  const container = document.getElementById('aiWeeklySummaryContainer');
  if (!container) return;

  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay());
  start.setHours(0, 0, 0, 0);

  const diaryEntries = logs().filter((entry) => {
    const note = getDiaryText(entry);
    return Boolean(note) && entry.ts >= start.getTime() && entry.ts <= now.getTime();
  });

  if (!diaryEntries.length) {
    stopAIWeeklyStatus();
    container.innerHTML = `
      <div class="ai-weekly-card">
        <div class="ai-weekly-title">🌱 AI 心情週報</div>
        <p class="ai-weekly-empty">本週還沒留下心情文字，AI 沒辦法幫您回顧喔！</p>
      </div>`;
    return;
  }

  startAIWeeklyStatus(container);
  const weekdays = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  const diaryFragments = diaryEntries.map((entry) => {
    const dayLabel = weekdays[new Date(entry.ts).getDay()] || '';
    const note = getDiaryText(entry);
    return `[${dayLabel}：${entry.emotion} - ${note}]`;
  }).join('、');

  const prompt = `【系統指令：請扮演一位具備共感力的專業心靈導師。請根據以下這週的心情紀錄與日記，撰寫一份 150 字內的深度週報：
1. 情緒脈絡：分析使用者本週情緒的轉變與事件間的潛在連結。
2. 成長點亮：指出使用者在本週面對挑戰時展現的正面特質（如：勇氣、耐心或誠實）。
3. 暖心處方箋：根據情緒主軸，給予一個下週可以實踐的「非任務型」心靈小練習。
口吻請保持溫柔且富有智慧，使用繁體中文。請直接回覆週報內容，不要生成任何任務格式。】
本週資料：${diaryFragments}`;

  try {
    const response = await fetch(`${BACKEND_URL}/generate-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emotion: '平靜',
        description: prompt,
        diary: ''
      })
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const data = await response.json();
    const summary = data?.task?.d || data?.task?.t || 'AI 目前無法生成週報，晚點再試試吧！';
    stopAIWeeklyStatus();
    container.innerHTML = `
      <div class="ai-weekly-card">
        <div class="ai-weekly-title">🌤️ AI 心情週報</div>
        <p class="ai-weekly-response">${summary}</p>
      </div>`;
  } catch (error) {
    console.error('AI weekly summary failed', error);
    stopAIWeeklyStatus();
    container.innerHTML = `
      <div class="ai-weekly-card">
        <div class="ai-weekly-title">🌧️ AI 心情週報</div>
        <p class="ai-weekly-empty">AI 暫時無法生成週報，請稍後再試。</p>
      </div>`;
  }
}

export async function showSpinResult(resultData) {
  if (!resultData) return;

  const { task, w } = resultData;
  const pendingTask = await addPending(resultData);
  lastGeneratedTaskTs = pendingTask?.ts || null;

  const titleEl = $('#resultTitle');
  const catEl = $('#resultCat');
  const descEl = $('#resultDesc');
  const badgeEl = $('#resultBadge');
  if (titleEl) titleEl.innerHTML = `<b>${task.t}</b>`;
  if (catEl) catEl.textContent = task.c;
  if (descEl) descEl.textContent = task.d;
  if (badgeEl) {
    badgeEl.textContent = `情緒加權：${w}`;
    badgeEl.style.backgroundColor =
      w > 0 ? 'var(--yellow)' : w < 0 ? 'var(--blue)' : 'var(--muted)';
  }

  const loadingEl = $('#loading');
  const resultEl = $('#result');
  if (loadingEl) loadingEl.style.display = 'none';
  if (resultEl) resultEl.style.display = 'block';
  const diaryInput = $('#moodDiary');
  if (diaryInput) diaryInput.value = '';
  lastDiaryText = '';
  resetBottleShareToggle();
  updateAll();
}

// === 雲端資料操作 ===
async function saveLog(entry) {
  if (!userDocRef) return;
  const exists = (userData.logs || []).some((log) => log.ts === entry.ts);
  if (!exists) {
    await updateDoc(userDocRef, { logs: arrayUnion(entry) });
    userData.logs.push(entry);
  }
}

async function saveFav(entry) {
  if (!userDocRef) return;
  const exists = (userData.favs || []).some((fav) => fav.t === entry.t);
  if (!exists) {
    await updateDoc(userDocRef, { favs: arrayUnion(entry) });
    userData.favs.push(entry);
  }
}

async function savePending(entry) {
  if (!userDocRef) return;
  await updateDoc(userDocRef, { pending: arrayUnion(entry) });
  if (!userData.pending) userData.pending = [];
  userData.pending.push(entry);
}

async function addPending(data) {
  const diarySource = typeof data.diary === 'string' ? data.diary : lastDiaryText;
  const diary = diarySource ? diarySource.trim() : '';
  const descriptionText = typeof data.description === 'string' ? data.description : lastDescription;
  const note = diary || (descriptionText ? descriptionText.trim() : '');
  const newTask = {
    t: data.task.t,
    c: data.task.c,
    d: data.task.d,
    emotion: chosenEmotion,
    ts: Date.now(),
    w: data.w,
    note,
    diary
  };
  await savePending(newTask);
  renderPending();
  return newTask;
}

// === 資料存取器 ===
function logs() {
  return (userData.logs || []).slice().sort((a, b) => b.ts - a.ts);
}
function favs() {
  return userData.favs || [];
}
function pendings() {
  return (userData.pending || []).slice().sort((a, b) => b.ts - a.ts);
}

// === 畫面渲染 ===
window.removePending = async (el) => {
  const index = Number(el.getAttribute('data-index'));
  const target = pendings()[index];
  if (!target) return;
  const newPending = (userData.pending || []).filter((task) => task.ts !== target.ts);
  userData.pending = newPending;
  if (userDocRef) await updateDoc(userDocRef, { pending: newPending });
  updateAll();
};

window.completeTask = async (el) => {
  const index = Number(el.getAttribute('data-index'));
  const target = pendings()[index];
  if (!target) return;
  const newPending = (userData.pending || []).filter((task) => task.ts !== target.ts);
  userData.pending = newPending;
  if (userDocRef) await updateDoc(userDocRef, { pending: newPending });
  await saveLog(target);
  updateAll();
};

window.addToFavorites = async (el, sourceList) => {
  const index = Number(el.getAttribute('data-index'));
  const collection = sourceList === 'pending' ? pendings() : logs();
  const taskData = collection[index];
  if (taskData) {
    await saveFav(taskData);
    renderFavs();
    alert('已加入療癒清單！');
  }
};

window.removeFav = async (el) => {
  const index = Number(el.getAttribute('data-index'));
  const target = favs()[index];
  if (!target) return;
  const newFavs = favs().filter((fav) => fav.t !== target.t);
  userData.favs = newFavs;
  if (userDocRef) await updateDoc(userDocRef, { favs: newFavs });
  renderFavs();
};

function renderPending() {
  const box = $('#pendingTasks');
  if (!box) return;
  const data = pendings();
  box.innerHTML = '';

  if (!data.length) {
    box.innerHTML = "<div class='pending-note'>✨ 尚無待完成任務！</div>";
    return;
  }

  data.forEach((task, index) => {
    const weightInfo = typeof task.w === 'number' ? `｜加權值 ${task.w}` : '';
    box.innerHTML += `
      <div class="pending-item">
        <div>
          <h3>${task.t} <span class="small">[${task.c}]</span></h3>
          <p>${task.d}</p>
          <div class="small">心情：${task.emotion}${weightInfo}</div>
        </div>
        <div class="pending-actions">
          <button class="btn small success" data-index="${index}" onclick="completeTask(this)">完成</button>
          <button class="btn small muted" data-index="${index}" onclick="addToFavorites(this, 'pending')">收藏</button>
          <button class="btn small muted" data-index="${index}" onclick="removePending(this)">移除</button>
        </div>
      </div>`;
  });
}

function renderLog() {
  const box = $('#log');
  if (!box) return;
  box.innerHTML = '';
  const data = logs().slice(0, 30);

  if (data.length === 0) {
    box.innerHTML = "<div class='small'>尚無紀錄</div>";
    return;
  }

  const countMap = {};
  logs().forEach((log) => {
    countMap[log.t] = (countMap[log.t] || 0) + 1;
  });

  data.forEach((task, index) => {
    const weightInfo = typeof task.w === 'number' ? `｜加權值: ${task.w}` : '';
    const noteText = getDiaryText(task);
    const diaryLine = noteText ? `<div class="meta">日記：${noteText}</div>` : '';
    box.innerHTML += `
      <div class='item'>
        <div>
          <div><b>${task.t}</b> <span class="small">（已完成 ${countMap[task.t]} 次）</span></div>
          <div class="meta">${task.c}｜${task.emotion} ${weightInfo}｜${fmtDate(task.ts)}</div>
          ${diaryLine}
        </div>
        <div class="log-actions">
          <button class="btn-fav" data-index="${index}" onclick="addToFavorites(this, 'log')">⭐ 加入清單</button>
        </div>
      </div>`;
  });
}

function renderFavs() {
  const box = $('#favorites');
  if (!box) return;
  box.innerHTML = '';
  const data = favs();
  if (data.length === 0) {
    box.innerHTML = "<div class='small'>尚無清單</div>";
    return;
  }

  data.forEach((task, index) => {
    box.innerHTML += `
      <div class='item'>
        <div>
          <div>${task.t}</div>
          <div class="meta">${task.c}｜${task.d}</div>
        </div>
        <button class="btn-fav-remove" data-index="${index}" onclick="removeFav(this)">✕</button>
      </div>`;
  });
}

function renderDiaries() {
  const box = $('#diaryList');
  if (!box) return;
  const data = logs();
  const filtered = diaryFilter === 'ALL' ? data : data.filter((entry) => entry.emotion === diaryFilter);
  box.innerHTML = '';
  if (!filtered.length) {
    const note = diaryFilter === 'ALL'
      ? '尚無日記紀錄，先去轉一顆扭蛋吧！'
      : `目前沒有 ${diaryFilter} 的日記，分享一點心情吧！`;
    box.innerHTML = `<div class='pending-note'>${note}</div>`;
    return;
  }

  const timelineItems = filtered.map((entry) => {
    const moodStyle = MOOD_STYLES[entry.emotion] || DEFAULT_MOOD_STYLE;
    const ts = new Date(entry.ts);
    const day = ts.toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' });
    const clock = ts.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    const note = getDiaryText(entry) || '（未留下日記）';
    return `
      <div class="timeline-item">
        <div class="timeline-time">
          <div class="day">${day}</div>
          <div class="clock">${clock}</div>
        </div>
        <div class="timeline-track">
          <div class="timeline-dot" style="background:${moodStyle.dot};"></div>
        </div>
        <div class="timeline-card" data-diary-ts="${entry.ts}" style="background:${moodStyle.gradient};">
          <div class="timeline-chip">${entry.emotion} · ${entry.c}</div>
          <h3>${entry.t}</h3>
          <div class="note view-mode">${note}</div>
          <textarea class="note-editor" style="display:none;">${note}</textarea>
          <div class="note-actions view-mode">
            <button class="btn small edit-note" data-ts="${entry.ts}">✏️ 編輯</button>
          </div>
          <div class="note-actions edit-mode" style="display:none;">
            <button class="btn small save-note" data-ts="${entry.ts}">儲存</button>
            <button class="btn small cancel-note" data-ts="${entry.ts}">取消</button>
          </div>
          <div class="meta">完成時間：${fmtDate(entry.ts)}</div>
        </div>
      </div>`;
  });
  box.innerHTML = `<div class="timeline-list">${timelineItems.join('')}</div>`;

  box.querySelectorAll('.edit-note').forEach((btn) => {
    btn.addEventListener('click', () => enterDiaryEdit(btn.dataset.ts));
  });
  box.querySelectorAll('.save-note').forEach((btn) => {
    btn.addEventListener('click', () => saveDiaryEdit(btn.dataset.ts, btn));
  });
  box.querySelectorAll('.cancel-note').forEach((btn) => {
    btn.addEventListener('click', () => cancelDiaryEdit(btn.dataset.ts));
  });
}

function summarizeWeek() {
  const weekRange = $('#weekRange');
  const barTasks = $('#barTasks');
  if (!weekRange || !barTasks) return;

  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay());
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);

  const data = logs().filter((log) => log.ts >= start.getTime() && log.ts < end.getTime());
  const total = data.length;
  let reds = 0; let blues = 0; let yellows = 0;
  let totalWeight = 0;

  data.forEach((log) => {
    if (log.emotion === '壓力') reds++;
    if (log.emotion === '焦慮') blues++;
    if (log.emotion === '開心') yellows++;
    if (typeof log.w === 'number') totalWeight += log.w;
  });

  const maxBar = Math.max(1, reds + blues + yellows, 5);
  const barRed = $('#barRed');
  const barBlue = $('#barBlue');
  const barYellow = $('#barYellow');
  if (barTasks) barTasks.style.width = `${Math.min(100, (total / maxBar) * 100)}%`;
  if (barRed) barRed.style.width = `${(reds / maxBar) * 100}%`;
  if (barBlue) barBlue.style.width = `${(blues / maxBar) * 100}%`;
  if (barYellow) barYellow.style.width = `${(yellows / maxBar) * 100}%`;

  const todayCount = data.filter((log) => new Date(log.ts).toDateString() === new Date().toDateString()).length;
  const s = start.toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' });
  const e = now.toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' });
  const weightInfo = totalWeight !== 0 ? `｜加權總分 ${totalWeight}` : '';
  weekRange.textContent = `區間 ${s}–${e} ｜ 本週完成 ${total} ｜ 今日完成 ${todayCount} ${weightInfo}`;
}

function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function calcStreak() {
  const streakEl = $('#streak');
  if (!streakEl) return;
  const data = logs();
  const days = new Set(data.map((item) => new Date(item.ts).toDateString()));
  let streak = 0;
  const check = new Date();
  while (days.has(check.toDateString())) {
    streak++;
    check.setDate(check.getDate() - 1);
  }
  streakEl.textContent = `連續天數 ${streak}`;
}

function updateAll() {
  renderLog();
  renderFavs();
  renderPending();
  renderDiaries();
  calcStreak();
  summarizeWeek();
}

async function handleRespin() {
  const resultEl = $('#result');
  const loadingEl = $('#loading');
  if (resultEl) resultEl.style.display = 'none';
  if (loadingEl) loadingEl.style.display = 'none';
  const gachaAnim = $('#gachaAnim');
  if (gachaAnim) gachaAnim.style.display = 'block';
  if (gachaAnim) gachaAnim.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const diaryInput = $('#moodDiary');
  if (diaryInput) diaryInput.value = '';
  lastDiaryText = '';
  const descInput = $('#emotionDescription');
  if (descInput) descInput.value = '';
  lastDescription = '';
  resetBottleShareToggle();
  shouldRequestVariant = true;

  if (lastGeneratedTaskTs) {
    const pendingList = userData.pending || [];
    const targetIndex = pendingList.findIndex((task) => task.ts === lastGeneratedTaskTs);
    if (targetIndex !== -1) {
      pendingList.splice(targetIndex, 1);
      userData.pending = pendingList;
      if (userDocRef) {
        await updateDoc(userDocRef, { pending: pendingList });
      }
      updateAll();
    }
    lastGeneratedTaskTs = null;
  }
}

async function closeAndArchiveLast() {
  const resultEl = $('#result');
  const loadingEl = $('#loading');
  const diaryInput = $('#moodDiary');
  if (diaryInput) diaryInput.value = '';
  lastDiaryText = '';
  resetBottleShareToggle();
  if (resultEl) resultEl.style.display = 'none';
  if (loadingEl) loadingEl.style.display = 'none';

  lastGeneratedTaskTs = null;

  const modal = $('#gachaModal');
  if (modal) modal.classList.remove('show');
}

function enterDiaryEdit(ts) {
  const card = document.querySelector(`.timeline-card[data-diary-ts="${ts}"]`);
  if (!card) return;
  card.classList.add('editing');
  const noteView = card.querySelector('.note.view-mode');
  const editor = card.querySelector('.note-editor');
  const viewActions = card.querySelector('.note-actions.view-mode');
  const editActions = card.querySelector('.note-actions.edit-mode');
  if (noteView) noteView.style.display = 'none';
  if (editor) {
    editor.style.display = 'block';
    editor.focus();
  }
  if (viewActions) viewActions.style.display = 'none';
  if (editActions) editActions.style.display = 'flex';
}

function cancelDiaryEdit(ts) {
  const card = document.querySelector(`.timeline-card[data-diary-ts="${ts}"]`);
  if (!card) return;
  card.classList.remove('editing');
  const noteView = card.querySelector('.note.view-mode');
  const editor = card.querySelector('.note-editor');
  const viewActions = card.querySelector('.note-actions.view-mode');
  const editActions = card.querySelector('.note-actions.edit-mode');
  if (noteView) noteView.style.display = 'block';
  if (editor) {
    editor.value = noteView ? noteView.textContent : editor.value;
    editor.style.display = 'none';
  }
  if (viewActions) viewActions.style.display = 'flex';
  if (editActions) editActions.style.display = 'none';
}

async function saveDiaryEdit(ts, button) {
  const card = document.querySelector(`.timeline-card[data-diary-ts="${ts}"]`);
  if (!card) return;
  const editor = card.querySelector('.note-editor');
  if (!editor) return;
  const newText = editor.value.trim();
  const originalLabel = button.textContent;
  button.textContent = '儲存中...';
  button.disabled = true;
  try {
    await updateDiaryEntry(Number(ts), newText);
  } catch (err) {
    console.error('更新日記失敗', err);
    alert('儲存失敗，請稍後再試。');
  } finally {
    button.textContent = originalLabel;
    button.disabled = false;
  }
}

async function updateDiaryEntry(timestamp, newText) {
  const entryIndex = (userData.logs || []).findIndex((log) => log.ts === timestamp);
  if (entryIndex === -1) throw new Error('找不到目標日記');
  const sanitized = newText || '';
  userData.logs[entryIndex].diary = sanitized;
  userData.logs[entryIndex].note = sanitized;
  if (userDocRef) {
    await updateDoc(userDocRef, { logs: userData.logs });
  }
  updateAll();
}

function pickTask(emotion) {
  const common = [
    { t: '三件感恩', c: '感恩練習', d: '寫下今天讓你感謝的三件小事。' },
    { t: '十分鐘散步', c: '身體律動', d: '到戶外散步 10 分鐘，感受陽光與微風。' },
    { t: '喝一杯水', c: '自我照顧', d: '慢慢喝完一杯溫水，覺察身體放鬆。' }
  ];
  const pools = {
    壓力: [
      { t: '紙張傾倒法', c: '情緒釋放', d: '寫下所有讓你壓力的事，撕掉後深呼吸。' },
      { t: '肩頸伸展', c: '身體放鬆', d: '做 2 分鐘肩頸轉動與伸展。' }
    ],
    焦慮: [
      { t: '方形呼吸', c: '呼吸練習', d: '吸 4 秒、停 4 秒、吐 4 秒、停 4 秒，重複 5 次。' },
      { t: '感官點數', c: '專注練習', d: '說出眼前 5 件東西、4 種觸感、3 個聲音等。' }
    ],
    開心: [
      { t: '分享喜悅', c: '社交連結', d: '把今天最開心的事傳訊息給朋友。' },
      { t: '快樂存摺', c: '記錄', d: '寫下一句話記錄剛剛的開心瞬間。' }
    ],
    疲憊: [
      { t: '閉眼呼吸 1 分鐘', c: '靜心', d: '找個舒適位置閉眼深呼吸，專注氣息。' },
      { t: '手掌療癒', c: '舒緩', d: '輕捏手掌與指節，提醒自己放鬆。' }
    ],
    迷茫: [
      { t: '寫下一句目標', c: '方向澄清', d: '寫一句話描述此刻最想完成的事。' },
      { t: '今日色彩', c: '情緒覺察', d: '選擇一種顏色形容此刻心情並寫下原因。' }
    ],
    平靜: [
      { t: '靜坐 1 分鐘', c: '平衡', d: '保持舒適坐姿，閉眼感受呼吸與身體。' },
      { t: '慢動作伸展', c: '身體覺察', d: '緩慢伸展手臂與背部，觀察肌肉變化。' }
    ]
  };
  const pool = [...common, ...(pools[emotion] || [])];
  return pool[Math.floor(Math.random() * pool.length)];
}

function exportToJPG() {
  if (typeof html2canvas === 'undefined') {
    alert('截圖工具尚未載入完成，請稍候或重新整理。');
    return;
  }

  const data = logs();
  if (!data.length) {
    alert('尚無心情紀錄，先轉一顆扭蛋再來匯出吧！');
    return;
  }

  const emotions = MOOD_TYPES;

  const moodCounts = emotions.reduce((acc, emotion) => {
    acc[emotion] = data.filter((log) => log.emotion === emotion).length;
    return acc;
  }, {});
  const maxCount = Math.max(...Object.values(moodCounts), 1);

  const diaryCandidates = data
    .filter((entry) => Boolean(getDiaryText(entry)))
    .slice(0, 5);
  const desiredDiaryCount = Math.min(5, data.length);
  if (diaryCandidates.length < desiredDiaryCount) {
    for (const entry of data) {
      if (diaryCandidates.find((item) => item.ts === entry.ts)) continue;
      diaryCandidates.push(entry);
      if (diaryCandidates.length >= desiredDiaryCount) break;
    }
  }
  const diaries = diaryCandidates.slice(0, Math.max(1, Math.min(5, Math.max(3, desiredDiaryCount))));

  const now = new Date();
  const dateDisplay = now.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const fileDate = dateDisplay.replace(/[^\d]/g, '');
  const startLog = data[data.length - 1];
  const endLog = data[0];
  const startRange = startLog
    ? new Date(startLog.ts).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' })
    : dateDisplay;
  const endRange = endLog
    ? new Date(endLog.ts).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' })
    : dateDisplay;

  const reportRoot = document.createElement('div');
  Object.assign(reportRoot.style, {
    position: 'fixed',
    top: '-10000px',
    left: '-10000px',
    width: '1080px',
    maxWidth: '1080px',
    padding: '48px',
    borderRadius: '32px',
    background: 'rgba(255, 255, 255, 0.9)',
    backdropFilter: 'blur(18px)',
    boxShadow: '0 40px 90px rgba(44, 62, 80, 0.25)',
    color: '#2c3e50',
    fontFamily: '"Noto Sans TC","Noto Sans",sans-serif',
    lineHeight: '1.6',
    display: 'flex',
    flexDirection: 'column',
    gap: '32px'
  });

  const header = document.createElement('div');
  Object.assign(header.style, { display: 'flex', flexDirection: 'column', gap: '6px' });
  header.innerHTML = `
    <div style="font-size: 18px; letter-spacing: 2px; color: #5f6f81;">MOOD WEEKLY</div>
    <div style="font-size: 42px; font-weight: 900;">我的心情週報</div>
    <div style="font-size: 16px; color: #5f6f81;">統計區間：${startRange} – ${endRange} ｜ 匯出日期：${dateDisplay}</div>
  `;
  reportRoot.appendChild(header);

  const chartBlock = document.createElement('div');
  Object.assign(chartBlock.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    padding: '32px',
    borderRadius: '28px',
    background: 'rgba(255, 255, 255, 0.85)',
    boxShadow: '0 30px 60px rgba(44, 62, 80, 0.12)'
  });
  chartBlock.innerHTML = `
    <div>
      <div style="font-size: 20px; font-weight: 800;">心情直方圖</div>
      <div style="font-size: 14px; color: #5f6f81;">橫軸：情緒種類 ｜ 縱軸：次數</div>
    </div>
  `;

  const barRow = document.createElement('div');
  Object.assign(barRow.style, {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
    gap: '18px',
    minHeight: '240px',
    alignItems: 'end'
  });

  emotions.forEach((emotion) => {
    const wrapper = document.createElement('div');
    Object.assign(wrapper.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '10px'
    });

    const barShell = document.createElement('div');
    Object.assign(barShell.style, {
      width: '100%',
      height: '220px',
      borderRadius: '24px',
      background: 'rgba(95, 111, 129, 0.12)',
      padding: '6px',
      display: 'flex',
      alignItems: 'flex-end'
    });

    const barFill = document.createElement('div');
    Object.assign(barFill.style, {
      width: '100%',
      borderRadius: '18px',
      background: (MOOD_STYLES[emotion] || DEFAULT_MOOD_STYLE).gradient,
      height: `${Math.max(6, (moodCounts[emotion] / maxCount) * 100)}%`,
      boxShadow: '0 15px 30px rgba(0,0,0,0.08)'
    });

    barShell.appendChild(barFill);

    const barCount = document.createElement('div');
    Object.assign(barCount.style, { fontWeight: '800', fontSize: '18px' });
    barCount.textContent = `${moodCounts[emotion]} 次`;

    const barLabel = document.createElement('div');
    Object.assign(barLabel.style, {
      fontSize: '17px',
      fontWeight: '800',
      color: '#34495e',
      textShadow: '0 4px 12px rgba(255,255,255,0.85)'
    });
    barLabel.textContent = emotion;

    wrapper.appendChild(barShell);
    wrapper.appendChild(barCount);
    wrapper.appendChild(barLabel);
    barRow.appendChild(wrapper);
  });

  chartBlock.appendChild(barRow);
  reportRoot.appendChild(chartBlock);

  const diaryBlock = document.createElement('div');
  Object.assign(diaryBlock.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
    padding: '32px',
    borderRadius: '28px',
    background: 'rgba(255, 255, 255, 0.85)',
    boxShadow: '0 30px 60px rgba(44, 62, 80, 0.12)'
  });
  diaryBlock.innerHTML = `
    <div>
      <div style="font-size: 20px; font-weight: 800;">心情小日記</div>
      <div style="font-size: 14px; color: #5f6f81;">最近 ${diaries.length} 則感受精選</div>
    </div>
  `;

  const diaryList = document.createElement('div');
  Object.assign(diaryList.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  });

  diaries.forEach((entry, index) => {
    const note = getDiaryText(entry) || '（此刻留白，情緒也在好好呼吸。）';
    const diaryItem = document.createElement('div');
    Object.assign(diaryItem.style, {
      padding: '20px',
      borderRadius: '22px',
      background: 'rgba(255, 255, 255, 0.95)',
      border: '1px solid rgba(95, 111, 129, 0.08)',
      boxShadow: '0 10px 30px rgba(44, 62, 80, 0.08)'
    });
    diaryItem.innerHTML = `
      <div style="font-size: 14px; color: #5f6f81; text-shadow: 0 4px 15px rgba(255,255,255,0.9);">${index + 1}. ${entry.emotion} ｜ ${fmtDate(entry.ts)}</div>
      <div style="font-size: 18px; font-weight: 700; margin-top: 6px; color: #2c3e50; text-shadow: 0 4px 15px rgba(255,255,255,0.9);">${entry.c} · ${entry.t}</div>
      <div style="margin-top: 8px; font-family: 'Klee One','Noto Sans TC',cursive; font-size: 1.2rem; color: #4a4036; text-shadow: 0 6px 18px rgba(255,255,255,0.95); line-height: 1.9;">${note}</div>
    `;
    diaryList.appendChild(diaryItem);
  });

  diaryBlock.appendChild(diaryList);
  reportRoot.appendChild(diaryBlock);

  document.body.appendChild(reportRoot);

  const baseScale = 3;
  const dpiScale = 300 / 96;

  html2canvas(reportRoot, {
    scale: baseScale,
    useCORS: true,
    backgroundColor: 'rgba(255, 255, 255, 0.9)'
  })
    .then((canvas) => {
      let exportCanvas = canvas;
      if (dpiScale > baseScale) {
        const upscaleRatio = dpiScale / baseScale;
        const scaledCanvas = document.createElement('canvas');
        scaledCanvas.width = Math.round(canvas.width * upscaleRatio);
        scaledCanvas.height = Math.round(canvas.height * upscaleRatio);
        const ctx = scaledCanvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(canvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
        exportCanvas = scaledCanvas;
      }
      const link = document.createElement('a');
      link.href = exportCanvas.toDataURL('image/jpeg', 0.95);
      link.download = `我的心情週報_${fileDate}.jpg`;
      link.click();
    })
    .catch((err) => {
      console.error('exportToJPG failed', err);
      alert('匯出失敗，請稍後再試。');
    })
    .finally(() => {
      reportRoot.remove();
    });
}
