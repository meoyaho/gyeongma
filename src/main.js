import './style.css';
import './interface.css';
import { validateName, suggestions, MIN_SPEED, MAX_SPEED, RACE_DISTANCE } from '../shared/rules.js';
import { RaceScene } from './scene.js';
import { VoiceController, getVoiceEnvironment } from './voice.js';
import { GameAudio } from './audio.js';
import { horseAppearance } from '../shared/horse-appearances.js';

const icons = {
  horse: '<path d="m8 20 1-6-3-3 6-8 2 5 5 3 1 5-5 1-1 3M12 8l-2 3 4 2M15 11h.01"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
  people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3a4 4 0 0 1 0 8"/><circle cx="9" cy="7" r="4"/>',
  shuffle: '<path d="m18 3 3 3-3 3m0 6 3 3-3 3M3 6h3c5 0 7 12 12 12h3M3 18h3c2 0 3-2 4-4m4-4c1-2 2-4 4-4h3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  flag: '<path d="M5 22V3m0 0c5-5 9 5 14 0v11c-5 5-9-5-14 0"/>',
  volume: '<path d="m11 5-6 4H2v6h3l6 4zm4 3a5 5 0 0 1 0 8m3-11a9 9 0 0 1 0 14"/>',
  link: '<path d="m10 13 4-4m-7 5-1 1a4 4 0 0 0 6 6l4-4a4 4 0 0 0 0-6M8 13a4 4 0 0 1 0-6l4-4a4 4 0 0 1 6 6l-1 1"/>',
  trophy: '<path d="M8 3h8v7a4 4 0 0 1-8 0zm0 2H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v6m-5 1h10"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h1m3 0h1m3 0h1m3 0h1M6 13h1m3 0h1m3 0h1m3 0h1M7 16h10"/>',
};
const icon = name => `<svg class="icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let inviteCode = new URL(location.href).searchParams.get('room')?.toUpperCase();
const serverOrigin = (import.meta.env.VITE_SERVER_ORIGIN || location.origin).replace(/\/$/, '');
const apiUrl = path => `${serverOrigin}${path}`;
const websocketUrl = `${serverOrigin.replace(/^http/, 'ws')}/ws`;
const voiceEnvironment = getVoiceEnvironment();
const externalBrowser = voiceEnvironment.ios ? 'Safari' : 'Chrome';
const browserHelp = id => voiceEnvironment.instagram ? `<div class="browser-help"><p>인스타그램에서는 음성 인식이 제한될 수 있어요. 주소를 복사해 <b>${externalBrowser} 앱</b>에서 열어주세요.</p><input id="${id}-value" class="browser-url" aria-label="${externalBrowser}에서 열 주소" value="${escape(location.href)}" readonly/><button id="${id}" class="button secondary full-width">${icon('link')} 주소 복사</button></div>` : '';
let room = null, myId = null, ws = null, activeName = '', mode = 'solo', inputMode = 'voice', micReady = false, voiceBusy = false, view = 'home', localCalls = 0, keyboardCallLocked = false, keyboardComposing = false, sound = false, lastHoof = 0;
const musicSources = {
  lobby: encodeURI(`${import.meta.env.BASE_URL}대기실.mp3`),
  racing: encodeURI(`${import.meta.env.BASE_URL}경주.mp3`),
};
const audio = new GameAudio({
  sources: musicSources,
  shouldResume: () => sound || voice.active,
  onError: error => {
    console.warn('배경음 재생 실패:', error);
    toast('음악을 재생하지 못했어요. 사운드를 껐다가 다시 켜주세요.');
  },
});
function syncMusic(retry = false) {
  // Once unlocked, keep the loop running at zero gain when sound is OFF.
  if (!audio.context && !sound) return;
  const track = room?.phase === 'finished' ? null : room?.phase === 'racing' ? 'racing' : 'lobby';
  void audio.setTrack(track, retry);
}
let timeOffset = 0, lastSuggestion = '', lastLobbySignature = '', confirmedName = '';
let nameValidationRevision = 0, nameValidationController = null, reservationToken = null;
const randomAppearance = () => crypto.getRandomValues(new Uint32Array(1))[0] % 8;
let currentAppearance = randomAppearance();

document.querySelector('#app').innerHTML = `
  <div id="home-view">
    <button id="home-sound-button" class="race-button home-sound-button" aria-label="배경음 켜기">${icon('volume')} <span>OFF</span></button>
    <main class="home-main">
      <div class="hero-grid">
        <section class="paddock ${inviteCode ? 'awaiting-horse' : ''}" aria-label="내 말 미리보기">
          <div class="horse-figure">
            <img id="horse-portrait" src="${horseAppearance(currentAppearance).src}" alt="${horseAppearance(currentAppearance).label}" draggable="false"/>
            <strong id="preview-name" class="preview-name">내 이름은 ???</strong>
          </div>
        </section>
        <section class="hero-content">
          <h1>경주 준비</h1>
          ${browserHelp('copy-browser-url')}
          ${inviteCode ? `<div id="invite-banner" class="invite-banner">${icon('people')} <span>초대방 확인 중</span><b>${escape(inviteCode)}</b></div>` : ''}
          <section class="name-card" aria-labelledby="name-title">
            <div class="name-heading"><label id="name-title" for="horse-name">말 이름</label></div>
            <div class="name-entry-row"><div class="name-input-wrap"><input id="horse-name" placeholder="이름 입력" maxlength="64" autocomplete="off" spellcheck="false" aria-label="말 이름" aria-describedby="name-feedback"/><button id="shuffle" class="icon-button" aria-label="말 이름 무작위 추천" title="이름 추천">${icon('shuffle')}</button></div><button id="confirm-name" class="button secondary">${inviteCode ? '완료' : '확인'}</button></div>
            <p id="name-feedback" class="name-feedback" aria-live="polite"></p>
            <div class="play-actions ${inviteCode ? 'hidden' : ''}">
              <button id="solo-button" disabled class="button primary" aria-label="혼자 달리기"><span class="action-copy"><strong>혼자 달리기</strong><small>AI 7마리와 경주</small></span>${icon('arrow')}</button>
              <button id="friends-button" disabled class="button secondary" aria-label="${inviteCode ? '초대 경주 참여' : '친구와 달리기'}"><span class="action-copy"><strong>${inviteCode ? '초대 경주 참여' : '친구와 달리기'}</strong><small>2~8명 · 링크 초대</small></span>${icon('arrow')}</button>
            </div>
          </section>
        </section>
      </div>
    </main>
  </div>
  <section id="race-view" class="hidden" aria-label="경주 화면">
    <div id="race-scene"></div><div class="race-vignette"></div>
    <div class="race-top"><button id="leave-race" class="race-button">← 나가기</button><button id="sound-button" class="race-button" aria-label="사운드 켜기">${icon('volume')} <span>OFF</span></button></div>
    <div class="race-hud"><div class="rank-box"><span class="tiny-label">현재 순위</span><div><b id="race-rank">1</b><span id="race-field"> / 8</span></div></div><div class="progress-box"><div><span id="race-horse-name"></span><b id="race-distance">0 / ${RACE_DISTANCE}m</b></div><div class="race-progress-track"><i id="race-progress"></i></div><small id="race-time">00.00</small></div></div>
    <div id="leaderboard" class="leaderboard"></div>
    <div id="countdown" class="countdown hidden"><strong id="countdown-number">3</strong></div>
    <div class="race-controls"><div class="speed-readout"><b id="speed-value">18</b><span>km/h</span><small id="speed-label">기본 속도</small></div><div class="shout-panel"><div class="shout-label"><span id="input-status">${icon('mic')} 이름을 불러주세요</span><span id="call-count">0회 인식</span></div><strong id="shout-name"></strong><div id="voice-bars" class="voice-bars">${Array.from({ length: 25 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div><small id="voice-meter-caption" class="meter-caption">${voiceEnvironment.mobile ? '음성 인식 반응' : '마이크 음량'}</small><p id="transcript"></p><input id="keyboard-name-input" class="keyboard-name-input hidden" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="경주마 이름 따라 쓰기"/><button id="reconnect-mic" class="button secondary hidden">마이크 다시 연결</button></div><div class="boost-readout"><span>가속</span><div class="boost-track"><i id="boost-fill"></i></div><b id="boost-value">0%</b></div></div>
  </section>
  <dialog id="lobby-dialog" class="modal" aria-labelledby="lobby-title"><div class="modal-scroll"><h2 id="lobby-title">마이크 설정</h2><p id="lobby-description"></p><div id="invite-area" class="hidden"><label for="invite-link">초대 링크</label><div class="invite-link-row"><input id="invite-link" readonly/><button id="copy-link" class="button secondary">${icon('link')} 복사</button></div></div><div id="lobby-players" class="lobby-players"></div>${browserHelp('copy-lobby-browser-url')}<div class="mic-test"><div><span class="mic-test-icon">${icon('mic')}</span><div><b id="mic-title">마이크를 연결해주세요</b><p id="mic-description"></p></div></div><div class="mic-meter"><i id="mic-meter-fill"></i></div>${voiceEnvironment.mobile ? '' : '<small class="meter-caption">마이크 음량</small>'}<p id="mic-transcript" aria-live="polite"></p></div><p class="privacy-note">음성은 브라우저 인식 서비스에서 처리될 수 있습니다.</p><div id="lobby-error" class="inline-error hidden" role="alert"></div><button id="connect-mic" class="button primary full-width">${icon('mic')} 마이크 연결하기</button><button id="start-race" class="button primary full-width hidden">${icon('flag')} 경주 시작하기 ${icon('arrow')}</button><button id="practice-button" class="practice-button">키보드로 체험 ${icon('arrow')}</button><p id="lobby-wait" class="lobby-wait"></p></div></dialog>
  <dialog id="result-dialog" class="modal result-modal"><div class="modal-scroll"><div class="result-icon">${icon('trophy')}</div><h2 id="result-title">경주 결과</h2><p id="result-description"></p><div class="result-stats"><div><span>완주 기록</span><b id="result-time"></b></div><div><span>인식 횟수</span><b id="result-calls"></b></div></div><div id="result-board"></div><p id="result-wait" class="lobby-wait"></p><button id="replay" class="button primary full-width">다시 경주 ${icon('arrow')}</button><button id="result-home" class="button secondary full-width">처음으로</button></div></dialog>
  <div id="toast" class="toast hidden" role="status"></div>
`;

const $ = id => document.getElementById(id);
const show = (id, visible = true) => $(id).classList.toggle('hidden', !visible);
let scene = null;
function toast(message) { $('toast').textContent = message; show('toast'); clearTimeout(toast.timer); toast.timer = setTimeout(() => show('toast', false), 4000); }
function lobbyError(message = '') { $('lobby-error').textContent = message; show('lobby-error', !!message); }
function updateLobbyPageHeight() {
  if (innerWidth <= 760 && $('lobby-dialog').open) $('home-view').style.minHeight = `${450 + $('lobby-dialog').offsetHeight + 48}px`;
  else $('home-view').style.removeProperty('min-height');
}
function setName(name) { $('horse-name').value = name; updateName(); }
function updateName() {
  nameValidationRevision++;
  nameValidationController?.abort();
  nameValidationController = null;
  $('confirm-name').disabled = false;
  confirmedName = '';
  $('name-feedback').textContent = '';
  $('name-feedback').className = 'name-feedback';
  $('name-feedback').removeAttribute('role');
  $('horse-name').setAttribute('aria-invalid', 'false');
  setPreviewName();
  $('solo-button').disabled = $('friends-button').disabled = true;
  $('confirm-name').textContent = inviteCode ? '완료' : '확인';
}
async function confirmName() {
  const name = $('horse-name').value;
  const revision = ++nameValidationRevision;
  nameValidationController?.abort();
  confirmedName = '';
  $('solo-button').disabled = $('friends-button').disabled = true;
  let result = validateName(name);
  if (result.ok) {
    const controller = nameValidationController = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    $('confirm-name').disabled = true;
    $('confirm-name').textContent = '확인 중';
    $('name-feedback').className = 'name-feedback';
    $('name-feedback').setAttribute('role', 'status');
    $('name-feedback').textContent = '이름을 확인하고 있습니다.';
    try {
      const response = await fetch(apiUrl('/api/validate-name'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, roomCode: inviteCode, reservationToken }), signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok || data.ok !== true) result = { ok: false, message: data.message || '이름을 확인하지 못했습니다. 다시 시도해주세요.' };
      else {
        result = data;
      }
    } catch {
      result = { ok: false, message: '이름 조회를 완료하지 못했습니다. 잠시 후 다시 확인해주세요.' };
    } finally { clearTimeout(timeout); }
  }
  // An old response must never approve a different, newly edited name.
  if (revision !== nameValidationRevision || $('horse-name').value !== name) return;
  nameValidationController = null;
  confirmedName = result.ok ? name : '';
  $('name-feedback').setAttribute('role', result.ok ? 'status' : 'alert');
  $('name-feedback').textContent = result.ok ? '사용 가능한 이름입니다.' : result.message;
  $('name-feedback').className = `name-feedback ${result.ok ? 'valid' : 'invalid'}`;
  $('horse-name').setAttribute('aria-invalid', String(!result.ok));
  setPreviewName(result.ok ? name : '');
  $('solo-button').disabled = $('friends-button').disabled = !result.ok;
  $('confirm-name').disabled = false;
  $('confirm-name').textContent = inviteCode ? (result.ok ? '입장 중' : '완료') : (result.ok ? '완료' : '확인');
  if (!result.ok) $('horse-name').focus();
  if (result.ok && inviteCode) {
    $('confirm-name').disabled = true;
    const sent = await openRoom('friends', inviteCode);
    if (!sent) {
      $('confirm-name').disabled = false;
      $('confirm-name').textContent = '완료';
    }
  }
}
$('confirm-name').onclick = confirmName;
$('horse-name').addEventListener('input', () => updateName());
$('shuffle').onclick = () => {
  const current = $('horse-name').value;
  const pool = suggestions.filter(name => name !== current && name !== lastSuggestion);
  const random = crypto.getRandomValues(new Uint32Array(1))[0];
  lastSuggestion = pool[random % pool.length];
  setName(lastSuggestion);
};
$('solo-button').onclick = () => openRoom('solo');
$('friends-button').onclick = () => openRoom('friends', inviteCode);
$('horse-name').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); confirmName(); } });

let nameProgressTimer;
function clearNameProgress() {
  clearTimeout(nameProgressTimer);
  $('shout-name').classList.remove('is-complete');
  $('shout-name').querySelectorAll('.name-syllable').forEach(char => char.classList.remove('recognized'));
}
function paintNameProgress(progress, completed = false) {
  clearNameProgress();
  const length = completed && !progress ? activeName.length : progress;
  $('shout-name').querySelectorAll('.name-syllable').forEach((char, index) => char.classList.toggle('recognized', index < length));
  $('shout-name').classList.toggle('is-complete', completed && !progress);
  if (completed && !progress) nameProgressTimer = setTimeout(clearNameProgress, 250);
}

const voice = new VoiceController({
  getAudioContext: () => audio.getContext(),
  acquireAudioSession: () => audio.acquireCaptureSession(),
  onCalls: count => {
    if (room?.phase === 'racing') send({ type: 'call', count });
    else if (room?.phase === 'lobby') { localCalls += count; $('mic-transcript').textContent = `이름 ${localCalls}회 인식`; }
  },
  onStatus: (status, message) => {
    if (status === 'error') {
      micReady = false;
      if (room?.phase === 'lobby') { send({ type: 'ready', ready: false }); lobbyError(message); show('connect-mic'); $('connect-mic').disabled = false; }
      else { $('transcript').textContent = message; show('reconnect-mic'); }
      $('mic-title').textContent = '마이크 연결을 확인해주세요';
    } else if (status === 'checking') {
      $('mic-title').textContent = '음성 인식 확인 중'; $('mic-description').textContent = message;
    } else { $('mic-title').textContent = '음성 인식 연결됨'; $('mic-description').textContent = `“${activeName}”을 또렷하게 불러보세요.`; }
  },
  onTranscript: text => {
    if (room?.phase !== 'lobby') return;
    const count = `이름 ${localCalls}회 인식`;
    $('mic-transcript').textContent = text ? `${count} · ${text}` : count;
  },
  onProgress: ({ progress, calls }) => { if (room?.phase === 'racing') paintNameProgress(progress, calls > 0); },
  onLevel: level => { $('mic-meter-fill').style.width = `${Math.max(2, level * 100)}%`; document.querySelectorAll('#voice-bars i').forEach((bar, i) => { bar.style.height = `${5 + level * (15 + 20 * Math.abs(Math.sin(i * 2.3 + performance.now() / 150)))}px`; }); }
});
function send(data) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
function setPreviewName(name = '') {
  $('preview-name').textContent = `내 이름은 ${name || '???'}`;
}
function setPortrait(appearanceIndex = 0) {
  currentAppearance = appearanceIndex;
  const appearance = horseAppearance(appearanceIndex);
  const portrait = $('horse-portrait');
  portrait.dataset.appearance = String(appearanceIndex);
  portrait.src = appearance.src;
  portrait.alt = `왼쪽을 바라보는 ${appearance.label}`;
  const showAssignedHorse = () => { if (portrait.dataset.appearance === String(appearanceIndex)) document.querySelector('.paddock').classList.remove('awaiting-horse'); };
  portrait.addEventListener('load', showAssignedHorse, { once: true });
  if (portrait.complete && portrait.naturalWidth) showAssignedHorse();
}
async function connect() {
  if (ws?.readyState === WebSocket.OPEN) return;
  await new Promise((resolve, reject) => {
    const socket = ws = new WebSocket(websocketUrl);
    const timeout = setTimeout(() => { socket.close(); reject(new Error('서버에 연결하지 못했어요. 다시 시도해주세요.')); }, 8000);
    socket.onopen = () => { clearTimeout(timeout); resolve(); };
    socket.onerror = () => { clearTimeout(timeout); reject(new Error('경주 서버에 연결하지 못했어요. 서버 실행 상태를 확인해주세요.')); };
    socket.onmessage = event => receive(JSON.parse(event.data));
    socket.onclose = () => {
      clearTimeout(timeout);
      if (ws !== socket) return;
      if (room) { resetHome(); toast('서버 연결이 끊겼어요. 새 대기실을 만들어 다시 참여해주세요.'); }
    };
  });
}
async function openRoom(selectedMode, code) {
  if (!confirmedName || confirmedName !== $('horse-name').value) { $('confirm-name').focus(); return false; }
  if (openRoom.busy) return false;
  openRoom.busy = true;
  $('solo-button').disabled = $('friends-button').disabled = true;
  activeName = $('horse-name').value; mode = selectedMode; inputMode = 'voice'; micReady = false; localCalls = 0;
  try {
    await connect();
    lobbyError();
    send(code && reservationToken ? { type: 'claim', name: activeName, reservationToken } : code ? { type: 'join', code, name: activeName } : { type: 'create', mode, name: activeName, appearance: currentAppearance });
    return true;
  } catch (e) { toast(e.message); return false; }
  finally { openRoom.busy = false; $('solo-button').disabled = $('friends-button').disabled = !confirmedName || confirmedName !== $('horse-name').value; }
}
function receive(data) {
  if (data.type === 'reserved') {
    myId = data.id; reservationToken = data.reservationToken;
    setPortrait(data.appearance);
    return;
  }
  if (data.type === 'joined') {
    myId = data.id;
    if (data.name) {
      activeName = data.name;
      confirmedName = data.name;
      $('horse-name').value = data.name;
      setPreviewName(data.name);
    }
    if (data.mode === 'friends') {
      mode = 'friends'; inviteCode = data.code; reservationToken = null;
      const url = new URL(location.href); url.searchParams.set('room', data.code); history.replaceState(null, '', url);
    }
    return;
  }
  if (data.type === 'expired') { resetHome(); toast('대기실이 만료됐어요. 새 경주를 만들어주세요.'); return; }
  if (data.type === 'error') {
    if ($('lobby-dialog').open) lobbyError(data.message);
    else if (inviteCode && (!room || reservationToken)) {
      confirmedName = '';
      $('solo-button').disabled = $('friends-button').disabled = true;
      $('confirm-name').disabled = false;
      $('confirm-name').textContent = '완료';
      $('name-feedback').textContent = data.message;
      $('name-feedback').className = 'name-feedback invalid';
      $('name-feedback').setAttribute('role', 'alert');
      $('horse-name').setAttribute('aria-invalid', 'true');
    } else toast(data.message);
    return;
  }
  if (data.type !== 'state') return;
  const previousPhase = room?.phase;
  room = data; mode = data.mode; timeOffset = data.serverNow - Date.now();
  syncMusic();
  if (room.phase === 'lobby') {
    const me = room.players.find(player => player.id === myId);
    if (me?.reserved) {
      setPortrait(me.appearance);
      $('invite-banner').querySelector('span').textContent = `${room.players.length}/8명 참가`;
      return;
    }
    if (view === 'race') {
      voice.stop(); scene?.setMode('home'); clearNameProgress();
      $('result-dialog').close(); show('race-view', false); show('home-view');
      view = 'home'; micReady = false; inputMode = 'voice'; localCalls = 0;
      $('mic-title').textContent = '마이크를 연결해주세요'; $('mic-description').textContent = ''; $('mic-transcript').textContent = '';
    }
    renderLobby(); if (!$('lobby-dialog').open) $('lobby-dialog').show();
    $('confirm-name').disabled = false;
    $('confirm-name').textContent = inviteCode ? '완료' : '확인';
    $('home-view').classList.add('lobby-open');
  } else {
    if (view !== 'race') startView();
    scene.update(room);
    updateRace();
    if (previousPhase !== 'racing' && room.phase === 'racing') {
      voice.resetRecognition(); clearNameProgress();
      if (inputMode === 'keyboard') {
        $('keyboard-name-input').value = '';
        $('keyboard-name-input').disabled = false;
        $('keyboard-name-input').placeholder = activeName;
        $('keyboard-name-input').focus();
      }
      $('countdown-number').textContent = '달려!'; setTimeout(() => show('countdown', false), 650);
    }
  }
}
function renderLobby() {
  const friends = mode === 'friends', me = room.players.find(p => p.id === myId), host = room.host === myId;
  setPortrait(me?.appearance);
  setPreviewName(me?.name);
  $('lobby-title').textContent = friends ? '참가 대기실' : '마이크 설정';
  $('lobby-description').textContent = friends ? `${room.players.length}/8명 참가` : '';
  show('invite-area', friends); show('practice-button', !friends && !me?.ready); show('connect-mic', !me?.ready);
  $('connect-mic').disabled = voiceBusy;
  $('connect-mic').innerHTML = `${icon('mic')} ${voiceBusy ? '마이크 연결 중…' : '마이크 연결하기'}`;
  const url = new URL(location.href); url.search = ''; url.hash = ''; url.searchParams.set('room', room.code); $('invite-link').value = url.href;
  const signature = JSON.stringify(room.players.map(p => [p.id, p.name, p.ready, p.lane]));
  if (signature !== lastLobbySignature) {
    lastLobbySignature = signature;
    $('lobby-players').innerHTML = room.players.filter(p => friends || !p.bot).map(p => `<div class="player-card"><span class="player-avatar"><img src="${horseAppearance(p.appearance).src}" alt="${horseAppearance(p.appearance).label}" draggable="false"/></span><span><b>${escape(p.name || '이름 짓는 중')} ${p.id === myId ? '<small>나</small>' : ''}</b><small>${p.id === room.host ? '방장' : '참가자'} · ${p.lane + 1}번</small></span><span class="player-ready ${p.connected && p.ready ? 'is-ready' : ''}">${p.reserved ? '이름 짓는 중' : p.ready ? '준비 완료 ✓' : '준비 중'}</span></div>`).join('');
  }
  show('start-race', !!me?.ready && host);
  $('start-race').disabled = !room.players.every(p => p.connected && p.ready) || (friends && room.players.filter(p => p.connected).length < 2);
  $('lobby-wait').textContent = me?.ready ? host ? friends && room.players.filter(p => p.connected).length < 2 ? '2명 이상 참가 시 시작 가능' : !room.players.every(p => p.connected && p.ready) ? '다른 참가자 접속 또는 준비 대기 중' : '' : '방장 시작 대기' : '';
  requestAnimationFrame(updateLobbyPageHeight);
}
async function prepareVoice() {
  if (voiceBusy) return;
  inputMode = 'voice';
  voiceBusy = true; lobbyError(); $('connect-mic').disabled = true; $('connect-mic').textContent = '마이크 연결 중…'; $('reconnect-mic').disabled = true;
  try {
    const started = await voice.start(activeName);
    if (!started || !room) return;
    micReady = true; inputMode = 'voice'; send({ type: 'ready', ready: true }); show('reconnect-mic', false);
  } catch (error) { if (!room || inputMode === 'keyboard') return; if (view === 'race') $('transcript').textContent = error.message; else lobbyError(error.message); }
  finally { voiceBusy = false; $('connect-mic').disabled = false; $('connect-mic').innerHTML = `${icon('mic')} 마이크 연결하기`; $('reconnect-mic').disabled = false; }
}
for (const id of ['copy-browser-url', 'copy-lobby-browser-url']) {
  if (!$(id)) continue;
  $(id).onclick = async () => {
    const input = $(`${id}-value`);
    input.value = location.href;
    try { await navigator.clipboard.writeText(input.value); toast(`주소를 복사했어요. ${externalBrowser} 앱 주소창에 붙여넣어주세요.`); }
    catch { input.focus(); input.select(); input.setSelectionRange(0, input.value.length); toast('주소를 선택했어요. 복사해서 브라우저 앱에서 열어주세요.'); }
  };
}
$('connect-mic').onclick = prepareVoice; $('reconnect-mic').onclick = prepareVoice;
$('practice-button').onclick = () => { voice.stop(); inputMode = 'keyboard'; micReady = false; lobbyError(); $('mic-title').textContent = '키보드 체험 모드'; $('mic-description').textContent = `“${activeName}”을 정확히 입력할 때마다 빨라집니다.`; $('mic-transcript').textContent = ''; send({ type: 'ready', ready: true }); };
$('start-race').onclick = () => { send({ type: 'start' }); lobbyError(); };
$('copy-link').onclick = async () => { try { await navigator.clipboard.writeText($('invite-link').value); $('copy-link').textContent = '복사 완료 ✓'; setTimeout(() => { $('copy-link').innerHTML = `${icon('link')} 복사`; }, 2000); } catch { $('invite-link').select(); toast('링크를 선택했어요. 복사해서 친구에게 보내주세요.'); } };
function startView() {
  $('home-view').classList.remove('lobby-open');
  $('home-view').style.removeProperty('min-height');
  view = 'race'; $('lobby-dialog').close(); show('home-view', false); show('race-view');
  if (!scene) scene = new RaceScene($('race-scene'));
  $('mic-transcript').textContent = ''; localCalls = 0; clearNameProgress();
  scene.setMode('race', room.players, myId); scene.update(room);
  $('race-horse-name').textContent = activeName; $('shout-name').innerHTML = [...activeName].map(char => `<span class="name-syllable" aria-hidden="true">${escape(char)}</span>`).join(''); $('shout-name').setAttribute('aria-label', activeName);
  $('input-status').innerHTML = `${icon(inputMode === 'keyboard' ? 'keyboard' : 'mic')} ${inputMode === 'keyboard' ? '이름을 따라 써주세요' : '이름을 불러주세요'}`;
  const keyboardInput = $('keyboard-name-input');
  keyboardInput.value = ''; keyboardInput.maxLength = activeName.length; keyboardInput.disabled = room.phase !== 'racing'; keyboardInput.placeholder = room.phase === 'racing' ? activeName : '출발 대기'; keyboardCallLocked = false; keyboardComposing = false;
  show('keyboard-name-input', inputMode === 'keyboard'); show('voice-meter-caption', inputMode === 'voice'); show('reconnect-mic', false);
  if (inputMode === 'keyboard') requestAnimationFrame(() => keyboardInput.focus());
  $('transcript').textContent = '';
  show('countdown'); $('countdown-number').textContent = '3';
}
function sortedPlayers() { return [...room.players].sort((a, b) => (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity) || Number(b.connected) - Number(a.connected) || b.distance - a.distance || a.lane - b.lane); }
function updateRace() {
  const me = room.players.find(p => p.id === myId); if (!me) return;
  const sorted = sortedPlayers(), rank = sorted.findIndex(p => p.id === myId) + 1;
  $('race-rank').textContent = rank; $('race-field').textContent = ` / ${room.players.length}`;
  $('race-distance').textContent = `${Math.min(RACE_DISTANCE, Math.floor(me.distance))} / ${RACE_DISTANCE}m`;
  $('race-progress').style.width = `${me.distance / RACE_DISTANCE * 100}%`;
  $('speed-value').textContent = Math.round(me.speed * 3.6);
  const boost = Math.round((me.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED) * 100);
  $('boost-fill').style.width = `${boost}%`; $('boost-value').textContent = `${boost}%`;
  $('speed-label').textContent = boost >= 100 ? '최고 속도' : boost > 0 ? '가속 중' : '기본 속도';
  $('call-count').textContent = `${me.totalCalls}회 ${inputMode === 'keyboard' ? '입력' : '인식'}`;
  $('leaderboard').innerHTML = sorted.slice(0, 8).map((p, i) => `<div class="leader-row ${p.id === myId ? 'me' : ''}"><b>${i + 1}</b><span>${escape(p.name)}</span><small>${!p.connected && !p.finishTime ? '연결 끊김' : p.finishTime ? `${p.finishTime.toFixed(2)}s` : p.bot ? 'AI' : p.id === myId ? '나' : ''}</small></div>`).join('');
  if (me.finishTime !== null) {
    if (!$('result-dialog').open) { voice.stop(); micReady = false; $('result-dialog').showModal(); }
    renderResult(sorted, me, rank);
  }
}
function renderResult(sorted, me, rank) {
  $('result-title').textContent = `${rank}위`;
  $('result-description').textContent = activeName;
  $('result-time').textContent = `${me.finishTime.toFixed(2)}초`; $('result-calls').textContent = `${me.totalCalls}회`;
  $('result-board').innerHTML = sorted.map((p, i) => `<div class="result-row ${p.id === myId ? 'me' : ''}"><span>${i + 1}</span><b>${escape(p.name)} ${p.id === myId ? '<small>나</small>' : ''}</b><span>${!p.connected && !p.finishTime ? '기권' : p.finishTime ? `${p.finishTime.toFixed(2)}초` : '달리는 중'}</span><span class="result-player-calls">인식 ${p.totalCalls ?? 0}회</span></div>`).join('');
  $('result-wait').textContent = room.phase !== 'finished' ? '다른 참가자 경주 중' : room.host !== myId ? '방장 재경주 대기' : '';
  $('replay').disabled = room.host !== myId || room.phase !== 'finished';
}
function resetHome() {
  $('home-view').classList.remove('lobby-open');
  $('home-view').style.removeProperty('min-height');
  voice.stop(); micReady = false; voiceBusy = false; localCalls = 0; room = null; myId = null; view = 'home'; lastLobbySignature = '';
  syncMusic();
  $('lobby-dialog').close(); $('result-dialog').close(); show('race-view', false); show('home-view');
  scene?.setMode('home'); clearNameProgress(); lobbyError();
  setPortrait(randomAppearance());
  setPreviewName(confirmedName === $('horse-name').value ? confirmedName : '');
  $('mic-title').textContent = '마이크를 연결해주세요'; $('mic-description').textContent = '';
  $('mic-transcript').textContent = '';
}
function leaveRoom() {
  send({ type: 'leave' });
  inviteCode = null; reservationToken = null; history.replaceState(null, '', location.pathname);
  resetHome();
}
$('leave-race').onclick = leaveRoom; $('result-home').onclick = leaveRoom;
$('lobby-dialog').addEventListener('cancel', e => { e.preventDefault(); leaveRoom(); });
$('result-dialog').addEventListener('cancel', e => e.preventDefault());
$('replay').onclick = () => { voice.stop(); send({ type: 'rematch' }); };
function updateKeyboardName() {
  if (inputMode !== 'keyboard' || keyboardCallLocked) return;
  const input = $('keyboard-name-input');
  const typed = input.value;
  let matched = 0;
  while (matched < typed.length && typed[matched] === activeName[matched]) matched++;
  paintNameProgress(matched);
  input.classList.toggle('has-error', typed.length > matched);
  if (keyboardComposing || typed !== activeName || room?.phase !== 'racing' || $('result-dialog').open) return;
  keyboardCallLocked = true;
  paintNameProgress(0, true);
  send({ type: 'call', count: 1 });
  input.classList.add('is-complete');
  input.blur();
  setTimeout(() => {
    input.value = '';
    input.classList.remove('is-complete', 'has-error');
    keyboardCallLocked = false;
    if (view === 'race' && inputMode === 'keyboard' && !$('result-dialog').open) input.focus();
  }, 180);
}
$('keyboard-name-input').addEventListener('input', updateKeyboardName);
$('keyboard-name-input').addEventListener('compositionstart', () => { keyboardComposing = true; });
$('keyboard-name-input').addEventListener('compositionend', () => {
  keyboardComposing = false;
  queueMicrotask(updateKeyboardName);
});
document.addEventListener('keydown', () => {
  if (view === 'race' && inputMode === 'keyboard' && !$('result-dialog').open) $('keyboard-name-input').focus();
});
function toggleSound() {
  sound = !sound;
  audio.setEnabled(sound);
  syncMusic(true);
  $('sound-button').innerHTML = `${icon('volume')} <span>${sound ? 'ON' : 'OFF'}</span>`; $('sound-button').setAttribute('aria-label', `사운드 ${sound ? '끄기' : '켜기'}`);
  $('home-sound-button').innerHTML = `${icon('volume')} <span>${sound ? 'ON' : 'OFF'}</span>`; $('home-sound-button').setAttribute('aria-label', `배경음 ${sound ? '끄기' : '켜기'}`);
}
$('sound-button').onclick = toggleSound;
$('home-sound-button').onclick = toggleSound;
function frame() {
  if (room && view === 'race') {
    const me = room.players.find(p => p.id === myId);
    if (room.phase === 'countdown') $('countdown-number').textContent = Math.max(1, Math.ceil((room.startAt - Date.now() - timeOffset) / 1000));
    const seconds = me?.finishTime ?? Math.max(0, (Date.now() + timeOffset - room.startAt) / 1000);
    $('race-time').textContent = seconds.toFixed(2).padStart(5, '0');
    if (sound && audio.context && room.phase === 'racing' && !me?.finishTime && performance.now() - lastHoof > 270 - (me?.speed || 5) * 6) {
      lastHoof = performance.now();
      audio.hoof();
    }
  }
  requestAnimationFrame(frame);
}
frame();
async function reserveInvite() {
  if (!inviteCode) return;
  try {
    await connect();
    send({ type: 'reserve', code: inviteCode });
  } catch (error) { $('invite-banner').classList.add('invalid'); $('invite-banner').querySelector('span').textContent = error.message; }
}
reserveInvite();
window.addEventListener('resize', updateLobbyPageHeight);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && (sound || voice.active)) void audio.resume();
});
window.addEventListener('pagehide', () => { voice.stop(); audio.dispose(); ws?.close(); });
