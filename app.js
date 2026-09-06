(() => {
  'use strict';
  const VERSION = 'v1-006';
  const DB_NAME = 'spin-dine';
  const STORE = 'app';
  const palette = ['#ff4f71', '#714bff', '#12c8b3', '#ff9d2e', '#ec4db8', '#279dff', '#7ed33b', '#ff6842', '#5266ee', '#cc44b3'];
  const wheelPalette = [
    ['#ff9cae', '#e51d55'], ['#ad9aff', '#5534df'], ['#73f3dd', '#0c9c8f'], ['#ffd169', '#f07120'], ['#ff9ce2', '#c7249a'],
    ['#7fd2ff', '#1678df'], ['#b9ef69', '#5ba91b'], ['#ffab77', '#df4529'], ['#9eaaff', '#3a43cb'], ['#f28bdf', '#a51c87']
  ];
  const app = { state: null, screen: 'tonight', rotation: 0, spinning: false, winner: null, finalists: null, stage: 'finals', reels: [], reelActive: [], completed: false };
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
  const initialState = () => ({ schema: 1, version: VERSION, people: [], places: [], history: [], settings: { avoidRecent: 'off', cookAtHomeEnabled: {} } });
  const id = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function loadState() {
    const db = await openDb();
    const stored = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly'); const req = tx.objectStore(STORE).get('state');
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    db.close();
    return normalizeState(stored || initialState());
  }
  async function saveState() {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(app.state, 'state');
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    db.close();
  }
  function normalizeState(raw) {
    const base = initialState();
    if (!raw || typeof raw !== 'object') return base;
    return {
      schema: 1, version: VERSION,
      people: Array.isArray(raw.people) ? raw.people.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string').map(p => ({ id: p.id, name: p.name.trim() })) : [],
      places: Array.isArray(raw.places) ? raw.places.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.personId === 'string').map(p => ({ id: p.id, name: p.name.trim(), personId: p.personId, enabled: p.enabled !== false })) : [],
      history: Array.isArray(raw.history) ? raw.history.map(h => ({ id: typeof h?.id === 'string' ? h.id : id(), placeId: typeof h?.placeId === 'string' ? h.placeId : '', placeName: typeof h?.placeName === 'string' ? h.placeName : (typeof h?.choiceName === 'string' ? h.choiceName : (typeof h?.name === 'string' ? h.name : '')), personId: typeof h?.personId === 'string' ? h.personId : '', personName: typeof h?.personName === 'string' ? h.personName : 'Unknown', timestamp: typeof h?.timestamp === 'string' ? h.timestamp : new Date().toISOString() })).filter(h => h.placeName) : [],
      settings: {
        avoidRecent: ['off', '3', '7', '14'].includes(raw.settings?.avoidRecent) ? raw.settings.avoidRecent : 'off',
        cookAtHomeEnabled: raw.settings?.cookAtHomeEnabled && typeof raw.settings.cookAtHomeEnabled === 'object'
          ? Object.fromEntries(Object.entries(raw.settings.cookAtHomeEnabled).filter(([personId, enabled]) => typeof personId === 'string' && typeof enabled === 'boolean')) : {}
      }
    };
  }
  function validBackup(raw) {
    if (!raw || typeof raw !== 'object' || raw.schema !== 1 || !Array.isArray(raw.people) || !Array.isArray(raw.places) || !Array.isArray(raw.history)) return false;
    try { const clean = normalizeState(raw); return clean.people.length === raw.people.length && clean.places.length === raw.places.length && clean.history.length === raw.history.length; } catch { return false; }
  }
  function personName(personId) { return app.state.people.find(p => p.id === personId)?.name || 'Unknown'; }
  function isRecent(choice) {
    const days = Number(app.state.settings.avoidRecent);
    if (!days) return false;
    const cutoff = Date.now() - days * 86400000;
    return app.state.history.some(h => h.placeId === choice.id && new Date(h.timestamp).getTime() >= cutoff);
  }
  function allChoices() { return app.state.places.map(place => ({ ...place, kind: 'restaurant' })); }
  function enabledChoices() { return allChoices().filter(choice => choice.enabled); }
  function eligibleChoices() { return enabledChoices().filter(choice => !isRecent(choice)); }
  function choiceLabel(choice) { return choice.name; }
  function secureIndex(length) {
    if (length < 1) return 0;
    if (globalThis.crypto?.getRandomValues) {
      const max = Math.floor(0x100000000 / length) * length;
      const values = new Uint32Array(1); let value;
      do { crypto.getRandomValues(values); value = values[0]; } while (value >= max);
      return value % length;
    }
    return Math.floor(Math.random() * length);
  }
  const recentLabel = () => ({ 'off': 'Off', '3': 'Last 3 days', '7': 'Last 7 days', '14': 'Last 14 days' }[app.state.settings.avoidRecent]);
  function toast(message) { const node = $('#toast'); node.textContent = message; node.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 2500); }

  function render() {
    $('#screen').innerHTML = app.screen === 'tonight' ? tonightView() : app.screen === 'places' ? placesView() : app.screen === 'history' ? historyView() : settingsView();
    $$('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.screen === app.screen));
    bindScreen();
    if (app.screen === 'tonight' && app.finalists) requestAnimationFrame(drawFinalWheel);
  }
  function shell(title, eyebrow, subtitle, action = '') {
    return `<div class="title-row"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1></div>${action}</div>${subtitle ? `<p class="subtitle">${subtitle}</p>` : ''}`;
  }
  function onboarding() {
    const peopleReady = app.state.people.length > 0, choicesReady = allChoices().length >= 3;
    return `<section class="card empty"><div class="emoji">🍽️</div><h2>Your first dinner decision awaits</h2><p>Add your family and favorite places. Every saved choice is its own equal position.</p><div class="progress-list"><div>${peopleReady ? '✓' : '1.'} Add family members</div><div>${choicesReady ? '✓' : '2.'} Add at least three choices</div><div>3. Return here and spin</div></div><button class="button primary" id="onboard-action">${peopleReady ? 'Add a place' : 'Add a person'}</button></section>`;
  }
  function tonightView() {
    const eligible = eligibleChoices(); const totalEnabled = enabledChoices().length;
    let content;
    if (!app.state.people.length || allChoices().length < 3) content = onboarding();
    else if (eligible.length < 3) content = `<section class="card empty"><div class="emoji">⏸️</div><h2>Spin &amp; Dine needs at least 3 choices</h2><p>Add or enable another place. Cook at Home choices count too.</p><button class="button gold" id="adjust-filter">Adjust tonight's choices</button></section>`;
    else if (!app.finalists) content = finalThreeMachine(eligible);
    else content = `${finalThreeMachine(eligible)}<section class="final-wheel-card"><div class="wheel-pointer" aria-hidden="true"></div><canvas id="final-wheel" role="img" aria-label="Final dinner wheel with ${app.finalists.map(choice => escapeHtml(choiceLabel(choice))).join(', ')}"></canvas><button id="spin-dinner" class="dinner-spin" ${app.spinning || app.winner ? 'disabled' : ''}>${app.spinning ? 'SPINNING…' : 'SPIN FOR DINNER'}</button>${app.winner ? winnerOverlay() : ''}</section>`;
    return `${shell('Spin & Dine', "Tonight's Pick", 'Let the wheel settle dinner.')}${content}<div class="card filter-summary"><div><strong>All Places</strong><small>${eligible.length} eligible · Recent picks: ${recentLabel()}</small></div><button id="open-filter" class="button ghost small">Tonight's choices</button></div>`;
  }
  function finalThreeMachine(eligible) { const labels = app.finalists || app.reels || Array(3).fill(null); return `<section class="finals-machine"><div class="machine-label">Tonight's Final 3</div><div class="reel-row">${labels.map((choice, index) => { const primary = choice ? choice.name : 'Ready to spin'; const secondary = choice ? `${personName(choice.personId)}'s Choice` : ' '; return `<div class="reel-window ${app.finalists ? 'locked' : ''} ${app.reelActive[index] ? 'spinning' : ''}"><strong id="reel-label-${index}">${escapeHtml(primary)}</strong><small id="reel-by-${index}">${escapeHtml(secondary)}</small></div>`; }).join('')}</div><button id="spin-finalists" class="button gold final-button" ${app.spinning ? 'disabled' : ''}>${app.spinning ? 'SELECTING…' : app.finalists ? 'FINAL 3 LOCKED' : 'SPIN FOR FINAL 3'}</button><p class="wheel-note">${eligible.length} eligible choices · 3 unique finalists</p></section>`; }
  function winnerView() { return `<div class="winner"><div class="winner-label">TONIGHT'S PICK</div><h2>${escapeHtml(app.winner.name)}</h2><p>${escapeHtml(personName(app.winner.personId))}'s Choice</p>${app.completed ? '<p class="recorded">Saved to History</p>' : ''}<div class="winner-actions"><button class="button ghost" id="play-again">Play Again</button><button class="button gold" id="done-pick" ${app.completed ? 'disabled' : ''}>${app.completed ? 'Recorded' : 'Done'}</button></div></div>`; }
  function winnerOverlay() { return `<div class="wheel-winner-overlay"><div class="winner-label">TONIGHT'S PICK</div><strong>${escapeHtml(app.winner.name)}</strong><span>${escapeHtml(personName(app.winner.personId))}'s Choice</span>${app.completed ? '<em>Saved to History</em>' : ''}<div class="winner-actions"><button class="button ghost" id="play-again">Play Again</button><button class="button gold" id="done-pick" ${app.completed ? 'disabled' : ''}>${app.completed ? 'Recorded' : 'Done'}</button></div></div>`; }
  function placesView() {
    const rows = [...app.state.places].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })).map(place => `<article class="place"><div class="place-top"><div class="place-main"><div class="place-name">${escapeHtml(place.name)}</div><div class="place-meta">${escapeHtml(personName(place.personId))}'s Choice</div>${place.enabled && isRecent(place) ? `<div class="excluded">Temporarily excluded by ${recentLabel()}</div>` : ''}</div><label class="switch" aria-label="${place.enabled ? 'Disable' : 'Enable'} ${escapeHtml(place.name)}"><input type="checkbox" data-toggle-place="${place.id}" ${place.enabled ? 'checked' : ''}><span class="slider"></span></label></div><div class="place-actions"><button class="button ghost small" data-edit-place="${place.id}">Edit</button><button class="button danger small" data-delete-place="${place.id}">Delete</button></div></article>`).join('');
    return `${shell('Places', 'Your list', 'Toggle a place off for tonight without removing it.', '<button class="button primary small" id="add-place">+ Add Place</button>')}<section class="place-list">${rows || '<div class="card empty"><div class="emoji">📍</div><h2>No places yet</h2><p>Add the first restaurant on your family list.</p><button class="button primary" id="empty-add-place">Add Place</button></div>'}</section>`;
  }
  function historyView() {
    const total = app.state.history.length, wins = new Map(); app.state.history.forEach(item => { const key = item.placeId || `name:${item.placeName}`; const current = wins.get(key) || { count: 0, latest: item }; wins.set(key, { count: current.count + 1, latest: current.latest }); });
    const topFive = [...wins.values()].sort((a,b) => b.count - a.count || new Date(b.latest.timestamp) - new Date(a.latest.timestamp)).slice(0, 5).map(item => { const owner = item.latest.personId ? personName(item.latest.personId) : item.latest.personName; return `<article class="history-top-card"><strong>${escapeHtml(item.latest.placeName)}</strong><span>${escapeHtml(owner)}'s Choice</span><b>${Math.round((item.count / total) * 100)}%</b></article>`; }).join('');
    const rows = [...app.state.history].sort((a,b) => new Date(b.timestamp)-new Date(a.timestamp)).map(item => { const date = new Date(item.timestamp), owner = item.personId ? personName(item.personId) : item.personName, count = wins.get(item.placeId || `name:${item.placeName}`)?.count || 1, percentage = total ? Math.round((count / total) * 100) : 0; return `<article class="history-row"><span aria-hidden="true">✦</span><div class="history-copy"><div class="place-name">${escapeHtml(item.placeName)}</div><div class="place-meta">${escapeHtml(owner)}'s Choice · Won ${percentage}% of picks</div></div><time datetime="${item.timestamp}">${date.toLocaleDateString(undefined,{month:'short',day:'numeric'})}<br>${date.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}</time></article>`; }).join('');
    return `${shell('History', 'Past picks', total ? `Each choice's share of ${total} completed pick${total === 1 ? '' : 's'}.` : 'Your completed dinner decisions.', total ? '<button class="button danger small" id="clear-history">Clear</button>' : '')}${topFive ? `<section class="history-top5"><div class="history-top-heading">Top 5 choices</div><div class="history-top-grid">${topFive}</div></section>` : ''}<section class="history-list">${rows || '<div class="card empty"><div class="emoji">◷</div><h2>No picks yet</h2><p>Your finished spins will show up here.</p></div>'}</section>`;
  }
  function settingsView() {
    return `${shell('Settings', 'Spin & Dine', 'Private by design. Your data stays on this device.')}<section class="settings-list"><button class="setting-row" id="manage-people"><span>👥</span><span class="setting-copy"><strong>People</strong><small>${app.state.people.length ? `${app.state.people.length} family member${app.state.people.length === 1 ? '' : 's'}` : 'Add your family'}</small></span><span class="chevron">›</span></button><button class="setting-row" id="manage-person-choices"><span>🎯</span><span class="setting-copy"><strong>Person's Choices</strong><small>Turn all of one person's choices on or off</small></span><span class="chevron">›</span></button><button class="setting-row" id="recent-settings"><span>🛡️</span><span class="setting-copy"><strong>Avoid Recent Picks</strong><small>${recentLabel()}</small></span><span class="chevron">›</span></button><button class="setting-row" id="export-backup"><span>⇩</span><span class="setting-copy"><strong>Data Backup</strong><small>Save your places, people, and history</small></span><span class="chevron">›</span></button><button class="setting-row" id="restore-backup"><span>⇧</span><span class="setting-copy"><strong>Restore Data</strong><small>Replace this device's data from a backup</small></span><span class="chevron">›</span></button><button class="setting-row" id="about"><span>ⓘ</span><span class="setting-copy"><strong>About</strong><small>Version ${VERSION}</small></span><span class="chevron">›</span></button></section>`;
  }

  function bindScreen() {
    $('#onboard-action')?.addEventListener('click', () => app.state.people.length ? openPlaceModal() : openPeopleModal());
    $('#adjust-filter')?.addEventListener('click', openFilterModal); $('#open-filter')?.addEventListener('click', openFilterModal);
    $('#spin-finalists')?.addEventListener('click', spinFinalists);
    $('#spin-dinner')?.addEventListener('click', spinDinner);
    $('#play-again')?.addEventListener('click', resetGame);
    $('#done-pick')?.addEventListener('click', completePick);
    // Event listeners pass a MouseEvent as their first argument. Wrap this call so
    // that event never gets mistaken for the optional existing-place argument.
    $('#add-place')?.addEventListener('click', () => openPlaceModal()); $('#empty-add-place')?.addEventListener('click', () => openPlaceModal());
    $$('[data-toggle-place]').forEach(input => input.addEventListener('change', async () => { const place = app.state.places.find(p => p.id === input.dataset.togglePlace); place.enabled = input.checked; await saveState(); render(); }));
    $$('[data-edit-place]').forEach(btn => btn.addEventListener('click', () => openPlaceModal(app.state.places.find(p => p.id === btn.dataset.editPlace))));
    $$('[data-delete-place]').forEach(btn => btn.addEventListener('click', () => confirmDeletePlace(btn.dataset.deletePlace)));
    $('#clear-history')?.addEventListener('click', confirmClearHistory);
    $('#manage-people')?.addEventListener('click', openPeopleModal); $('#recent-settings')?.addEventListener('click', openRecentModal);
    $('#manage-person-choices')?.addEventListener('click', openPersonChoiceSettings);
    $('#export-backup')?.addEventListener('click', exportBackup); $('#restore-backup')?.addEventListener('click', openRestoreModal); $('#about')?.addEventListener('click', openAboutModal);
  }
  function modal(markup) {
    $('#modal-root').innerHTML = `<div class="modal-backdrop" role="presentation"><section class="modal" role="dialog" aria-modal="true">${markup}</section></div>`;
    const close = () => { $('#modal-root').innerHTML = ''; };
    $('.modal-backdrop').addEventListener('click', e => { if (e.target === e.currentTarget) close(); });
    $$('[data-close-modal]').forEach(btn => btn.addEventListener('click', close));
    return { node: $('.modal'), close };
  }
  function openPlaceModal(place = null) {
    if (!app.state.people.length) { toast('Add a family member first.'); return openPeopleModal(); }
    const savedChoices = [...new Map(app.state.places.map(item => [item.name.trim().toLocaleLowerCase(), item.name.trim()])).values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const { node, close } = modal(`<h2>${place ? 'Edit place' : 'Add a place'}</h2><p class="intro">Every enabled choice has an equal chance on the wheel.</p><form id="place-form"><div class="field"><label for="place-name">Place or food choice</label><input id="place-name" maxlength="80" required value="${escapeHtml(place?.name || '')}" placeholder="e.g. Texas Roadhouse, Pizza, Burgers, Cook at Home" autocomplete="off"><div id="choice-suggestions" class="choice-suggestions" hidden></div></div><div class="field"><label for="place-person">Who chose it?</label><select id="place-person" required>${app.state.people.map(person => `<option value="${person.id}" ${person.id === place?.personId ? 'selected' : ''}>${escapeHtml(person.name)}</option>`).join('')}</select></div><p class="error" id="form-error"></p><div class="modal-actions"><button type="button" class="button ghost" data-close-modal>Cancel</button><button class="button primary">${place ? 'Save Changes' : 'Add Place'}</button></div></form>`);
    const nameInput = $('#place-name', node), suggestions = $('#choice-suggestions', node), showSuggestions = () => { const query = nameInput.value.trim().toLocaleLowerCase(); const matches = query ? savedChoices.filter(choice => choice.toLocaleLowerCase().startsWith(query)) : []; suggestions.innerHTML = matches.map(choice => `<button type="button" class="choice-suggestion" data-suggestion="${escapeHtml(choice)}">${escapeHtml(choice)}</button>`).join(''); suggestions.hidden = matches.length === 0; };
    nameInput.addEventListener('input', showSuggestions); suggestions.addEventListener('click', event => { const button = event.target.closest('[data-suggestion]'); if (!button) return; nameInput.value = button.dataset.suggestion; suggestions.hidden = true; nameInput.focus(); });
    $('#place-name', node).focus();
    $('#place-form', node).addEventListener('submit', async e => { e.preventDefault(); const name = $('#place-name', node).value.trim(); const personId = $('#place-person', node).value; if (!name) return; if (place) { place.name = name; place.personId = personId; } else app.state.places.push({ id: id(), name, personId, enabled: true }); await saveState(); close(); render(); toast(place ? 'Place updated.' : 'Place added to the wheel.'); });
  }
  function openPeopleModal() {
    const people = app.state.people.map(person => `<div class="person-row"><strong>${escapeHtml(person.name)}</strong><button class="button ghost small" data-rename-person="${person.id}">Rename</button><button class="button danger small" data-remove-person="${person.id}">Delete</button></div>`).join('') || '<p class="intro">Add the people in your family first.</p>';
    const { node, close } = modal(`<h2>People</h2><p class="intro">These names appear with the places they originally suggested.</p><div class="modal-list">${people}</div><form id="person-form"><div class="field"><label for="person-name">Add person</label><input id="person-name" maxlength="60" required placeholder="Name" autocomplete="off"></div><p class="error" id="person-error"></p><div class="modal-actions"><button type="button" class="button ghost" data-close-modal>Done</button><button class="button primary">Add Person</button></div></form>`);
    $('#person-form', node).addEventListener('submit', async e => { e.preventDefault(); const name = $('#person-name', node).value.trim(); if (!name) return; if (app.state.people.some(p => p.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0)) { $('#person-error',node).textContent='That person is already listed.'; return; } app.state.people.push({ id:id(), name }); await saveState(); close(); render(); openPeopleModal(); });
    $$('[data-rename-person]', node).forEach(btn => btn.addEventListener('click', () => openRenamePerson(btn.dataset.renamePerson)));
    $$('[data-remove-person]', node).forEach(btn => btn.addEventListener('click', () => removePerson(btn.dataset.removePerson)));
  }
  function openRenamePerson(personId) { const person = app.state.people.find(p => p.id === personId); const { node, close } = modal(`<h2>Rename person</h2><form id="rename-form"><div class="field"><label for="rename-name">Name</label><input id="rename-name" maxlength="60" required value="${escapeHtml(person.name)}"></div><p class="error" id="rename-error"></p><div class="modal-actions"><button type="button" class="button ghost" data-close-modal>Cancel</button><button class="button primary">Save</button></div></form>`); $('#rename-name',node).focus(); $('#rename-form',node).addEventListener('submit',async e=>{e.preventDefault();const name=$('#rename-name',node).value.trim();if(app.state.people.some(p=>p.id!==personId&&p.name.localeCompare(name,undefined,{sensitivity:'accent'})===0)){ $('#rename-error',node).textContent='That person is already listed.';return;}person.name=name;await saveState();close();render();toast('Name updated.');}); }
  function removePerson(personId) { const person = app.state.people.find(p => p.id === personId); const references = app.state.places.filter(p => p.personId === personId).length; if (references) { modal(`<div class="confirm-dialog"><div class="confirm-icon">!</div><h2>Can't delete ${escapeHtml(person.name)}</h2><p class="intro">${references} place${references===1?' still references':'s still reference'} this person. Reassign or delete those places first.</p><div class="modal-actions"><button class="button primary" data-close-modal>OK</button></div></div>`); return; } const { close } = modal(`<div class="confirm-dialog"><div class="confirm-icon">!</div><h2>Delete ${escapeHtml(person.name)}?</h2><p class="intro">This person will be removed. This cannot be undone.</p><div class="modal-actions"><button class="button ghost" data-close-modal>Cancel</button><button class="button danger" id="confirm-remove-person">Delete Person</button></div></div>`); $('#confirm-remove-person').addEventListener('click',async()=>{app.state.people=app.state.people.filter(p=>p.id!==personId);await saveState();close();render();toast('Person deleted.');}); }
  function confirmDeletePlace(placeId) { const place=app.state.places.find(p=>p.id===placeId); const { close }=modal(`<div class="confirm-dialog"><div class="confirm-icon">!</div><h2>Delete this choice?</h2><p class="confirm-choice">${escapeHtml(place.name)}</p><p class="intro">It will be removed from your choices. Previous history will remain.</p><div class="modal-actions"><button class="button ghost" data-close-modal>Cancel</button><button class="button danger" id="confirm-delete-place">Delete Choice</button></div></div>`);$('#confirm-delete-place').addEventListener('click',async()=>{app.state.places=app.state.places.filter(p=>p.id!==placeId);await saveState();close();render();toast('Choice deleted.');}); }
  function openFilterModal() {
    const rows = allChoices().map(choice => `<div class="person-row"><div class="place-main"><strong>${escapeHtml(choiceLabel(choice))}</strong><div class="place-meta">${choice.enabled && isRecent(choice) ? 'Excluded by recent-pick rule' : choice.enabled ? 'On tonight\'s wheel' : 'Off tonight'} · ${escapeHtml(personName(choice.personId))}'s Choice</div></div><label class="switch" aria-label="Toggle ${escapeHtml(choiceLabel(choice))}"><input type="checkbox" data-filter-toggle="${choice.id}" ${choice.enabled ? 'checked' : ''}><span class="slider"></span></label></div>`).join('') || '<p class="intro">Add places to create choices.</p>';
    const { node, close } = modal(`<h2>Tonight's choices</h2><p class="intro">Each saved place is an individual equal choice.</p><button class="button ghost small" id="enable-all">Enable All Choices</button><div class="modal-list" style="margin-top:10px">${rows}</div><div class="modal-actions"><button class="button primary" data-close-modal>Done</button></div>`);
    $('#enable-all', node)?.addEventListener('click', async () => { app.state.places.forEach(place => place.enabled = true); await saveState(); close(); render(); openFilterModal(); });
    $$('[data-filter-toggle]', node).forEach(input => input.addEventListener('change', async () => { const place = app.state.places.find(item => item.id === input.dataset.filterToggle); if (place) place.enabled = input.checked; await saveState(); render(); }));
  }
  function openRecentModal() { const options=[['off','Off'],['3','Last 3 days'],['7','Last 7 days'],['14','Last 14 days']]; const { node, close }=modal(`<h2>Avoid Recent Picks</h2><p class="intro">Recently completed picks are temporarily left off the wheel. Spin &amp; Dine always requires at least three eligible choices.</p><div class="segmented" role="group">${options.map(([value,label])=>`<button data-recent="${value}" class="${app.state.settings.avoidRecent===value?'active':''}">${label}</button>`).join('')}</div><div class="modal-actions"><button class="button primary" data-close-modal>Done</button></div>`);$$('[data-recent]',node).forEach(btn=>btn.addEventListener('click',async()=>{app.state.settings.avoidRecent=btn.dataset.recent;await saveState();close();render();toast(`Recent-pick protection: ${recentLabel()}.`);})); }
  function openPersonChoiceSettings() { const rows = app.state.people.map(person => { const choices = app.state.places.filter(place => place.personId === person.id), enabled = choices.filter(choice => choice.enabled).length; return `<div class="person-choice-row"><div><strong>${escapeHtml(person.name)}</strong><small>${choices.length ? `${enabled} of ${choices.length} choices on` : 'No choices yet'}</small></div><div class="person-choice-actions"><button class="button ghost small" data-person-choice-action="off" data-person-id="${person.id}" ${choices.length ? '' : 'disabled'}>Turn all off</button><button class="button gold small" data-person-choice-action="on" data-person-id="${person.id}" ${choices.length ? '' : 'disabled'}>Turn all on</button></div></div>`; }).join('') || '<p class="intro">Add people first, then assign choices to them.</p>'; const { node, close } = modal(`<h2>Person's Choices</h2><p class="intro">Quickly control all choices entered by one person. Individual entries remain separate.</p><div class="person-choice-list">${rows}</div><div class="modal-actions"><button class="button primary" data-close-modal>Done</button></div>`); $$('[data-person-choice-action]', node).forEach(button => button.addEventListener('click', async () => { const choices = app.state.places.filter(place => place.personId === button.dataset.personId); choices.forEach(choice => choice.enabled = button.dataset.personChoiceAction === 'on'); await saveState(); close(); render(); toast(`${personName(button.dataset.personId)}'s choices turned ${button.dataset.personChoiceAction === 'on' ? 'on' : 'off'}.`); })); }
  function confirmClearHistory() { const { close }=modal(`<div class="confirm-dialog"><div class="confirm-icon">!</div><h2>Clear all history?</h2><p class="intro">This permanently removes your past picks and cannot be undone.</p><div class="modal-actions"><button class="button ghost" data-close-modal>Cancel</button><button class="button danger" id="confirm-clear-history">Clear History</button></div></div>`);$('#confirm-clear-history').addEventListener('click',async()=>{app.state.history=[];await saveState();close();render();toast('History cleared.');}); }
  function openAboutModal() { modal(`<h2>About Spin &amp; Dine</h2><div class="about"><p><strong>Version ${VERSION}</strong></p><p>Spin &amp; Dine is a private family decision wheel. It is built to work locally, including offline after its first successful load.</p><p>Your people, places, picks, and settings live only in this browser's storage. Nothing is sent to a server.</p></div><div class="modal-actions"><button class="button primary" data-close-modal>Done</button></div>`); }
  async function exportBackup() { const backup={...app.state,version:VERSION,exportedAt:new Date().toISOString()};const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`spin-dine-backup-${new Date().toISOString().slice(0,10)}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Backup downloaded.'); }
  function openRestoreModal() { const { node, close }=modal(`<h2>Restore data</h2><p class="intro">Choose a Spin &amp; Dine backup file. After validation, restoring will replace all current people, places, picks, and settings on this device.</p><div class="field"><label for="backup-file">Backup file</label><input id="backup-file" class="file-input" type="file" accept="application/json,.json"></div><p class="error" id="restore-error"></p><div class="modal-actions"><button class="button ghost" data-close-modal>Cancel</button><button class="button danger" id="validate-restore" disabled>Restore &amp; Replace</button></div>`);let candidate=null;$('#backup-file',node).addEventListener('change',async e=>{const file=e.target.files[0];candidate=null;$('#validate-restore',node).disabled=true;if(!file)return;try{const raw=JSON.parse(await file.text());if(!validBackup(raw))throw new Error();candidate=normalizeState(raw);$('#restore-error',node).textContent='Backup looks valid. Restoring will replace your current data.';$('#validate-restore',node).disabled=false;}catch{$('#restore-error',node).textContent='That file is not a valid Spin & Dine backup.';}});$('#validate-restore',node).addEventListener('click',async()=>{if(!candidate)return;app.state=candidate;app.winner=null;await saveState();close();render();toast('Your backup has been restored.');}); }

  function splitLabel(name) { const words = name.split(/\s+/); if (words.length < 2) return [name]; const first = []; const second = []; words.forEach((word, index) => (index < Math.ceil(words.length / 2) ? first : second).push(word)); return [first.join(' '), second.join(' ')].filter(Boolean); }
  function choiceAtPointer(choices) { const arc = Math.PI * 2 / choices.length; const localPointer = ((-app.rotation) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2); return choices[Math.min(choices.length - 1, Math.floor(localPointer / arc))]; }
  // Kept as an alternate renderer while the active wheel is the upright drum below.
  function drawCircularWheel() {
    const canvas = $('#wheel'); if (!canvas) return;
    app.canvas = canvas;
    const choices = eligibleChoices(); const rect = canvas.getBoundingClientRect();
    const size = Math.max(1, Math.floor(Math.min(rect.width, rect.height) * devicePixelRatio));
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d'); ctx.scale(devicePixelRatio, devicePixelRatio);
    const w = rect.width, h = rect.height, cx = w / 2, cy = h / 2, outer = Math.min(w, h) * .415, inner = outer * .53, panelRadius = (outer + inner) / 2;
    ctx.clearRect(0, 0, w, h); if (choices.length < 2) return;

    // A solid, recessed hub makes the choice panels feel like a physical outer ring.
    ctx.save(); ctx.translate(cx, cy);
    const back = ctx.createRadialGradient(-outer * .22, -outer * .28, outer * .08, 0, 0, outer * 1.28);
    back.addColorStop(0, '#34537a'); back.addColorStop(.54, '#101b37'); back.addColorStop(1, '#030816');
    ctx.fillStyle = back; ctx.beginPath(); ctx.arc(0, 0, outer * 1.23, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.save(); ctx.translate(cx, cy); ctx.rotate(app.rotation);
    const arc = Math.PI * 2 / choices.length;
    const gap = Math.min(.018, arc * .16);
    choices.forEach((choice, index) => {
      const start = -Math.PI / 2 + index * arc + gap, end = -Math.PI / 2 + (index + 1) * arc - gap, mid = (start + end) / 2;
      const [highlight, shade] = wheelPalette[index % wheelPalette.length];
      const panel = ctx.createRadialGradient(0, 0, inner * .7, 0, 0, outer * 1.06);
      panel.addColorStop(0, shade); panel.addColorStop(.38, palette[index % palette.length]); panel.addColorStop(.74, highlight); panel.addColorStop(1, shade);
      ctx.beginPath(); ctx.arc(0, 0, outer, start, end); ctx.arc(0, 0, inner, end, start, true); ctx.closePath(); ctx.fillStyle = panel; ctx.fill();
      ctx.save(); ctx.globalAlpha = .18; ctx.beginPath(); ctx.arc(0, 0, outer * .94, start, mid); ctx.arc(0, 0, inner * 1.05, mid, start, true); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();
      [start - gap, end + gap].forEach(edge => { ctx.beginPath(); ctx.moveTo(Math.cos(edge) * inner, Math.sin(edge) * inner); ctx.lineTo(Math.cos(edge) * outer, Math.sin(edge) * outer); ctx.strokeStyle = 'rgba(38,12,47,.92)'; ctx.lineWidth = Math.max(1.6, outer * .015); ctx.stroke(); ctx.beginPath(); ctx.moveTo(Math.cos(edge + .007) * inner, Math.sin(edge + .007) * inner); ctx.lineTo(Math.cos(edge + .007) * outer, Math.sin(edge + .007) * outer); ctx.strokeStyle = 'rgba(255,249,215,.6)'; ctx.lineWidth = Math.max(.7, outer * .005); ctx.stroke(); });
      ctx.save(); ctx.rotate(mid); ctx.translate(panelRadius, 0);
      const lines = splitLabel(choiceLabel(choice));
      const screenMid = ((mid + app.rotation) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      let labelAngle = Math.PI / 2;
      const screenTextAngle = (screenMid + labelAngle) % (Math.PI * 2);
      if (screenTextAngle > Math.PI / 2 && screenTextAngle < Math.PI * 1.5) labelAngle += Math.PI;
      ctx.rotate(labelAngle);
      const availableWidth = Math.max(12, arc * panelRadius * .86);
      const fontSize = Math.max(3.5, Math.min(15, outer * .075, availableWidth / (Math.max(...lines.map(line => line.length)) * .62)));
      ctx.fillStyle = '#fff'; ctx.font = `900 ${fontSize}px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(14,8,33,.82)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1;
      lines.forEach((line, lineIndex) => ctx.fillText(line, 0, (lineIndex - (lines.length - 1) / 2) * fontSize * 1.05));
      ctx.restore();
    });
    const pegCount = Math.max(24, choices.length);
    for (let i = 0; i < pegCount; i++) { const a = (Math.PI * 2 * i) / pegCount - Math.PI / 2; const x = Math.cos(a) * outer * 1.10, y = Math.sin(a) * outer * 1.10; const peg = ctx.createRadialGradient(x - outer * .010, y - outer * .010, outer * .005, x, y, outer * .028); peg.addColorStop(0, '#fffde8'); peg.addColorStop(.36, '#ffd874'); peg.addColorStop(1, '#8b4b28'); ctx.beginPath(); ctx.arc(x, y, Math.max(2, outer * .020), 0, Math.PI * 2); ctx.fillStyle = peg; ctx.shadowColor = '#ffcd58'; ctx.shadowBlur = 6; ctx.fill(); }
    ctx.restore(); ctx.shadowBlur = 0;

    const metal = ctx.createLinearGradient(0, cy - outer * 1.18, 0, cy + outer * 1.18);
    metal.addColorStop(0, '#fff6b9'); metal.addColorStop(.16, '#8a5a34'); metal.addColorStop(.32, '#f8de8e'); metal.addColorStop(.51, '#70422d'); metal.addColorStop(.69, '#fff1a8'); metal.addColorStop(1, '#74442f');
    ctx.beginPath(); ctx.arc(cx, cy, outer * 1.17, 0, Math.PI * 2); ctx.strokeStyle = '#321d42'; ctx.lineWidth = Math.max(12, outer * .13); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, outer * 1.10, 0, Math.PI * 2); ctx.strokeStyle = metal; ctx.lineWidth = Math.max(9, outer * .074); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, outer * 1.015, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,251,213,.88)'; ctx.lineWidth = Math.max(1.4, outer * .010); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, inner * 1.02, 0, Math.PI * 2); ctx.fillStyle = '#0b1d3c'; ctx.fill(); ctx.strokeStyle = '#d5a55f'; ctx.lineWidth = Math.max(4, outer * .032); ctx.stroke();

  }
  function drawShelfWheel() {
    const canvas = $('#wheel'); if (!canvas) return;
    const choices = eligibleChoices(), rect = canvas.getBoundingClientRect();
    const scale = devicePixelRatio || 1; canvas.width = Math.max(1, Math.floor(rect.width * scale)); canvas.height = Math.max(1, Math.floor(rect.height * scale));
    const ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
    const w = rect.width, h = rect.height, cx = w / 2, selectionY = h * .405;
    ctx.clearRect(0, 0, w, h); if (choices.length < 2) return;

    const frame = { x: w * .075, y: h * .045, width: w * .85, height: h * .83 };
    const drum = { x: w * .18, y: h * .105, width: w * .64, height: h * .59 };
    const arc = Math.PI * 2 / choices.length;
    // The drum body and its offset side wall create the upright physical silhouette.
    ctx.fillStyle = '#111426'; ctx.fillRect(frame.x + 8, frame.y + 9, frame.width, frame.height);
    const body = ctx.createLinearGradient(frame.x, 0, frame.x + frame.width, 0); body.addColorStop(0, '#432b4d'); body.addColorStop(.13, '#0e1730'); body.addColorStop(.5, '#172a4c'); body.addColorStop(.87, '#0e1730'); body.addColorStop(1, '#432b4d');
    ctx.fillStyle = body; ctx.beginPath(); ctx.roundRect(frame.x, frame.y, frame.width, frame.height, 22); ctx.fill();
    ctx.fillStyle = '#060d1e'; ctx.beginPath(); ctx.roundRect(drum.x, drum.y, drum.width, drum.height, 16); ctx.fill();
    ctx.strokeStyle = '#d4a75b'; ctx.lineWidth = 6; ctx.beginPath(); ctx.roundRect(drum.x, drum.y, drum.width, drum.height, 16); ctx.stroke();

    // Fixed chrome side columns and bulbs stay still while the panels rotate through them.
    for (const side of [frame.x + 20, frame.x + frame.width - 20]) {
      const chrome = ctx.createLinearGradient(side - 10, 0, side + 10, 0); chrome.addColorStop(0, '#70452f'); chrome.addColorStop(.45, '#fff0a5'); chrome.addColorStop(1, '#71442e');
      ctx.strokeStyle = chrome; ctx.lineWidth = 13; ctx.beginPath(); ctx.moveTo(side, frame.y + 15); ctx.lineTo(side, frame.y + frame.height - 15); ctx.stroke();
      for (let y = frame.y + 31; y < frame.y + frame.height - 20; y += Math.max(18, h * .052)) { ctx.beginPath(); ctx.arc(side, y, 3.7, 0, Math.PI * 2); ctx.fillStyle = '#fff4ae'; ctx.shadowColor = '#ffc95d'; ctx.shadowBlur = 8; ctx.fill(); }
    }
    ctx.shadowBlur = 0;

    const selected = choiceAtPointer(choices), selectedIndex = choices.findIndex(choice => choice.id === selected.id);
    const panels = choices.map((choice, index) => {
      let phase = ((index + .5) * arc + app.rotation) % (Math.PI * 2); if (phase > Math.PI) phase -= Math.PI * 2; if (phase < -Math.PI) phase += Math.PI * 2;
      return { choice, index, phase, front: (Math.cos(phase) + 1) / 2 };
    }).sort((a, b) => a.front - b.front);
    panels.forEach(({ choice, index, phase, front }) => {
      if (index === selectedIndex) return;
      const y = selectionY + Math.sin(phase) * drum.height * .43;
      const depth = .24 + front * .76, panelWidth = drum.width * (.39 + depth * .61), panelHeight = Math.max(3, Math.min(h * .075, h * (.018 + depth * .038)));
      const x = cx + Math.sin(phase) * drum.width * .10;
      const [light, dark] = wheelPalette[index % wheelPalette.length];
      const color = ctx.createLinearGradient(x - panelWidth / 2, y - panelHeight / 2, x + panelWidth / 2, y + panelHeight / 2); color.addColorStop(0, dark); color.addColorStop(.40, palette[index % palette.length]); color.addColorStop(.68, light); color.addColorStop(1, dark);
      ctx.save(); ctx.globalAlpha = .22 + front * .78; ctx.beginPath(); ctx.moveTo(x - panelWidth * .46, y - panelHeight / 2); ctx.lineTo(x + panelWidth * .46, y - panelHeight / 2); ctx.lineTo(x + panelWidth / 2, y + panelHeight / 2); ctx.lineTo(x - panelWidth / 2, y + panelHeight / 2); ctx.closePath(); ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = front > .86 ? '#fff1ae' : 'rgba(20,10,32,.95)'; ctx.lineWidth = Math.max(.7, 2.4 * depth); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.38)'; ctx.lineWidth = .8; ctx.beginPath(); ctx.moveTo(x - panelWidth * .43, y - panelHeight * .30); ctx.lineTo(x + panelWidth * .43, y - panelHeight * .30); ctx.stroke();
      // Labels are horizontal and upright; back-side panels are physically present but intentionally compressed.
      if (front > .78) { const lines = splitLabel(choiceLabel(choice)); const fontSize = Math.max(7, Math.min(18, panelHeight * .50, panelWidth / (Math.max(...lines.map(line => line.length)) * .60))); ctx.fillStyle = '#fff'; ctx.font = `900 ${fontSize}px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 3; lines.forEach((line, lineIndex) => ctx.fillText(line, x, y + (lineIndex - (lines.length - 1) / 2) * fontSize * .92)); }
      ctx.restore();
    });

    // The selection panel is redrawn on top at full scale: it is the actual indexed panel at the pointer, not a separate readout.
    const [selectedLight, selectedDark] = wheelPalette[selectedIndex % wheelPalette.length];
    const selectedWidth = drum.width * .87, selectedHeight = Math.max(40, h * .078), sx = cx, sy = selectionY;
    const selectedGradient = ctx.createLinearGradient(sx - selectedWidth / 2, sy - selectedHeight / 2, sx + selectedWidth / 2, sy + selectedHeight / 2); selectedGradient.addColorStop(0, selectedDark); selectedGradient.addColorStop(.45, palette[selectedIndex % palette.length]); selectedGradient.addColorStop(.72, selectedLight); selectedGradient.addColorStop(1, selectedDark);
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.58)'; ctx.shadowBlur = 12; ctx.fillStyle = selectedGradient; ctx.beginPath(); ctx.moveTo(sx - selectedWidth * .46, sy - selectedHeight / 2); ctx.lineTo(sx + selectedWidth * .46, sy - selectedHeight / 2); ctx.lineTo(sx + selectedWidth / 2, sy + selectedHeight / 2); ctx.lineTo(sx - selectedWidth / 2, sy + selectedHeight / 2); ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#fff1ae'; ctx.lineWidth = 3; ctx.stroke(); ctx.shadowBlur = 0;
    const selectedLines = splitLabel(choiceLabel(selected)); const selectedFont = Math.max(12, Math.min(22, selectedHeight * .44, selectedWidth / (Math.max(...selectedLines.map(line => line.length)) * .58))); ctx.fillStyle = '#fff'; ctx.font = `900 ${selectedFont}px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(0,0,0,.78)'; ctx.shadowBlur = 3; selectedLines.forEach((line, lineIndex) => ctx.fillText(line, sx, sy + (lineIndex - (selectedLines.length - 1) / 2) * selectedFont * .90)); ctx.restore();

    const hubY = h * .77, hubR = Math.min(w, h) * .125; const hub = ctx.createRadialGradient(cx - hubR * .25, hubY - hubR * .30, hubR * .1, cx, hubY, hubR); hub.addColorStop(0, '#fff8c7'); hub.addColorStop(.36, '#f3b84d'); hub.addColorStop(.72, '#8e3f32'); hub.addColorStop(1, '#321a3c'); ctx.beginPath(); ctx.arc(cx, hubY, hubR, 0, Math.PI * 2); ctx.fillStyle = hub; ctx.fill(); ctx.strokeStyle = '#ffe9a3'; ctx.lineWidth = 5; ctx.stroke();
  }
  function drawFlatWheel() {
    const canvas = $('#wheel'); if (!canvas) return;
    const choices = eligibleChoices(), rect = canvas.getBoundingClientRect(), scale = devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * scale)); canvas.height = Math.max(1, Math.floor(rect.height * scale));
    const ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
    const w = rect.width, h = rect.height, cx = w / 2, cy = h * .49, r = Math.min(w, h) * .405, ry = r * .82, pointerY = cy - ry * .55;
    ctx.clearRect(0, 0, w, h); if (choices.length < 2) return;

    // Offset rear shell plus layered ellipses make one large, upright, angled drum.
    ctx.save(); ctx.translate(cx, cy); ctx.scale(1, .82); const shell = ctx.createRadialGradient(-r * .28, -r * .24, r * .06, 0, 0, r * 1.18); shell.addColorStop(0, '#3a536f'); shell.addColorStop(.48, '#101d38'); shell.addColorStop(1, '#030916'); ctx.fillStyle = shell; ctx.beginPath(); ctx.arc(11, 10, r * 1.12, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    const metal = ctx.createLinearGradient(cx - r, 0, cx + r, 0); metal.addColorStop(0, '#593845'); metal.addColorStop(.11, '#eac578'); metal.addColorStop(.23, '#815c45'); metal.addColorStop(.5, '#fff0a9'); metal.addColorStop(.78, '#815c45'); metal.addColorStop(.92, '#eac578'); metal.addColorStop(1, '#593845');
    ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.07, ry * 1.07, 0, 0, Math.PI * 2); ctx.fillStyle = '#2a1c38'; ctx.fill(); ctx.strokeStyle = metal; ctx.lineWidth = Math.max(12, r * .105); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx, cy, r * .96, ry * .96, 0, 0, Math.PI * 2); ctx.fillStyle = '#071427'; ctx.fill(); ctx.strokeStyle = 'rgba(255,241,174,.78)'; ctx.lineWidth = 2; ctx.stroke();

    const arc = Math.PI * 2 / choices.length, selected = choiceAtPointer(choices), selectedIndex = choices.findIndex(choice => choice.id === selected.id);
    const panels = choices.map((choice, index) => { let phase = ((index + .5) * arc + app.rotation) % (Math.PI * 2); if (phase > Math.PI) phase -= Math.PI * 2; if (phase < -Math.PI) phase += Math.PI * 2; return { choice, index, phase, front: (Math.cos(phase) + 1) / 2 }; }).sort((a, b) => a.front - b.front);
    panels.forEach(({ choice, index, phase, front }) => {
      if (index === selectedIndex) return;
      const y = pointerY + Math.sin(phase) * ry * .87, depth = .16 + front * .84, width = r * (.38 + depth * 1.26), height = Math.max(2.5, Math.min(h * .065, h * (.010 + depth * .034))), x = cx + Math.sin(phase) * r * .12;
      const [light, dark] = wheelPalette[index % wheelPalette.length], face = ctx.createLinearGradient(x - width / 2, y - height / 2, x + width / 2, y + height / 2); face.addColorStop(0, dark); face.addColorStop(.48, palette[index % palette.length]); face.addColorStop(.72, light); face.addColorStop(1, dark);
      ctx.save(); ctx.globalAlpha = .14 + front * .82; ctx.beginPath(); ctx.moveTo(x - width * .46, y - height / 2); ctx.lineTo(x + width * .46, y - height / 2); ctx.lineTo(x + width / 2, y + height / 2); ctx.lineTo(x - width / 2, y + height / 2); ctx.closePath(); ctx.fillStyle = face; ctx.fill(); ctx.strokeStyle = front > .75 ? 'rgba(255,242,186,.78)' : 'rgba(5,9,23,.92)'; ctx.lineWidth = Math.max(.6, depth * 1.7); ctx.stroke();
      if (front > .82) { const lines = splitLabel(choiceLabel(choice)), font = Math.max(6, Math.min(15, height * .50, width / (Math.max(...lines.map(line => line.length)) * .60))); ctx.fillStyle = '#fff'; ctx.font = `900 ${font}px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 3; lines.forEach((line, n) => ctx.fillText(line, x, y + (n - (lines.length - 1) / 2) * font * .90)); }
      ctx.restore();
    });
    // Raised rim pegs visually contact the fixed flipper as panels move past.
    for (let i = 0; i < Math.max(24, Math.min(60, choices.length)); i++) { const a = Math.PI * 2 * i / Math.max(24, Math.min(60, choices.length)); const px = cx + Math.cos(a) * r * 1.025, py = cy + Math.sin(a) * ry * 1.025; ctx.beginPath(); ctx.arc(px, py, Math.max(1.8, r * .014), 0, Math.PI * 2); ctx.fillStyle = '#ffeb94'; ctx.shadowColor = '#ffc857'; ctx.shadowBlur = 5; ctx.fill(); } ctx.shadowBlur = 0;

    // The full-size pointer panel is part of the same indexed drum, not an overlay/readout.
    const [selectedLight, selectedDark] = wheelPalette[selectedIndex % wheelPalette.length], sw = r * 1.63, sh = Math.max(42, h * .081), sx = cx;
    const selectedFace = ctx.createLinearGradient(sx - sw / 2, pointerY - sh / 2, sx + sw / 2, pointerY + sh / 2); selectedFace.addColorStop(0, selectedDark); selectedFace.addColorStop(.45, palette[selectedIndex % palette.length]); selectedFace.addColorStop(.72, selectedLight); selectedFace.addColorStop(1, selectedDark);
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 13; ctx.beginPath(); ctx.moveTo(sx - sw * .46, pointerY - sh / 2); ctx.lineTo(sx + sw * .46, pointerY - sh / 2); ctx.lineTo(sx + sw / 2, pointerY + sh / 2); ctx.lineTo(sx - sw / 2, pointerY + sh / 2); ctx.closePath(); ctx.fillStyle = selectedFace; ctx.fill(); ctx.strokeStyle = '#fff0a4'; ctx.lineWidth = 3; ctx.stroke(); ctx.shadowBlur = 0; const selectedLines = splitLabel(choiceLabel(selected)), font = Math.max(12, Math.min(22, sh * .43, sw / (Math.max(...selectedLines.map(line => line.length)) * .58))); ctx.fillStyle = '#fff'; ctx.font = `900 ${font}px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 3; selectedLines.forEach((line, n) => ctx.fillText(line, sx, pointerY + (n - (selectedLines.length - 1) / 2) * font * .90)); ctx.restore();

    // Center axle: visually connects the spin control to the same circular mechanical wheel.
    const hub = ctx.createRadialGradient(cx - r * .08, cy - r * .10, r * .03, cx, cy, r * .25); hub.addColorStop(0, '#fff8bf'); hub.addColorStop(.34, '#f2bd55'); hub.addColorStop(.68, '#9b4b37'); hub.addColorStop(1, '#351b3f'); ctx.beginPath(); ctx.ellipse(cx, cy, r * .25, r * .20, 0, 0, Math.PI * 2); ctx.fillStyle = hub; ctx.fill(); ctx.strokeStyle = '#ffe9a4'; ctx.lineWidth = 6; ctx.stroke();
  }
  function drawWheel() {
    const canvas = $('#wheel'); if (!canvas) return;
    const choices = eligibleChoices(), rect = canvas.getBoundingClientRect(), scale = devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * scale)); canvas.height = Math.max(1, Math.floor(rect.height * scale));
    const ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
    const w = rect.width, h = rect.height, cy = h * .48, band = { x: w * .30, y: h * .08, width: w * .48, height: h * .78 }, sideX = w * .24;
    ctx.clearRect(0, 0, w, h); if (choices.length < 2) return;

    // The drawing's simple physical structure: two legs, one axle, one upright drum.
    const metal = ctx.createLinearGradient(0, cy, 0, h); metal.addColorStop(0, '#b9d4fb'); metal.addColorStop(.10, '#4777bd'); metal.addColorStop(.76, '#203f78'); metal.addColorStop(1, '#82a9e2');
    // Compact, straight support posts keep the wheel in focus instead of creating an easel silhouette.
    ctx.fillStyle = metal; ctx.beginPath(); ctx.roundRect(w * .135, cy - 1, w * .035, h * .34, 3); ctx.fill(); ctx.beginPath(); ctx.roundRect(w * .775, cy - 1, w * .035, h * .34, 3); ctx.fill(); ctx.fillStyle = '#6f98d5'; ctx.roundRect(w * .12, cy - 3, w * .71, 6, 3); ctx.fill();
    const plate = ctx.createLinearGradient(band.x - w * .045, 0, band.x + w * .02, 0); plate.addColorStop(0, '#c8dcfa'); plate.addColorStop(.58, '#83a8dd'); plate.addColorStop(1, '#3d65a1');
    ctx.beginPath(); ctx.ellipse(band.x, cy, w * .035, h * .365, 0, 0, Math.PI * 2); ctx.fillStyle = plate; ctx.fill(); ctx.strokeStyle = '#163765'; ctx.lineWidth = 1; ctx.stroke();
    const drumPath = () => { const p = new Path2D(); p.moveTo(band.x, band.y); p.lineTo(band.x + band.width * .95, band.y); p.quadraticCurveTo(band.x + band.width * 1.04, cy, band.x + band.width * .95, band.y + band.height); p.lineTo(band.x, band.y + band.height); p.closePath(); return p; };
    const shell = ctx.createLinearGradient(band.x, band.y, band.x + band.width, band.y); shell.addColorStop(0, '#183765'); shell.addColorStop(.14, '#416da9'); shell.addColorStop(.72, '#274d86'); shell.addColorStop(1, '#122c54'); ctx.fillStyle = shell; ctx.fill(drumPath()); ctx.strokeStyle = '#9fc0ef'; ctx.lineWidth = 1.5; ctx.stroke(drumPath());
    ctx.save(); ctx.clip(drumPath());

    const arc = Math.PI * 2 / choices.length, selected = choiceAtPointer(choices), selectedIndex = choices.findIndex(choice => choice.id === selected.id);
    const panels = choices.map((choice, index) => { let phase = ((index + .5) * arc + app.rotation) % (Math.PI * 2); if (phase > Math.PI) phase -= Math.PI * 2; if (phase < -Math.PI) phase += Math.PI * 2; return { choice, index, phase, front: (Math.cos(phase) + 1) / 2 }; }).sort((a, b) => a.front - b.front);
    panels.forEach(({ choice, index, phase, front }) => {
      if (index === selectedIndex) return;
      const y = cy + Math.sin(phase) * band.height * .46, depth = .18 + front * .82, width = band.width * (.70 + depth * .30), height = Math.max(2.5, Math.min(h * .25, band.height * arc * (.48 + front * .55))), x = band.x + band.width / 2 + Math.sin(phase) * band.width * .06;
      const [light, dark] = wheelPalette[index % wheelPalette.length], face = ctx.createLinearGradient(x - width / 2, y - height / 2, x + width / 2, y + height / 2); face.addColorStop(0, dark); face.addColorStop(.42, palette[index % palette.length]); face.addColorStop(.72, light); face.addColorStop(1, dark);
      ctx.save(); ctx.globalAlpha = .14 + front * .83; ctx.fillStyle = face; ctx.fillRect(x - width / 2, y - height / 2, width, height); ctx.strokeStyle = front > .76 ? 'rgba(255,243,189,.82)' : 'rgba(5,8,18,.96)'; ctx.lineWidth = Math.max(.8, depth * 1.8); ctx.strokeRect(x - width / 2, y - height / 2, width, height);
      if (front > .81) { const lines = splitLabel(choiceLabel(choice)), font = Math.max(6, Math.min(15, height * .50, width / (Math.max(...lines.map(line => line.length)) * .60))); ctx.fillStyle = '#fff'; ctx.font = `900 ${font}px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 3; lines.forEach((line, n) => ctx.fillText(line, x, y + (n - (lines.length - 1) / 2) * font * .90)); }
      ctx.restore();
    });
    ctx.restore();
    // Thin rails only: no marquee bulbs or outer cabinet.
    ctx.strokeStyle = 'rgba(182,214,255,.48)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(band.x + 7, band.y + 16); ctx.lineTo(band.x + 7, band.y + band.height - 16); ctx.moveTo(band.x + band.width - 7, band.y + 16); ctx.lineTo(band.x + band.width - 7, band.y + band.height - 16); ctx.stroke();
    // Selected panel is the same indexed belt panel at the fixed side flipper.
    const [selectedLight, selectedDark] = wheelPalette[selectedIndex % wheelPalette.length], sw = band.width * .96, sh = Math.max(40, Math.min(h * .25, band.height * arc * 1.03)), sx = band.x + band.width / 2;
    const selectedFace = ctx.createLinearGradient(sx - sw / 2, cy - sh / 2, sx + sw / 2, cy + sh / 2); selectedFace.addColorStop(0, selectedDark); selectedFace.addColorStop(.44, palette[selectedIndex % palette.length]); selectedFace.addColorStop(.72, selectedLight); selectedFace.addColorStop(1, selectedDark);
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.58)'; ctx.shadowBlur = 12; ctx.fillStyle = selectedFace; ctx.fillRect(sx - sw / 2, cy - sh / 2, sw, sh); ctx.strokeStyle = '#fff0a9'; ctx.lineWidth = 3; ctx.strokeRect(sx - sw / 2, cy - sh / 2, sw, sh); ctx.shadowBlur = 0; const selectedLines = splitLabel(choiceLabel(selected)), font = Math.max(12, Math.min(20, sh * .43, sw / (Math.max(...selectedLines.map(line => line.length)) * .58))); ctx.fillStyle = '#fff'; ctx.font = `900 ${font}px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 3; selectedLines.forEach((line, n) => ctx.fillText(line, sx, cy + (n - (selectedLines.length - 1) / 2) * font * .90)); ctx.restore();
    // A plain axle disc sits behind the HTML Spin control.
    ctx.beginPath(); ctx.arc(w * .18, cy, w * .10, 0, Math.PI * 2); ctx.fillStyle = '#294f8c'; ctx.fill(); ctx.strokeStyle = '#b5d1fa'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  function sampleFinalists(choices) { const pool = [...choices]; for (let i = 0; i < 3; i++) { const pick = i + secureIndex(pool.length - i); [pool[i], pool[pick]] = [pool[pick], pool[i]]; } return pool.slice(0, 3); }
  function spinFinalists() { const choices = eligibleChoices(); if (choices.length < 3) { toast('Spin & Dine needs at least 3 choices.'); return; } const finalists = sampleFinalists(choices); app.spinning = true; app.reelActive = [true, true, true]; app.reels = [choices[0], choices[1 % choices.length], choices[2 % choices.length]]; render(); const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; if (reduced) { app.reels = finalists; app.reelActive = []; app.finalists = finalists; app.spinning = false; render(); return; } let tick = 0; const ticker = setInterval(() => { tick++; app.reelActive.forEach((active, index) => { if (!active) return; const choice = choices[(tick * (index + 2) + index) % choices.length]; const label = $(`#reel-label-${index}`), by = $(`#reel-by-${index}`); if (label) label.textContent = choice.name; if (by) by.textContent = `${personName(choice.personId)}'s Choice`; }); }, 85); [3000, 6000, 9000].forEach((delay, index) => setTimeout(() => { app.reelActive[index] = false; app.reels[index] = finalists[index]; render(); if (index === 2) { clearInterval(ticker); app.finalists = finalists; app.spinning = false; app.reelActive = []; render(); } }, delay)); }
  function resetGame() { app.finalists = null; app.reels = []; app.winner = null; app.completed = false; app.rotation = 0; render(); }
  async function finishWinner(winner, rotation) { if (app.completed) return; app.rotation = rotation; app.spinning = false; app.winner = winner; const record={id:id(),placeId:winner.id,placeName:winner.name,personId:winner.personId,personName:personName(winner.personId),timestamp:new Date().toISOString()}; app.state.history.unshift(record); app.completed=true; await saveState(); render(); celebrate(); }
  function spinDinner() { if (!app.finalists || app.spinning || app.winner) return; const winner = app.finalists[secureIndex(3)], winnerIndex = app.finalists.findIndex(choice => choice.id === winner.id), arc = Math.PI * 2 / 3, target = -(winnerIndex + .5) * arc, tau = Math.PI * 2, start = app.rotation, delta = 5 * tau + ((target - start) % tau + tau) % tau, duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 3600; app.spinning = true; app.completed = false; render(); if (!duration) { finishWinner(winner, start + delta); return; } const began = performance.now(); const step = now => { const p = Math.min(1, (now - began) / duration), eased = 1 - Math.pow(1 - p, 4); app.rotation = start + delta * eased; drawFinalWheel(); if (p < 1) requestAnimationFrame(step); else finishWinner(winner, start + delta); }; requestAnimationFrame(step); }
  function drawFinalWheel() { const canvas = $('#final-wheel'); if (!canvas || !app.finalists) return; const rect = canvas.getBoundingClientRect(), scale = devicePixelRatio || 1; canvas.width = Math.max(1, Math.floor(rect.width * scale)); canvas.height = Math.max(1, Math.floor(rect.height * scale)); const ctx = canvas.getContext('2d'), w = rect.width, h = rect.height, cx = w / 2, cy = h / 2, r = Math.min(w, h) * .40, arc = Math.PI * 2 / 3; ctx.scale(scale, scale); ctx.clearRect(0, 0, w, h); const rim = ctx.createRadialGradient(cx - r*.2, cy-r*.25, r*.08, cx, cy, r*1.2); rim.addColorStop(0,'#fff4b1'); rim.addColorStop(.48,'#c58a28'); rim.addColorStop(.78,'#5a2b44'); rim.addColorStop(1,'#160d26'); ctx.beginPath(); ctx.arc(cx,cy,r*1.12,0,Math.PI*2); ctx.fillStyle=rim; ctx.fill(); for(let i=0;i<24;i++){const a=i*Math.PI*2/24, x=cx+Math.cos(a)*r*1.02,y=cy+Math.sin(a)*r*1.02;ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fillStyle='#fff0a0';ctx.shadowColor='#ffc85a';ctx.shadowBlur=6;ctx.fill();}ctx.shadowBlur=0; app.finalists.forEach((choice,index)=>{const start=-Math.PI/2+app.rotation+index*arc, end=start+arc, mid=(start+end)/2;const [light,dark]=wheelPalette[index];const g=ctx.createLinearGradient(cx-r,cy-r,cx+r,cy+r);g.addColorStop(0,dark);g.addColorStop(.55,palette[index]);g.addColorStop(1,light);ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,start,end);ctx.closePath();ctx.fillStyle=g;ctx.fill();ctx.strokeStyle='rgba(255,241,178,.8)';ctx.lineWidth=3;ctx.stroke();const lines=splitLabel(choiceLabel(choice)), font=Math.max(12,Math.min(19,r*.20,(r*.78)/(Math.max(...lines.map(x=>x.length))*.56)));ctx.save();ctx.fillStyle='#fff';ctx.font=`900 ${font}px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.shadowColor='rgba(0,0,0,.7)';ctx.shadowBlur=3;lines.forEach((line,n)=>ctx.fillText(line,cx+Math.cos(mid)*r*.57,cy+Math.sin(mid)*r*.57+(n-(lines.length-1)/2)*font*.88));ctx.restore();});ctx.beginPath();ctx.arc(cx,cy,r*.25,0,Math.PI*2);ctx.fillStyle='#183967';ctx.fill();ctx.strokeStyle='#ffe7a0';ctx.lineWidth=5;ctx.stroke();ctx.fillStyle='#fff2b3';ctx.font='900 10px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(app.winner ? '' : 'SPIN FOR DINNER',cx,cy); }
  async function completePick() { if(!app.winner || app.completed)return; const choice=app.winner; const record={id:id(),placeId:choice.id,placeName:choice.name,personId:choice.personId,personName:personName(choice.personId),timestamp:new Date().toISOString()}; app.state.history.unshift(record); app.completed=true; await saveState(); render(); toast(`${choice.name} added to history.`); }
  function celebrate(){if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;const layer=document.createElement('div');layer.className='confetti';for(let i=0;i<42;i++){const bit=document.createElement('i');bit.style.left=`${Math.random()*100}%`;bit.style.background=palette[i%palette.length];bit.style.setProperty('--x',`${(Math.random()-.5)*230}px`);bit.style.animationDelay=`${Math.random()*.22}s`;layer.append(bit);}document.body.append(layer);setTimeout(()=>layer.remove(),1900);}
  function setScreen(screen){app.screen=screen;app.winner=null;render();window.scrollTo({top:0,behavior:'instant'});}
  function initEvents(){ $$('.nav-item').forEach(btn=>btn.addEventListener('click',()=>setScreen(btn.dataset.screen)));window.addEventListener('resize',()=>{if(app.screen==='tonight')requestAnimationFrame(drawWheel);}); }
  async function init(){ try{app.state=await loadState();initEvents();render();if('serviceWorker'in navigator){navigator.serviceWorker.addEventListener('controllerchange',()=>window.location.reload(),{once:true});navigator.serviceWorker.register('./service-worker.js').then(registration=>registration.update()).catch(()=>{});}}catch(err){console.error(err);$('#screen').innerHTML='<section class="card empty"><h2>Unable to start Spin &amp; Dine</h2><p>This browser needs local storage enabled to save your family data.</p></section>';}}
  init();
})();
