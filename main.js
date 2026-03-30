/**
 * S.O.S. — Primary Interactivity & Integration Logic
 * Full re-integration pass: all UI interactions + live Supabase data layer.
 */

import { JobCards, Parts, Announcements, Logs, Users, PerformanceStats, Threads, KnowledgeBase, callAI, healthCheck, getCurrentAuth, subscribeAnnouncements } from './supabase.js';

// ─── GLOBAL SCOPE: expose helpers for inline onclick attributes in HTML ───
window.attendJob       = attendJob;
window.switchJobTab     = switchJobTab;
window.openLogsModal    = openLogsModal;
window.printJob         = printJob;
window.aiSendSuggestion = aiSendSuggestion;

// ============================================================
// BOOT
// ============================================================
// ============================================================
// GLOBAL ERROR BOUNDARY — toast + console fallback
// ============================================================
function showErrorToast(msg, duration = 5000) {
    // Reuse or create a singleton toast element
    let toast = document.getElementById('_sos_error_toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = '_sos_error_toast';
        toast.style.cssText = [
            'position:fixed', 'top:72px', 'left:50%', 'transform:translateX(-50%)',
            'z-index:9999', 'display:flex', 'align-items:center', 'gap:8px',
            'background:#1a0000', 'color:#ffb4ab', 'font-size:13px',
            'font-weight:600', 'padding:10px 18px', 'border-radius:999px',
            'box-shadow:0 8px 32px rgba(0,0,0,0.5)', 'pointer-events:none',
            'transition:opacity .3s',
        ].join(';');
        document.body.appendChild(toast);
    }
    toast.innerHTML = `<span style="font-size:16px">⚠</span> ${msg}`;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, duration);
}

// Wrap an async page-init so errors surface as toasts, never blank screens
async function safeInit(label, fn) {
    try {
        await fn();
    } catch (err) {
        console.error(`[S.O.S] ${label} init failed:`, err);
        showErrorToast(`${label} failed to load — check your connection.`);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const user = getCurrentAuth();
    console.log(`[S.O.S] Initializing for: ${user.full_name} (${user.role})`);

    // ─── ROBUST PAGE ROUTING (handles file://, localhost clean URLs, and .html) ───
    const href = (window.location.pathname + window.location.href).toLowerCase();
    const onPage = name => href.includes(name);

    if (onPage('dashboard')) {
        await safeInit('Dashboard', initDashboard);
    } else if (onPage('service_operations') || onPage('service-operations')) {
        await safeInit('Service Operations', initServiceOperations);
    } else if (onPage('discussion')) {
        safeInit('Discussion Portal', initDiscussion);
    } else if (onPage('profile')) {
        safeInit('Profile', initProfile);
    }

    // ─── GLOBAL: AI Assistant + Notice Board ───
    safeInit('AI Assistant', initAIAssistant);
    safeInit('Notice Board', initNoticeBoard);
});

// ============================================================
// DASHBOARD
// ============================================================
async function initDashboard() {
    console.log('[S.O.S] Dashboard init...');
    const unattendedGrid  = document.getElementById('unattended-grid');
    const completedTbody  = document.getElementById('completed-calls-tbody');
    const activeCount     = document.querySelector('.active-count-badge');
    
    // User Profile & Stats IDs
    const nameEl    = document.getElementById('dash-user-name');
    const roleEl    = document.getElementById('dash-user-role');
    const tasksStat = document.getElementById('dash-stat-tasks');
    const travelStat = document.getElementById('dash-stat-travel');

    const userAuth = getCurrentAuth();

    // Show skeleton loaders
    if (unattendedGrid)  unattendedGrid.innerHTML  = skeletonCards(2);
    if (completedTbody)  completedTbody.innerHTML  = skeletonRows(3);

    try {
        const [activeJobs, completedJobs, notices, profile, performance] = await Promise.all([
            JobCards.list('active',    false),   // scoped: only this user's active jobs
            JobCards.list('completed', false),   // scoped: only this user's completed jobs
            Announcements.list(5),
            Users.getProfile(userAuth.employee_id),
            PerformanceStats.list(userAuth.employee_id)
        ]);

        // Update Dashboard User Branding
        if (profile) {
            if (nameEl) nameEl.textContent = profile.full_name;
            if (roleEl) roleEl.textContent = profile.title || (profile.role === 'admin' ? 'Administrator' : 'Field Technician');
        }

        // Update Stats — always derived from this user's own job data
        const now = new Date();
        const todayCompleted = (completedJobs || []).filter(j => {
            const d = new Date(j.created_at);
            return d.getFullYear() === now.getFullYear()
                && d.getMonth()    === now.getMonth()
                && d.getDate()     === now.getDate();
        }).length;
        const monthCompleted = (completedJobs || []).filter(j => {
            const d = new Date(j.created_at);
            return d.getFullYear() === now.getFullYear()
                && d.getMonth()    === now.getMonth();
        }).length;

        if (tasksStat) tasksStat.textContent = todayCompleted > 0
            ? `${todayCompleted} today · ${monthCompleted} this month`
            : monthCompleted > 0 ? `${monthCompleted} this month` : '0 completed';
        if (travelStat) {
            if (performance && performance.length > 0) {
                travelStat.textContent = `${performance[0].travel_hrs || 0} hrs`;
            } else {
                travelStat.textContent = '0 hrs';
            }
        }

        renderActiveJobs(activeJobs || [], unattendedGrid);
        renderCompletedJobs(completedJobs || [], completedTbody);
        renderAnnouncements(notices || []);

        // Update count badge
        if (activeCount) activeCount.textContent = `${(activeJobs || []).length} Active`;

    } catch (err) {
        console.error('[S.O.S] Dashboard fetch failed:', err);
        if (unattendedGrid) unattendedGrid.innerHTML = `
            <p class="text-on-surface-variant italic col-span-full text-center py-8">
                Unable to load live data. Please check your connection.
            </p>`;
    }

    // Sorting
    document.getElementById('btn-sort-priority')?.addEventListener('click', () => sortActiveJobs('urgency'));
    document.getElementById('btn-sort-region')  ?.addEventListener('click', () => sortActiveJobs('facility'));
    document.getElementById('btn-sort-machine') ?.addEventListener('click', () => sortActiveJobs('machine_model'));

    // ── Attend button: short-press = navigate, long-press = complete ──
    const grid = document.getElementById('unattended-grid');
    if (grid) {
        let pressTimer = null;
        let pressTarget = null;

        const startPress = (e) => {
            const btn = e.target.closest('.attend-btn');
            if (!btn) return;
            pressTarget = btn;
            pressTimer = setTimeout(() => {
                pressTimer = null;
                completeJobLongPress(btn.dataset.jobId, btn, grid);
            }, 650);
        };
        const cancelPress = (e) => {
            if (!pressTimer) return;
            clearTimeout(pressTimer);
            pressTimer = null;
            const btn = e.target.closest('.attend-btn');
            if (btn && btn === pressTarget) attendJobShort(btn.dataset.jobId, btn);
            pressTarget = null;
        };
        const abortPress = () => {
            if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
            pressTarget = null;
        };

        grid.addEventListener('pointerdown', startPress);
        grid.addEventListener('pointerup',   cancelPress);
        grid.addEventListener('pointerleave', abortPress);
        // Prevent context menu on long-press (mobile)
        grid.addEventListener('contextmenu', e => { if (e.target.closest('.attend-btn')) e.preventDefault(); });
    }
}

function renderActiveJobs(jobs, container) {
    if (!container) return;
    if (!jobs.length) {
        container.innerHTML = '<p class="text-on-surface-variant italic col-span-full text-center py-12">No active support calls. All clear! ✓</p>';
        return;
    }
    container.innerHTML = jobs.map(job => `
        <div data-urgency="${escHtml(job.urgency || 'NORMAL')}" class="bg-surface-container-lowest p-6 rounded-xl border-l-4 ${getPriorityBorder(job.urgency)} shadow-sm flex flex-col justify-between group hover:shadow-md transition-shadow">
            <div>
                <div class="flex justify-between items-start mb-4">
                    <div>
                        <h4 class="font-bold text-lg text-on-surface">${escHtml(job.facility)}</h4>
                        <p class="text-sm text-on-surface-variant">${escHtml(job.machine_model || '')}</p>
                    </div>
                    <span class="${getPriorityBadgeClass(job.urgency)} text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-tighter">
                        ${escHtml(job.urgency || 'Normal')}
                    </span>
                </div>
                <p class="text-sm text-on-surface-variant mb-6">${escHtml(job.fault_description || '')}</p>
            </div>
            <div class="pt-4 flex items-center justify-between border-t border-outline-variant/10">
                <span class="text-xs font-medium text-on-surface-variant">${formatRelativeTime(job.created_at)}</span>
                <button class="attend-btn signature-gradient text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 active:scale-95 transition-all select-none"
                        data-job-id="${job.id}"
                        title="Tap to attend • Hold to mark completed">
                    <span class="attend-btn-label">Attend Now</span>
                    <span class="material-symbols-outlined text-sm attend-btn-icon">arrow_forward</span>
                </button>
            </div>
        </div>
    `).join('');
}

function renderCompletedJobs(jobs, container) {
    if (!container) return;
    if (!jobs.length) {
        container.innerHTML = '<tr><td colspan="4" class="px-6 py-8 text-center text-on-surface-variant italic">No completed jobs yet.</td></tr>';
        return;
    }
    container.innerHTML = jobs.map(job => `
        <tr class="hover:bg-surface-container/50 transition-colors">
            <td class="px-6 py-4 font-semibold text-sm">${escHtml(job.facility)}</td>
            <td class="px-6 py-4 text-sm text-on-surface-variant">${escHtml(job.machine_model || '')}</td>
            <td class="px-6 py-4">
                <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-tertiary-fixed-dim text-on-tertiary-fixed-variant text-[10px] font-bold">
                    <span class="material-symbols-outlined text-[10px]" style="font-variation-settings:'FILL' 1">check_circle</span>
                    SOLVED
                </span>
            </td>
            <td class="px-6 py-4 text-right text-xs text-on-surface-variant font-medium">${formatDisplayDate(job.created_at)}</td>
        </tr>
    `).join('');
}

function renderAnnouncements(notices) {
    const container = document.getElementById('announcements-list');
    if (!container || !notices.length) return;

    const criticColor = { urgent: 'error', critical: 'error', news: 'tertiary' };
    const criticIcon  = { urgent: 'warning', critical: 'report', news: 'campaign' };

    container.innerHTML = notices.map(n => {
        const c = criticColor[n.criticality] || 'secondary';
        const i = criticIcon[n.criticality]  || 'campaign';
        return `
            <div class="bg-surface-container-lowest p-4 rounded-lg border-l-4 border-${c} shadow-sm">
                <div class="flex items-center gap-2 mb-1">
                    <span class="material-symbols-outlined text-${c} text-sm">${i}</span>
                    <span class="text-[10px] font-bold text-${c} uppercase">${escHtml(n.criticality)}</span>
                </div>
                <p class="text-xs text-on-surface-variant leading-relaxed">${escHtml(n.message)}</p>
                <p class="text-[10px] text-on-surface-variant mt-2 opacity-60">${formatRelativeTime(n.created_at)}</p>
            </div>`;
    }).join('');
}

const URGENCY_ORDER = { CRITICAL: 0, URGENT: 1, NORMAL: 2 };

function sortActiveJobs(field) {
    const grid = document.getElementById('unattended-grid');
    if (!grid) return;
    const cards = Array.from(grid.children).filter(el => el.tagName !== 'P');
    cards.sort((a, b) => {
        if (field === 'urgency') {
            const ua = URGENCY_ORDER[a.dataset.urgency?.toUpperCase()] ?? 99;
            const ub = URGENCY_ORDER[b.dataset.urgency?.toUpperCase()] ?? 99;
            return ua - ub;
        }
        const ta = a.querySelector('h4')?.textContent || '';
        const tb = b.querySelector('h4')?.textContent || '';
        return ta.localeCompare(tb);
    });
    cards.forEach(c => grid.appendChild(c));
}

/** Short-press: show "Attending" state, then navigate to Service Operations */
async function attendJobShort(id, btn) {
    if (!id || !btn) return;
    btn.disabled = true;
    btn.classList.remove('signature-gradient');
    btn.classList.add('bg-tertiary-fixed-dim', 'text-on-tertiary-fixed-variant');
    const label = btn.querySelector('.attend-btn-label');
    const icon  = btn.querySelector('.attend-btn-icon');
    if (label) label.textContent = 'Attending…';
    if (icon)  icon.textContent  = 'pending';

    try {
        await Logs.write(`Attending job ${id}`, 'job_card', id);
    } catch (e) { /* non-critical */ }

    // Brief visual feedback, then navigate
    setTimeout(() => { window.location.href = './service_operations.html'; }, 500);
}

/** Long-press: immediately mark job as completed, move card to completed table */
async function completeJobLongPress(id, btn, grid) {
    if (!id) return;
    if (navigator.vibrate) navigator.vibrate([30, 20, 30]);

    // Visual feedback: pulse green
    const card = btn.closest('[data-job-id]') || btn.closest('.bg-surface-container-lowest');
    if (card) {
        card.style.transition = 'opacity 0.4s, transform 0.4s';
        card.style.opacity = '0';
        card.style.transform = 'scale(0.95)';
    }

    try {
        await JobCards.updateStatus(id, 'completed');
        await Logs.write(`Job ${id} marked completed via long-press`, 'job_card', id, 'info');

        // Remove card from active grid after animation
        setTimeout(() => {
            card?.remove();
            // Update active count badge
            const remaining = grid.querySelectorAll('.attend-btn').length;
            const badge = document.querySelector('.active-count-badge');
            if (badge) badge.textContent = `${remaining} Active`;

            // Refresh completed table
            JobCards.list('completed', true).then(jobs => {
                const tbody = document.getElementById('completed-calls-tbody');
                if (tbody) renderCompletedJobs(jobs || [], tbody);
            }).catch(() => {});
        }, 400);
    } catch (e) {
        console.error('[S.O.S] Long-press complete failed:', e);
        // Restore card on failure
        if (card) { card.style.opacity = '1'; card.style.transform = ''; }
    }
}

// Keep backward-compat global (still used in some HTML onclick attrs)
async function attendJob(id) { attendJobShort(id, document.querySelector(`[data-job-id="${id}"]`)); }

// ============================================================
// NOTICE BOARD MODAL (Dashboard)
// ============================================================
function initNoticeBoard() {
    const openBtn       = document.getElementById('btn-view-notices');
    const modal         = document.getElementById('notice-modal');
    const content       = document.getElementById('notice-modal-content');
    const closeBtn      = document.getElementById('btn-close-notices');
    const backdrop      = document.getElementById('notice-backdrop');
    const feed          = document.getElementById('notice-feed');
    const feedLoading   = document.getElementById('notice-feed-loading');
    const metaLine      = document.getElementById('notice-meta-line');
    const refreshBtn    = document.getElementById('btn-refresh-notices');
    const publishBtn    = document.getElementById('btn-publish-notice');
    const senderName    = document.getElementById('admin-sender-name');
    const senderTitle   = document.getElementById('admin-sender-title');
    const messageInput  = document.getElementById('admin-notice-message');
    const publishStatus = document.getElementById('publish-status');
    const critBtns      = document.querySelectorAll('.crit-btn');

    if (!openBtn || !modal) return;

    let selectedCrit       = 'news';
    let autoRefreshTimer   = null;
    let unsubscribeRealtime = null;
    let currentNotices     = [];

    // ── Criticality selector ──
    const activeCritClasses = {
        news:     ['border-secondary', 'bg-secondary-container', 'text-on-secondary-container'],
        urgent:   ['border-error',     'bg-error-container',     'text-on-error-container'],
        critical: ['border-error',     'bg-error/20',            'text-error'],
    };

    critBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            selectedCrit = btn.dataset.crit;
            critBtns.forEach(b => {
                b.classList.remove(
                    'border-secondary','bg-secondary-container','text-on-secondary-container',
                    'border-error','bg-error-container','text-on-error-container',
                    'bg-error/20','text-error'
                );
            });
            btn.classList.add(...(activeCritClasses[selectedCrit] || []));
        });
    });
    // Default: select "news"
    document.querySelector('.crit-btn-news')?.classList.add(...activeCritClasses.news);

    // ── Modal open / close ──
    const open = async () => {
        modal.classList.remove('opacity-0', 'pointer-events-none');
        content?.classList.remove('scale-95');
        content?.classList.add('scale-100');
        await loadFeed();
        // Live Realtime feed — prepend new WhatsApp notices instantly
        unsubscribeRealtime = subscribeAnnouncements((newRow) => {
            renderFeed([newRow, ...currentNotices]);
        });
        // Fallback poll every 60s in case WebSocket drops
        autoRefreshTimer = setInterval(loadFeed, 60_000);
    };

    const close = () => {
        modal.classList.add('opacity-0', 'pointer-events-none');
        content?.classList.remove('scale-100');
        content?.classList.add('scale-95');
        clearInterval(autoRefreshTimer);
        unsubscribeRealtime?.();
        unsubscribeRealtime = null;
    };

    openBtn .addEventListener('click', open);
    closeBtn?.addEventListener('click', close);
    backdrop?.addEventListener('click', close);
    refreshBtn?.addEventListener('click', loadFeed);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

    // ── Load and render the live feed ──
    async function loadFeed() {
        if (feedLoading) feedLoading.classList.remove('hidden');
        if (feed)        feed.classList.add('hidden');

        try {
            const notices = await Announcements.list(20);
            currentNotices = notices || [];
            renderFeed(currentNotices);
        } catch (e) {
            console.error('[S.O.S] Announcements fetch failed:', e);
            if (feed) {
                feed.innerHTML = `
                    <div class="text-center py-12 text-on-surface-variant">
                        <span class="material-symbols-outlined text-4xl mb-3 opacity-40">wifi_off</span>
                        <p class="text-sm font-semibold">Could not load announcements.</p>
                        <p class="text-xs opacity-60 mt-1">Check your connection and try refreshing.</p>
                    </div>`;
                feed.classList.remove('hidden');
            }
            if (feedLoading) feedLoading.classList.add('hidden');
        }
    }

    function renderFeed(notices) {
        if (!feed) return;
        currentNotices = notices;
        if (feedLoading) feedLoading.classList.add('hidden');
        feed.classList.remove('hidden');

        if (metaLine) {
            const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            metaLine.textContent = `${notices.length} announcement${notices.length !== 1 ? 's' : ''} — live · last refreshed ${now}`;
        }
        // Also update the refresh label in the modal footer
        const refreshLabel = document.getElementById('notice-refresh-label');
        if (refreshLabel) {
            const t = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            refreshLabel.textContent = `Live · auto-refreshes every 30s · last at ${t}`;
        }

        if (!notices.length) {
            feed.innerHTML = `
                <div class="text-center py-12 text-on-surface-variant">
                    <span class="material-symbols-outlined text-5xl mb-3 opacity-30">inbox</span>
                    <p class="text-sm font-semibold">No announcements yet.</p>
                    <p class="text-xs opacity-60 mt-1">Use the publish area above to post the first one.</p>
                </div>`;
            return;
        }

        feed.innerHTML = notices.map(n => noticeCard(n)).join('');
    }

    function noticeCard(n) {
        const crit = (n.criticality || 'news').toLowerCase();

        const configs = {
            urgent:   { border: 'border-error',     badge: 'bg-error text-on-error',              icon: 'warning',  label: 'URGENT',   glyph: '⚠️' },
            critical: { border: 'border-error',     badge: 'bg-red-700 text-white',                icon: 'report',   label: 'CRITICAL 🚨', glyph: '🚨' },
            news:     { border: 'border-secondary', badge: 'bg-secondary text-on-secondary',       icon: 'campaign', label: 'NEWS',     glyph: '📢' },
        };
        const cfg = configs[crit] || configs.news;

        // Sender initials avatar
        const initials = (n.sender_name || '??').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
        const avatarColors = {
            urgent:   'bg-error-container text-on-error-container',
            critical: 'bg-red-100 text-red-800',
            news:     'bg-secondary-container text-on-secondary-container',
        };

        return `
        <article class="bg-surface-container-lowest rounded-2xl border-l-4 ${cfg.border}
                         shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden
                         group">
            <!-- Card header: sender info + badge -->
            <div class="flex items-start justify-between px-5 pt-5 pb-3">
                <div class="flex items-center gap-3">
                    <!-- Sender avatar -->
                    <div class="w-10 h-10 rounded-full ${avatarColors[crit] || avatarColors.news}
                                flex items-center justify-center text-sm font-extrabold flex-shrink-0
                                ring-2 ring-outline-variant/20">
                        ${escHtml(initials)}
                    </div>
                    <div>
                        <p class="text-sm font-extrabold text-on-surface leading-tight">
                            ${escHtml(n.sender_name || 'Administrator')}
                        </p>
                        <p class="text-[11px] text-on-surface-variant opacity-80 leading-tight">
                            ${escHtml(n.sender_title || 'Official')}
                        </p>
                    </div>
                </div>
                <!-- Criticality badge -->
                <span class="${cfg.badge} text-[10px] font-black px-3 py-1 rounded-full
                             uppercase tracking-wider flex items-center gap-1 flex-shrink-0">
                    <span class="material-symbols-outlined text-[11px]"
                          style="font-variation-settings:'FILL' 1">${cfg.icon}</span>
                    ${cfg.label}
                </span>
            </div>

            <!-- Message body -->
            <div class="px-5 pb-5">
                <p class="text-sm text-on-surface leading-relaxed">
                    ${escHtml(n.message || '')}
                </p>
                <p class="text-[10px] text-on-surface-variant mt-3 opacity-60 flex items-center gap-1">
                    <span class="material-symbols-outlined text-xs">schedule</span>
                    ${formatRelativeTime(n.created_at)}
                </p>
            </div>
        </article>`;
    }

    // ── Admin Publish — only available to admins ──
    const authUser = getCurrentAuth();
    const isAdmin  = authUser.role === 'admin';

    // Find the publish composer container (parent of publishBtn) and hide it for non-admins
    const publishArea = publishBtn?.closest('[id]') || publishBtn?.parentElement;
    if (!isAdmin) {
        // Hide the entire compose area; show a read-only banner instead
        if (publishArea) publishArea.classList.add('hidden');
        const adminHint = document.createElement('div');
        adminHint.className = 'flex items-center gap-3 px-4 py-3 bg-surface-container rounded-xl border border-outline-variant/15 text-on-surface-variant text-xs font-medium';
        adminHint.innerHTML = '<span class="material-symbols-outlined text-sm opacity-50">lock</span>Only administrators can post announcements.';
        publishArea?.parentElement?.insertBefore(adminHint, publishArea);
    } else {
        publishBtn?.addEventListener('click', async () => {
            const name  = senderName?.value.trim();
            const title = senderTitle?.value.trim();
            const msg   = messageInput?.value.trim();

            if (!name || !title || !msg) {
                showStatus('⚠️ Please fill in your name, title, and the message.', 'text-error');
                return;
            }

            publishBtn.disabled = true;
            publishBtn.querySelector('span:last-child').textContent = 'Publishing…';

            try {
                await Announcements.create({
                    message:      msg,
                    criticality:  selectedCrit,
                    senderName:   name,
                    senderTitle:  title,
                });
                if (senderName)   senderName.value   = '';
                if (senderTitle)  senderTitle.value  = '';
                if (messageInput) messageInput.value = '';
                showStatus('✓ Announcement published successfully!', 'text-primary');
                await loadFeed();
            } catch (e) {
                console.error('[S.O.S] Publish announcement failed:', e);
                showStatus('✗ Failed to publish. Check your connection.', 'text-error');
            } finally {
                publishBtn.disabled = false;
                publishBtn.querySelector('span:last-child').textContent = 'Publish';
            }
        });
    }

    function showStatus(msg, colorClass) {
        if (!publishStatus) return;
        publishStatus.className = `text-xs mt-2 font-medium ${colorClass}`;
        publishStatus.textContent = msg;
        publishStatus.classList.remove('hidden');
        setTimeout(() => publishStatus.classList.add('hidden'), 4000);
    }
}

// ============================================================
// SERVICE OPERATIONS
// ============================================================
async function initServiceOperations() {
    console.log('[S.O.S] Service Operations init...');

    const jobForm = document.getElementById('job-card-form');

    jobForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = jobForm.querySelector('[type="submit"], #btn-submit-job');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving...'; }

        // Capture signature as data URL before saving
        const sigCanvas = document.getElementById('signature-canvas');
        const signatureDataUrl = sigCanvas && sigCanvas.getContext
            ? sigCanvas.toDataURL('image/png')
            : null;
        // Store for use in export modal / PDF
        if (signatureDataUrl) sessionStorage.setItem('sos_last_signature', signatureDataUrl);

        const formData = {
            facility:         (document.getElementById('client-name-input')?.value || '').trim(),
            machine:          (document.getElementById('machine-input')?.value      || '').trim(),
            serial:           (document.getElementById('serial-input')?.value       || '').trim(),
            faultDescription: (document.getElementById('fault-desc-input')?.value  || '').trim(),
            workPerformed:    (document.getElementById('work-performed-input')?.value || '').trim(),
            partsUsed:        (document.getElementById('parts-used-input')?.value   || '').trim(),
            signatureData:    signatureDataUrl,
            status:           'completed',
        };

        // ── Validate required fields ──
        const required = [
            { key: 'facility',         id: 'client-name-input',  label: 'Client / Facility' },
            { key: 'serial',           id: 'serial-input',        label: 'Serial Number' },
            { key: 'faultDescription', id: 'fault-desc-input',    label: 'Fault Description' },
        ];
        const missing = required.filter(f => !formData[f.key]);
        if (missing.length) {
            missing.forEach(f => {
                const el = document.getElementById(f.id);
                if (el) {
                    el.classList.add('ring-2', 'ring-error/60');
                    el.addEventListener('input', () => el.classList.remove('ring-2', 'ring-error/60'), { once: true });
                }
            });
            const errBox  = document.getElementById('form-error-msg');
            const errText = document.getElementById('form-error-text');
            if (errText) errText.textContent = `Required: ${missing.map(f => f.label).join(' · ')}`;
            if (errBox)  { errBox.classList.remove('hidden'); setTimeout(() => errBox.classList.add('hidden'), 6000); }
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit Job Card'; }
            return;
        }

        try {
            await JobCards.create(formData);
            await Logs.write(`Job card submitted for ${formData.facility}`, 'job_card', formData.serial);
            showExportModal();
            // Clear any draft for that machine
            clearDraftById(formData.machine);
        } catch (err) {
            console.error('[S.O.S] Job card save failed:', err);
            const errEl = document.getElementById('form-error-msg');
            if (errEl) {
                errEl.textContent = 'Save failed — working offline. Draft stored locally.';
                errEl.classList.remove('hidden');
            }
            // Fallback: save to localStorage
            const drafts = JSON.parse(localStorage.getItem('completedJobs') || '[]');
            drafts.unshift({ ...formData, savedAt: new Date().toISOString() });
            localStorage.setItem('completedJobs', JSON.stringify(drafts.slice(0, 20)));
        } finally {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit & Export'; }
        }
    });

    initPartRequests();
    initSignatureCanvas();
    initDrafts();
    await renderLogBook();
    initExportModal();
}

// ─── PART REQUESTS ───
async function initPartRequests() {
    const list        = document.getElementById('part-requests-list');
    const newBtn      = document.getElementById('btn-new-request');
    const modal       = document.getElementById('part-request-modal');
    const modalContent= document.getElementById('part-request-content');
    const closeBtn    = document.getElementById('btn-close-part-modal');
    const backdrop    = document.getElementById('part-request-backdrop');
    const submitBtn   = document.getElementById('btn-submit-part-request');
    const partInput   = document.getElementById('modal-part-name');
    const urgencyBtns = document.querySelectorAll('.urgency-btn');

    let selectedUrgency = 'NORMAL';

    // Urgency toggle
    urgencyBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            selectedUrgency = btn.dataset.urgency || 'NORMAL';
            urgencyBtns.forEach(b => b.classList.remove(
                'border-primary', 'bg-primary-container', 'text-on-primary-container',
                'border-error',   'bg-error-container',   'text-on-error-container'
            ));
            const isCritical = selectedUrgency === 'CRITICAL' || selectedUrgency === 'EMERGENCY';
            btn.classList.add(
                isCritical ? 'border-error' : 'border-primary',
                isCritical ? 'bg-error-container' : 'bg-primary-container',
                isCritical ? 'text-on-error-container' : 'text-on-primary-container'
            );
        });
    });

    const openModal = () => {
        if (!modal) return;
        modal.classList.remove('hidden');
        requestAnimationFrame(() => {
            modal.classList.remove('opacity-0', 'pointer-events-none');
            modalContent?.classList.remove('scale-95');
            modalContent?.classList.add('scale-100');
        });
    };

    const closeModal = () => {
        if (!modal) return;
        modal.classList.add('opacity-0', 'pointer-events-none');
        modalContent?.classList.remove('scale-100');
        modalContent?.classList.add('scale-95');
        setTimeout(() => modal.classList.add('hidden'), 300);
    };

    newBtn   ?.addEventListener('click', openModal);
    closeBtn ?.addEventListener('click', closeModal);
    backdrop ?.addEventListener('click', closeModal);

    // Render from Supabase
    const renderParts = async () => {
        if (!list) return;
        list.innerHTML = '<p class="text-xs text-on-surface-variant italic">Loading parts...</p>';
        try {
            const parts = await Parts.list();
            if (!parts || parts.length === 0) {
                list.innerHTML = '<p class="text-xs text-on-surface-variant italic">No part requests yet.</p>';
                return;
            }
            const currentUser = getCurrentAuth();
            const canUpdateStatus = currentUser.role === 'admin';
            const nextStatus = { 'PENDING': 'APPROVED', 'APPROVED': 'RECEIVED', 'RECEIVED': 'RECEIVED' };
            const statusConfig = {
                PENDING:  { clr: 'bg-surface-container-high text-on-surface-variant',  icon: 'hourglass_top' },
                APPROVED: { clr: 'bg-secondary-container text-on-secondary-container', icon: 'verified' },
                RECEIVED: { clr: 'bg-tertiary-fixed-dim text-on-tertiary-fixed-variant', icon: 'check_circle' },
            };
            list.innerHTML = parts.map(p => {
                const isCrit = p.urgency === 'CRITICAL' || p.urgency === 'EMERGENCY';
                const sc = statusConfig[p.status] || statusConfig.PENDING;
                const canAdvance = canUpdateStatus && p.status !== 'RECEIVED';
                return `
                <div class="bg-surface-container-lowest p-5 rounded-[1.25rem] border ${isCrit ? 'border-error/30' : 'border-outline-variant/20'} shadow-sm transition-all duration-300">
                    <div class="flex justify-between items-start mb-3">
                        <div class="flex items-center gap-2">
                            <span class="material-symbols-outlined text-sm ${isCrit ? 'text-error' : 'text-primary'}">build_circle</span>
                            <h4 class="font-bold text-on-surface text-sm">${escHtml(p.part_name)}</h4>
                        </div>
                        <button class="btn-part-status ${sc.clr} px-3 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 ${canAdvance ? 'cursor-pointer hover:opacity-80 active:scale-95 transition-all' : 'cursor-default'}"
                                data-part-id="${p.id}" data-part-name="${escHtml(p.part_name)}" data-current="${p.status}" ${!canAdvance ? 'disabled' : ''}>
                            <span class="material-symbols-outlined text-[10px]" style="font-variation-settings:'FILL' 1">${sc.icon}</span>
                            ${escHtml(p.status)}${canAdvance ? ' →' : ''}
                        </button>
                    </div>
                    <div class="flex items-center justify-between text-xs text-on-surface-variant">
                        <div class="flex items-center gap-1.5 font-medium">
                            <span class="material-symbols-outlined text-[14px]">local_shipping</span>
                            Requested ${formatRelativeTime(p.created_at)}
                        </div>
                        <span class="font-bold ${isCrit ? 'text-error' : 'text-secondary'} uppercase tracking-wider text-[10px]">${escHtml(p.urgency)}</span>
                    </div>
                </div>`;
            }).join('');

            // Wire up admin status update buttons
            if (canUpdateStatus) {
                list.querySelectorAll('.btn-part-status:not([disabled])').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const id      = btn.dataset.partId;
                        const name    = btn.dataset.partName;
                        const current = btn.dataset.current;
                        const next    = nextStatus[current];
                        if (!next || next === current) return;
                        btn.disabled = true;
                        try {
                            await Parts.updateStatus(id, next);
                            await Logs.write(`Part status updated: ${name}`, 'parts', `${current} → ${next}`, 'info');
                            await renderParts();
                        } catch (e) {
                            console.error('[S.O.S] Part status update failed:', e);
                            btn.disabled = false;
                        }
                    });
                });
            }
        } catch (err) {
            console.warn('[S.O.S] Parts load failed:', err);
            list.innerHTML = '<p class="text-xs text-error-container italic">Could not load parts.</p>';
        }
    };

    // Submit new part request
    submitBtn?.addEventListener('click', async () => {
        const val = partInput?.value.trim();
        if (!val) {
            partInput?.focus();
            return;
        }
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';
        try {
            await Parts.create({ partName: val, urgency: selectedUrgency });
            await Logs.write(`Part requested: ${val}`, 'parts', selectedUrgency);
            partInput.value = '';
            closeModal();
            await renderParts();
        } catch (e) {
            console.error('[S.O.S] Part create failed:', e);
            alert('Part request failed. Please try again.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Request';
        }
    });

    await renderParts();
}

// ─── SIGNATURE CANVAS ───
function initSignatureCanvas() {
    const canvas      = document.getElementById('signature-canvas');
    const clearBtn    = document.getElementById('clear-signature');
    const placeholder = document.getElementById('signature-placeholder');

    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const resize = () => {
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width  = rect.width  || 300;
        canvas.height = rect.height || 120;
    };
    resize();
    window.addEventListener('resize', resize);

    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.strokeStyle = '#00132a';

    let drawing = false;

    const getPos = e => {
        const r = canvas.getBoundingClientRect();
        const src = e.touches ? e.touches[0] : e;
        return { x: src.clientX - r.left, y: src.clientY - r.top };
    };

    const onStart = e => {
        drawing = true;
        const p = getPos(e);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        if (placeholder) placeholder.style.display = 'none';
        if (e.cancelable) e.preventDefault();
    };
    const onMove = e => {
        if (!drawing) return;
        const p = getPos(e);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        if (e.cancelable) e.preventDefault();
    };
    const onStop = () => { drawing = false; ctx.closePath(); };

    canvas.addEventListener('mousedown',  onStart);
    canvas.addEventListener('mousemove',  onMove);
    canvas.addEventListener('mouseup',    onStop);
    canvas.addEventListener('mouseout',   onStop);
    canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('touchmove',  onMove,  { passive: false });
    canvas.addEventListener('touchend',   onStop);

    clearBtn?.addEventListener('click', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (placeholder) placeholder.style.display = 'block';
    });
}

// ─── JOB DRAFTS ───
function initDrafts() {
    const draftBtn     = document.getElementById('btn-draft-job');
    const draftsList   = document.getElementById('drafts-list');
    const draftsWrapper= document.getElementById('drafts-wrapper');

    const getFields = () => ({
        id:               Date.now(),
        facility:         document.getElementById('client-name-input')?.value || '',
        machine:          document.getElementById('machine-input')?.value     || '',
        serial:           document.getElementById('serial-input')?.value      || '',
        faultDescription: document.getElementById('fault-desc-input')?.value  || '',
        workPerformed:    document.getElementById('work-performed-input')?.value || '',
        partsUsed:        document.getElementById('parts-used-input')?.value    || '',
        savedAt:          new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    });

    const setFields = draft => {
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
        set('client-name-input',   draft.facility);
        set('machine-input',        draft.machine);
        set('serial-input',         draft.serial);
        set('fault-desc-input',     draft.faultDescription);
        set('work-performed-input', draft.workPerformed);
        set('parts-used-input',     draft.partsUsed);
    };

    const render = () => {
        if (!draftsList) return;
        const drafts = JSON.parse(localStorage.getItem('jobDrafts') || '[]');
        if (!drafts.length) { draftsWrapper?.classList.add('hidden'); return; }
        draftsWrapper?.classList.remove('hidden');

        draftsList.innerHTML = '';
        drafts.forEach(d => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'w-full text-left bg-surface-container-highest hover:bg-surface-container-highest/80 p-3 rounded-xl border border-outline-variant/30 flex items-center justify-between transition-colors group';
            btn.innerHTML = `
                <div class="flex flex-col gap-1">
                    <span class="text-xs font-bold text-primary">Draft: ${escHtml(d.machine || 'Unknown')}</span>
                    <span class="text-[10px] text-on-surface-variant">${escHtml(d.facility || 'No Facility')} • ${escHtml(d.savedAt || '')}</span>
                </div>
                <span class="material-symbols-outlined text-sm text-on-surface-variant group-hover:text-primary transition-colors">restore</span>`;
            btn.addEventListener('click', () => {
                setFields(d);
                // Remove restored draft
                const updated = JSON.parse(localStorage.getItem('jobDrafts') || '[]').filter(x => x.id !== d.id);
                localStorage.setItem('jobDrafts', JSON.stringify(updated));
                render();
                // Flash the form
                const form = document.getElementById('job-card-form');
                if (form) {
                    form.scrollIntoView({ behavior: 'smooth' });
                    form.classList.add('ring-2', 'ring-primary', 'ring-inset', 'rounded-xl');
                    setTimeout(() => form.classList.remove('ring-2', 'ring-primary', 'ring-inset', 'rounded-xl'), 600);
                }
            });
            draftsList.appendChild(btn);
        });
    };

    draftBtn?.addEventListener('click', () => {
        const newDraft = getFields();
        const drafts   = JSON.parse(localStorage.getItem('jobDrafts') || '[]');
        drafts.unshift(newDraft);
        localStorage.setItem('jobDrafts', JSON.stringify(drafts.slice(0, 5)));
        render();
        // Visual feedback
        const orig = draftBtn.textContent;
        draftBtn.textContent = '✓ Draft Saved!';
        draftBtn.classList.add('bg-primary-container', 'text-on-primary-container');
        setTimeout(() => {
            draftBtn.textContent = orig;
            draftBtn.classList.remove('bg-primary-container', 'text-on-primary-container');
        }, 1200);
    });

    render();
}

function clearDraftById(machine) {
    const drafts = JSON.parse(localStorage.getItem('jobDrafts') || '[]');
    localStorage.setItem('jobDrafts', JSON.stringify(drafts.filter(d => d.machine !== machine)));
}

// ─── UNIT LOG BOOK ───
async function renderLogBook() {
    const list = document.getElementById('unit-logbook-list');
    if (!list) return;

    list.innerHTML = '<p class="text-xs text-on-surface-variant italic">Loading log...</p>';

    try {
        const jobs = await JobCards.list(null, false);
        if (!jobs || !jobs.length) {
            list.innerHTML = '<p class="text-xs text-on-surface-variant italic">No service history yet.</p>';
            return;
        }
        list.innerHTML = jobs.slice(0, 10).map(j => `
            <div class="bg-surface-container-lowest p-4 rounded-xl border-l-2 border-primary space-y-2 mb-4">
                <div class="flex items-center justify-between">
                    <span class="text-sm font-bold text-primary">${escHtml(j.machine_model || 'Unknown Model')}</span>
                    <span class="text-[10px] text-on-surface-variant">SN: ${escHtml(j.serial_number || 'N/A')}</span>
                </div>
                <div class="flex justify-between text-[11px]">
                    <span class="font-bold text-on-surface-variant">Facility</span>
                    <span class="text-primary">${escHtml(j.facility)}</span>
                </div>
                <div class="flex justify-between text-[11px]">
                    <span class="font-bold text-on-surface-variant">Tech</span>
                    <span class="text-primary">${escHtml(j.technician_name || 'Unknown')}</span>
                </div>
                <p class="text-[11px] text-on-surface-variant italic mt-1">${escHtml(j.fault_description || 'Routine maintenance.')}</p>
                <p class="text-[10px] text-on-surface-variant opacity-60">${formatDisplayDate(j.created_at)}</p>
            </div>
        `).join('');
    } catch (err) {
        console.warn('[S.O.S] Log book fetch failed:', err);
        list.innerHTML = '<p class="text-xs text-on-surface-variant italic">Could not load history.</p>';
    }
}

// ─── EXPORT MODAL ───
function initExportModal() {
    const modal     = document.getElementById('export-modal');
    const content   = document.getElementById('export-modal-content');
    const closeBtn  = document.getElementById('btn-export-done');
    const backdrop  = document.getElementById('export-backdrop');

    if (!modal) return;

    const close = () => {
        modal.classList.add('opacity-0', 'pointer-events-none');
        content?.classList.remove('scale-100');
        content?.classList.add('scale-95');
        setTimeout(() => modal.classList.add('hidden'), 300);
        // Reset form
        document.getElementById('job-card-form')?.reset();
    };

    closeBtn ?.addEventListener('click', close);
    backdrop ?.addEventListener('click', close);

    // Export PDF — opens a print-ready report with form data + signature
    document.getElementById('btn-export-pdf')?.addEventListener('click', () => {
        const sig  = sessionStorage.getItem('sos_last_signature');
        const user = getCurrentAuth();
        const facility = (document.getElementById('client-name-input')?.value || '').trim() || '—';
        const machine  = (document.getElementById('machine-input')?.value || '').trim() || '—';
        const serial   = (document.getElementById('serial-input')?.value || '').trim() || '—';
        const fault    = (document.getElementById('fault-desc-input')?.value || '').trim() || '—';
        const work     = (document.getElementById('work-performed-input')?.value || '').trim() || '—';
        const parts    = (document.getElementById('parts-used-input')?.value || '').trim() || 'None';
        const now      = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });

        const sigBlock = sig
            ? `<div style="margin-top:20px"><p style="font-size:11px;color:#43474e;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Client Authorisation Signature</p>
               <img src="${sig}" style="border:1px solid #c3c6cf;border-radius:8px;max-height:80px;background:#fff;"/></div>`
            : `<div style="margin-top:20px;border:1px dashed #c3c6cf;border-radius:8px;height:60px;display:flex;align-items:center;justify-content:center;">
               <p style="font-size:11px;color:#73777f;font-style:italic">No signature captured</p></div>`;

        const win = window.open('', '_blank');
        win.document.write(`<!DOCTYPE html><html><head><title>Job Card — ${escHtml(facility)}</title>
        <style>
            body{font-family:'Segoe UI',Inter,sans-serif;padding:40px;color:#001c39;max-width:800px;margin:0 auto}
            .header{border-bottom:2px solid #00284d;padding-bottom:16px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:flex-end}
            h1{margin:0;color:#00132a;font-size:22px;font-weight:800}
            .meta{font-size:11px;color:#43474e;margin-top:4px}
            table{width:100%;border-collapse:collapse;margin-top:8px}
            th,td{border:1px solid #c3c6cf;padding:10px 14px;text-align:left;font-size:13px;vertical-align:top}
            th{background:#e6eeff;color:#366287;text-transform:uppercase;font-size:10px;font-weight:700;letter-spacing:.06em;width:160px}
            .footer{margin-top:32px;font-size:10px;color:#73777f;text-align:center;border-top:1px solid #e6eeff;padding-top:12px}
            @media print{body{padding:20px}}
        </style></head><body>
        <div class="header">
            <div>
                <h1>2nd Opinion Systems</h1>
                <p class="meta">Service Job Card Report • Generated ${now}</p>
            </div>
            <p class="meta" style="text-align:right">Technician: ${escHtml(user.full_name || user.username || 'N/A')}</p>
        </div>
        <table>
            <tr><th>Facility / Client</th><td>${escHtml(facility)}</td></tr>
            <tr><th>Machine Model</th><td>${escHtml(machine)}</td></tr>
            <tr><th>Serial Number</th><td>${escHtml(serial)}</td></tr>
            <tr><th>Fault Description</th><td>${escHtml(fault)}</td></tr>
            <tr><th>Work Performed</th><td>${escHtml(work)}</td></tr>
            <tr><th>Parts Used</th><td>${escHtml(parts)}</td></tr>
        </table>
        ${sigBlock}
        <div class="footer">S.O.S. Field Operations Portal — Confidential Service Record</div>
        </body></html>`);
        win.document.close();
        win.print();
    });
}

function showExportModal() {
    const modal   = document.getElementById('export-modal');
    const content = document.getElementById('export-modal-content');
    if (!modal) return;
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0', 'pointer-events-none');
        content?.classList.remove('scale-95');
        content?.classList.add('scale-100');
    });
}

// ============================================================
// DISCUSSION PORTAL — full implementation
// ============================================================
async function initDiscussion() {
    console.log('[S.O.S] Discussion Portal init...');
    Logs.write('Discussion Portal visited', 'navigation').catch(() => {});

    let activeCategory = null; // null = all categories

    // ── Category filter links ──
    const catLinks = document.querySelectorAll('.cat-filter-link');
    catLinks.forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            const cat = link.dataset.category || null;
            activeCategory = cat === activeCategory ? null : cat; // toggle
            catLinks.forEach(l => {
                const isActive = l.dataset.category === activeCategory;
                l.classList.toggle('bg-surface-container-highest', isActive);
                l.classList.toggle('text-primary',                 isActive);
                l.classList.toggle('font-semibold',                isActive);
                l.classList.toggle('hover:bg-surface-container-low', !isActive);
                l.classList.toggle('text-on-surface-variant',      !isActive);
            });
            loadThreads(activeCategory);
        });
    });

    // ── Search input ──
    const searchInput = document.getElementById('thread-search-input');
    searchInput?.addEventListener('input', () => {
        const q = searchInput.value.trim().toLowerCase();
        document.querySelectorAll('.thread-card').forEach(card => {
            const text = card.textContent.toLowerCase();
            card.style.display = text.includes(q) ? '' : 'none';
        });
    });

    // ── Post new thread ──
    const postBtn      = document.getElementById('btn-post-thread');
    const postTextarea = document.getElementById('post-textarea');
    const postTitle    = document.getElementById('post-title-input');
    const postCategory = document.getElementById('post-category-select');

    postBtn?.addEventListener('click', async () => {
        const title = postTitle?.value.trim() || postTextarea?.value.split('\n')[0].trim();
        const body  = postTextarea?.value.trim();
        const cat   = postCategory?.value || 'fault_finding';

        if (!title || !body) {
            postTextarea?.focus();
            postTextarea?.classList.add('ring-2', 'ring-error');
            setTimeout(() => postTextarea?.classList.remove('ring-2', 'ring-error'), 1500);
            return;
        }

        postBtn.disabled = true;
        postBtn.textContent = 'Posting…';
        try {
            const attachmentUrls = pendingAttachments.length
                ? JSON.stringify(pendingAttachments.map(a => ({ name: a.name, type: a.type, data: a.data })))
                : null;
            await Threads.create({ title, body, category: cat, attachmentUrls });
            await Logs.write(`Thread posted: ${title}`, 'discussion', cat);
            if (postTitle)    postTitle.value    = '';
            if (postTextarea) postTextarea.value = '';
            // Clear attachments
            pendingAttachments.length = 0;
            if (previewStrip) { previewStrip.innerHTML = ''; previewStrip.classList.add('hidden'); }
            await loadThreads(activeCategory);
            await loadLiveStats();
            await loadContributors();
        } catch (err) {
            console.error('[S.O.S] Thread post failed:', err);
        } finally {
            postBtn.disabled = false;
            postBtn.textContent = 'Post Thread';
        }
    });

    // ── File attachment handlers (photo + schematic) ──
    const photoInput     = document.getElementById('photo-file-input');
    const schematicInput = document.getElementById('schematic-file-input');
    const previewStrip   = document.getElementById('attach-preview-strip');
    const photoBtnWrap   = document.getElementById('btn-add-photo');
    const photoMenu      = document.getElementById('photo-source-menu');

    photoBtnWrap?.addEventListener('click', e => {
        e.stopPropagation();
        photoMenu?.classList.toggle('hidden');
    });
    document.addEventListener('click', () => photoMenu?.classList.add('hidden'));
    document.getElementById('btn-choose-gallery')?.addEventListener('click', () => {
        photoInput.removeAttribute('capture');
        photoInput.click();
    });
    document.getElementById('btn-use-camera')?.addEventListener('click', () => {
        photoInput.setAttribute('capture', 'environment');
        photoInput.click();
    });
    document.getElementById('btn-add-schematic')?.addEventListener('click', () => schematicInput.click());

    // Holds base64-encoded attachments pending the next post
    const pendingAttachments = [];

    const fileToBase64 = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = e => resolve({ name: file.name, type: file.type, data: e.target.result });
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });

    const addPreview = (name, isImage, src, attachObj) => {
        if (!previewStrip) return;
        previewStrip.classList.remove('hidden');
        if (attachObj) pendingAttachments.push(attachObj);
        const chip = document.createElement('div');
        chip.className = 'flex items-center gap-2 bg-surface-container-highest rounded-lg px-3 py-1.5 text-xs font-medium text-on-surface max-w-[160px]';
        chip.innerHTML = isImage
            ? `<img src="${src}" class="w-8 h-8 rounded object-cover flex-shrink-0"/><span class="truncate">${escHtml(name)}</span>`
            : `<span class="material-symbols-outlined text-secondary text-base">attach_file</span><span class="truncate">${escHtml(name)}</span>`;
        const rm = document.createElement('button');
        rm.innerHTML = '<span class="material-symbols-outlined text-xs text-on-surface-variant hover:text-error">close</span>';
        rm.addEventListener('click', () => {
            const idx = pendingAttachments.findIndex(a => a.name === name);
            if (idx > -1) pendingAttachments.splice(idx, 1);
            chip.remove();
            if (!previewStrip.children.length) previewStrip.classList.add('hidden');
        });
        chip.appendChild(rm);
        previewStrip.appendChild(chip);
    };

    photoInput?.addEventListener('change', async () => {
        for (const f of Array.from(photoInput.files)) {
            const obj = await fileToBase64(f).catch(() => null);
            addPreview(f.name, true, obj?.data || '', obj);
        }
        photoInput.value = '';
    });
    schematicInput?.addEventListener('change', async () => {
        for (const f of Array.from(schematicInput.files)) {
            const obj = await fileToBase64(f).catch(() => null);
            addPreview(f.name, false, null, obj);
        }
        schematicInput.value = '';
    });

    // ── Initial data load ──
    await Promise.all([loadThreads(null), loadLiveStats(), loadContributors()]);
}

async function loadThreads(category) {
    const feed = document.getElementById('thread-feed');
    if (!feed) return;
    feed.innerHTML = '<div class="animate-pulse space-y-4">' +
        Array(3).fill('<div class="h-32 bg-outline-variant/20 rounded-xl"></div>').join('') + '</div>';
    try {
        const threads = await Threads.list(category);
        if (!threads || !threads.length) {
            feed.innerHTML = `
                <div class="text-center py-16 text-on-surface-variant">
                    <span class="material-symbols-outlined text-5xl mb-3 opacity-30">forum</span>
                    <p class="font-semibold text-sm">No threads yet${category ? ' in this category' : ''}.</p>
                    <p class="text-xs opacity-60 mt-1">Be the first to post a question or insight.</p>
                </div>`;
            return;
        }
        feed.innerHTML = threads.map(t => renderThread(t)).join('');

        // Wire up helpful buttons
        feed.querySelectorAll('.btn-helpful').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id  = btn.dataset.threadId;
                const cur = parseInt(btn.dataset.count || '0', 10);
                try {
                    await Threads.markHelpful(id, cur);
                    btn.dataset.count = cur + 1;
                    btn.querySelector('.helpful-count').textContent = cur + 1;
                    btn.classList.add('text-secondary');
                    Logs.write(`Marked thread helpful`, 'discussion', id).catch(() => {});
                } catch (e) { console.warn('[S.O.S] markHelpful failed:', e); }
            });
        });

        // Wire up resolve buttons (only visible when thread is not resolved)
        feed.querySelectorAll('.btn-resolve').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id    = btn.dataset.threadId;
                const title = btn.dataset.title;
                btn.disabled = true;
                btn.textContent = 'Resolving…';
                try {
                    await Threads.resolve(id);
                    await Logs.write(`Thread resolved: ${title}`, 'discussion', id, 'info');
                    await loadThreads(activeCategory); // re-render so "Resolved" badge appears
                } catch (e) {
                    console.warn('[S.O.S] resolve failed:', e);
                    btn.disabled = false;
                    btn.innerHTML = '<span class="material-symbols-outlined text-sm">check_circle</span> Mark Resolved';
                }
            });
        });
    } catch (err) {
        console.error('[S.O.S] loadThreads failed:', err);
        feed.innerHTML = '<p class="text-center text-sm text-on-surface-variant py-8">Could not load threads. Check your connection.</p>';
    }
}

function renderThread(t) {
    const catLabel = { fault_finding: 'Fault finding help', parts_advice: 'Parts advice', software_issues: 'Software issues', installation_support: 'Installation support' };
    const urgencyBadge = t.urgency === 'resolved'
        ? '<span class="bg-tertiary-container/40 text-on-tertiary-container text-[10px] font-extrabold px-2 py-1 rounded tracking-tighter uppercase">Resolved</span>'
        : t.urgency === 'urgent'
        ? '<span class="bg-surface-container-highest text-primary-container text-[10px] font-extrabold px-2 py-1 rounded tracking-tighter uppercase">Urgent</span>'
        : '';
    const initials = (t.author_name || '??').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return `
    <article class="thread-card bg-surface-container-lowest rounded-xl p-6 shadow-sm border-l-4 border-primary-container">
        <div class="flex justify-between items-start mb-4">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-container text-xs font-bold">
                    ${escHtml(initials)}
                </div>
                <div>
                    <h4 class="text-sm font-bold text-on-surface">${escHtml(t.author_name)}
                        <span class="text-on-surface-variant font-normal">in</span>
                        ${escHtml(catLabel[t.category] || t.category)}
                    </h4>
                    <span class="text-xs text-on-surface-variant">${formatRelativeTime(t.created_at)}</span>
                </div>
            </div>
            ${urgencyBadge}
        </div>
        <h3 class="text-base font-bold text-on-surface mb-2 leading-snug">${escHtml(t.title)}</h3>
        <p class="text-on-surface-variant text-sm mb-4 leading-relaxed line-clamp-3">${escHtml(t.body)}</p>
        ${(() => {
            try {
                const files = t.attachment_urls ? JSON.parse(t.attachment_urls) : [];
                if (!files.length) return '';
                const imgs = files.filter(f => f.type?.startsWith('image/'));
                const docs = files.filter(f => !f.type?.startsWith('image/'));
                return `<div class="flex flex-wrap gap-2 mb-3">
                    ${imgs.map(f => `<img src="${f.data}" alt="${escHtml(f.name)}" class="w-16 h-16 rounded-lg object-cover border border-outline-variant/20"/>`).join('')}
                    ${docs.map(f => `<span class="flex items-center gap-1 bg-surface-container-highest text-xs text-on-surface-variant px-2 py-1 rounded-lg"><span class="material-symbols-outlined text-sm">attach_file</span>${escHtml(f.name)}</span>`).join('')}
                </div>`;
            } catch { return ''; }
        })()}
        <div class="flex items-center gap-6 pt-4 border-t border-surface-container flex-wrap">
            <button class="btn-helpful flex items-center gap-2 text-on-surface-variant hover:text-secondary transition-colors"
                    data-thread-id="${t.id}" data-count="${t.helpful_count || 0}">
                <span class="material-symbols-outlined text-xl">thumb_up</span>
                <span class="text-xs font-semibold uppercase tracking-wider helpful-count">${t.helpful_count || 0} Helpful</span>
            </button>
            <span class="flex items-center gap-2 text-on-surface-variant text-xs font-semibold uppercase tracking-wider">
                <span class="material-symbols-outlined text-xl">forum</span>
                ${t.reply_count || 0} Replies
            </span>
            ${t.urgency !== 'resolved' ? `
            <button class="btn-resolve ml-auto flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant hover:text-on-tertiary-container hover:bg-tertiary-container/30 px-3 py-1.5 rounded-lg transition-all"
                    data-thread-id="${t.id}" data-title="${escHtml(t.title)}">
                <span class="material-symbols-outlined text-sm">check_circle</span>
                Mark Resolved
            </button>` : ''}
        </div>
    </article>`;
}

async function loadLiveStats() {
    const activeTechsEl  = document.getElementById('stat-active-techs');
    const openThreadsEl  = document.getElementById('stat-open-threads');
    try {
        const threads = await Threads.list(null, 200);
        if (!threads) return;
        // Active techs = distinct authors in last 7 days
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const recentAuthors = new Set(
            threads.filter(t => new Date(t.created_at).getTime() > weekAgo).map(t => t.author_id)
        );
        // Open threads = not resolved
        const openCount = threads.filter(t => t.urgency !== 'resolved').length;
        if (activeTechsEl) activeTechsEl.textContent = recentAuthors.size;
        if (openThreadsEl) openThreadsEl.textContent = openCount;
    } catch (e) { /* non-critical */ }
}

async function loadContributors() {
    const listEl = document.getElementById('contributors-list');
    if (!listEl) return;
    try {
        const contributors = await Threads.getContributors(5);
        if (!contributors.length) {
            listEl.innerHTML = '<p class="text-xs text-on-surface-variant italic text-center py-2">No contributions yet.</p>';
            return;
        }
        const pts = (count) => count * 10; // simple scoring
        listEl.innerHTML = contributors.map((c, i) => `
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full ${i === 0 ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-highest text-primary'} flex items-center justify-center text-[10px] font-bold">
                        ${escHtml((c.author_name || '??').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase())}
                    </div>
                    <span class="text-sm font-semibold text-on-surface">${escHtml(c.author_name)}</span>
                </div>
                <span class="text-[10px] font-bold text-on-tertiary-container">${pts(c.count)} pts</span>
            </div>`).join('');
    } catch (e) { /* non-critical */ }
}

// ============================================================
// PROFILE
// ============================================================
async function initProfile() {
    console.log('[S.O.S] Profile init...');
    const authUser = getCurrentAuth();
    const isAdmin = authUser.role === 'admin';

    // ─── 1. LOAD LIVE PROFILE ───
    const profile = await Users.getProfile(authUser.employee_id);
    const user = profile || authUser;

    const nameEl   = document.querySelector('h2.text-xl');
    const roleEl   = document.querySelector('p.text-on-surface-variant.font-medium');
    const idEl     = document.querySelector('.inline-flex.bg-surface-container-high');
    const avatarImg= document.getElementById('profile-avatar');

    if (nameEl) nameEl.textContent = user.full_name || 'Technician';
    if (roleEl) roleEl.textContent = user.title || (user.role === 'admin' ? 'System Administrator' : 'Field Engineer');
    if (idEl)   idEl.textContent   = `ID: ${user.employee_id || 'N/A'}`;
    if (avatarImg && user.avatar_url) avatarImg.src = user.avatar_url;

    // Populate profile switcher menu
    const menuUserEl = document.getElementById('menu-current-user');
    if (menuUserEl) menuUserEl.textContent = `${user.full_name || 'User'} (${user.role || 'technician'})`;

    // ─── 2. ROLE-BASED UI ───
    const adminBadgeContainer = document.getElementById('admin-badge-container');
    const adminControlsSection = document.getElementById('admin-controls-section');
    const securityLogsRow = document.getElementById('security-logs-row');
    const logsBadge = document.getElementById('logs-badge');
    const logsLock = document.getElementById('logs-lock');
    const logsStatus = document.getElementById('logs-status');
    const logsIcon = document.getElementById('logs-icon');

    if (isAdmin) {
        // ── Show admin badge in header ──
        if (adminBadgeContainer) adminBadgeContainer.classList.remove('hidden');

        // ── Reveal admin controls section ──
        if (adminControlsSection) adminControlsSection.classList.remove('hidden');

        // ── Unlock Security Logs row ──
        if (securityLogsRow) {
            if (logsBadge) { logsBadge.textContent = 'UNLOCKED'; logsBadge.className = 'bg-tertiary-fixed-dim text-on-tertiary-fixed-variant text-[9px] font-black uppercase px-2 py-0.5 rounded tracking-tighter'; }
            if (logsLock)  { logsLock.textContent  = 'lock_open'; logsLock.classList.replace('text-error', 'text-secondary'); }
            if (logsStatus) logsStatus.textContent = 'Tap to view audit trail';
            if (logsIcon)   logsIcon.classList.replace('text-outline', 'text-secondary');
            securityLogsRow.addEventListener('click', openLogsModal);
        }

        // ── Broadcast send handler ──
        document.getElementById('broadcast-send')?.addEventListener('click', async () => {
            const msg  = document.getElementById('broadcast-text')?.value.trim();
            const prio = document.getElementById('broadcast-priority')?.value || 'news';
            const successEl = document.getElementById('broadcast-success');
            if (!msg) return;
            try {
                await Announcements.create({ message: msg, criticality: prio });
                await Logs.write('Broadcast announcement sent', 'announcements', msg.slice(0, 80), 'info');
                if (document.getElementById('broadcast-text')) document.getElementById('broadcast-text').value = '';
                if (successEl) {
                    successEl.classList.remove('hidden');
                    setTimeout(() => successEl.classList.add('hidden'), 4000);
                }
            } catch (err) {
                console.error('[S.O.S] Broadcast failed:', err);
            }
        });

        // ── Knowledge Base manager ──
        const kbAddBtn    = document.getElementById('kb-add-btn');
        const kbForm      = document.getElementById('kb-form');
        const kbCancelBtn = document.getElementById('kb-cancel-btn');
        const kbSaveBtn   = document.getElementById('kb-save-btn');
        const kbList      = document.getElementById('kb-list');
        const kbSaveMsg   = document.getElementById('kb-save-msg');

        const kbCategoryLabels = {
            manual: '📘 Manual', service_bulletin: '📋 Bulletin',
            important_date: '📅 Date', procedure: '🔧 Procedure', parts_guide: '🔩 Parts',
        };

        const renderKB = async () => {
            if (!kbList) return;
            try {
                const entries = await KnowledgeBase.list();
                if (!entries || !entries.length) {
                    kbList.innerHTML = '<div class="text-center py-6 text-xs text-on-surface-variant">No entries yet. Add manuals, service dates, or procedures above.</div>';
                    return;
                }
                kbList.innerHTML = entries.map(e => `
                    <div class="flex items-start gap-3 px-4 py-3 hover:bg-surface-container/40 transition-colors">
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="text-[9px] font-black uppercase tracking-tight px-1.5 py-0.5 rounded bg-secondary-container/60 text-secondary">${kbCategoryLabels[e.category] || e.category}</span>
                                ${e.effective_date ? `<span class="text-[9px] text-outline">${e.effective_date}</span>` : ''}
                            </div>
                            <p class="text-xs font-semibold text-on-surface mt-0.5 truncate">${escHtml(e.title)}</p>
                            <p class="text-[10px] text-on-surface-variant line-clamp-2 mt-0.5">${escHtml(e.content.slice(0, 120))}${e.content.length > 120 ? '…' : ''}</p>
                            ${e.tags ? `<p class="text-[9px] text-outline mt-0.5">${escHtml(e.tags)}</p>` : ''}
                        </div>
                        <button class="kb-delete-btn flex-shrink-0 p-1 rounded-lg hover:bg-error-container/50 transition-colors" data-id="${e.id}" data-title="${escHtml(e.title)}">
                            <span class="material-symbols-outlined text-error text-sm">delete</span>
                        </button>
                    </div>`).join('');

                kbList.querySelectorAll('.kb-delete-btn').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const id    = btn.dataset.id;
                        const title = btn.dataset.title;
                        if (!confirm(`Delete "${title}" from knowledge base?`)) return;
                        await KnowledgeBase.remove(id);
                        await Logs.write('KB entry deleted', 'ai', title, 'info');
                        await renderKB();
                    });
                });
            } catch (err) {
                kbList.innerHTML = '<div class="text-center py-4 text-xs text-error">Failed to load knowledge base.</div>';
                console.error('[KB]', err);
            }
        };

        kbAddBtn?.addEventListener('click', () => kbForm?.classList.toggle('hidden'));
        kbCancelBtn?.addEventListener('click', () => kbForm?.classList.add('hidden'));

        kbSaveBtn?.addEventListener('click', async () => {
            const title   = document.getElementById('kb-title')?.value.trim();
            const content = document.getElementById('kb-content')?.value.trim();
            const cat     = document.getElementById('kb-category')?.value;
            const tags    = document.getElementById('kb-tags')?.value.trim();
            const date    = document.getElementById('kb-date')?.value || null;
            if (!title || !content) return;
            try {
                await KnowledgeBase.create({ title, content, category: cat, tags, effectiveDate: date });
                await Logs.write('KB entry added', 'ai', title, 'info');
                ['kb-title','kb-content','kb-tags','kb-date'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
                if (kbSaveMsg) { kbSaveMsg.classList.remove('hidden'); setTimeout(() => kbSaveMsg.classList.add('hidden'), 3000); }
                await renderKB();
            } catch (err) { console.error('[KB save]', err); }
        });

        renderKB();

        // ── System Health Check ──
        document.getElementById('run-health-check')?.addEventListener('click', async () => {
            const btn     = document.getElementById('run-health-check');
            const results = document.getElementById('health-check-results');
            if (!btn || !results) return;
            btn.disabled = true;
            btn.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">refresh</span>Running…';
            results.innerHTML = '';
            results.classList.remove('hidden');

            try {
                const checks = await healthCheck();
                const allOk  = Object.values(checks).every(r => r.ok);
                results.innerHTML = Object.entries(checks).map(([table, r]) => `
                    <div class="flex items-center justify-between text-xs px-1">
                        <span class="font-mono text-on-surface-variant">${table}</span>
                        <span class="${r.ok ? 'text-secondary font-semibold' : 'text-error font-bold'}">
                            ${r.ok ? '✓' : '✗'} ${r.note}
                        </span>
                    </div>`).join('') +
                    `<div class="mt-3 pt-3 border-t border-outline-variant/20 text-center text-xs font-bold ${allOk ? 'text-secondary' : 'text-error'}">
                        ${allOk ? '✅ All systems operational' : '⚠ Some checks failed — see admin for details'}
                    </div>`;
                await Logs.write('Health check run', 'admin', allOk ? 'all OK' : 'failures detected', allOk ? 'info' : 'warning');
            } catch (err) {
                results.innerHTML = `<p class="text-xs text-error font-semibold">Health check failed: ${err.message}</p>`;
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<span class="material-symbols-outlined text-sm">play_circle</span>Run Again';
            }
        });

    } else {
        // ── Normal user: security logs row stays locked (pointer-events:none) ──
        if (securityLogsRow) {
            securityLogsRow.style.cursor = 'not-allowed';
            securityLogsRow.addEventListener('click', (e) => {
                e.preventDefault();
                securityLogsRow.classList.add('shake');
                setTimeout(() => securityLogsRow.classList.remove('shake'), 450);
            });
        }
    }

    // ─── 2b. THEME TOGGLE ───
    const themeToggleBtn  = document.getElementById('theme-toggle-btn');
    const themeToggleKnob = document.getElementById('theme-toggle-knob');
    const themeIcon       = document.getElementById('theme-icon');
    const themeLabel      = document.getElementById('theme-label');

    const applyTheme = (dark) => {
        document.documentElement.classList.toggle('dark', dark);
        if (themeToggleKnob) themeToggleKnob.style.transform = dark ? 'translateX(20px)' : '';
        if (themeToggleBtn)  themeToggleBtn.style.background  = dark ? '#00284d' : '';
        if (themeIcon)  themeIcon.textContent  = dark ? 'light_mode' : 'dark_mode';
        if (themeLabel) themeLabel.textContent = dark ? 'Dark Mode'  : 'Light Mode';
        localStorage.setItem('sos_theme', dark ? 'dark' : 'light');
    };

    const savedTheme = localStorage.getItem('sos_theme');
    applyTheme(savedTheme === 'dark');

    themeToggleBtn?.addEventListener('click', () => {
        applyTheme(!document.documentElement.classList.contains('dark'));
    });

    // ─── 2c. LOGOUT ───
    document.getElementById('btn-logout')?.addEventListener('click', () => {
        localStorage.removeItem('sos_user');
        window.location.href = './index.html';
    });

    // ─── 2d. GEAR BUTTON → QUICK SETTINGS SHEET ───
    const gearBtn       = document.getElementById('settings-gear-btn');
    const sheet         = document.getElementById('settings-sheet');
    const sheetPanel    = document.getElementById('settings-sheet-panel');
    const sheetBackdrop = document.getElementById('settings-sheet-backdrop');
    const sheetClose    = document.getElementById('settings-sheet-close');

    const openSheet = () => {
        if (!sheet || !sheetPanel) return;
        sheet.classList.remove('hidden');
        requestAnimationFrame(() => sheetPanel.classList.remove('translate-y-full'));
        // Sync current font to sheet buttons
        const curFont = localStorage.getItem('sos_font') || 'normal';
        document.querySelectorAll('.font-size-btn').forEach(b => {
            b.classList.toggle('bg-secondary-container/60', b.dataset.font === curFont);
            b.classList.toggle('border-secondary', b.dataset.font === curFont);
        });
        // Sync display name
        const nameInput = document.getElementById('qs-display-name');
        if (nameInput) nameInput.value = user.full_name || '';
        // Sync theme knob in sheet
        const isDark = document.documentElement.classList.contains('dark');
        const qsKnob  = document.getElementById('qs-theme-knob');
        const qsLabel = document.getElementById('qs-theme-label');
        const qsIcon  = document.getElementById('qs-theme-icon');
        if (qsKnob)  qsKnob.style.transform  = isDark ? 'translateX(20px)' : '';
        if (qsLabel) qsLabel.textContent      = isDark ? 'Dark Mode'  : 'Light Mode';
        if (qsIcon)  qsIcon.textContent       = isDark ? 'light_mode' : 'dark_mode';
    };

    const closeSheet = () => {
        if (!sheet || !sheetPanel) return;
        sheetPanel.classList.add('translate-y-full');
        setTimeout(() => sheet.classList.add('hidden'), 300);
    };

    gearBtn?.addEventListener('click', openSheet);
    sheetClose?.addEventListener('click', closeSheet);
    sheetBackdrop?.addEventListener('click', closeSheet);

    // Font size buttons inside the sheet
    document.querySelectorAll('.font-size-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const size = btn.dataset.font;
            localStorage.setItem('sos_font', size);
            document.documentElement.setAttribute('data-font', size);
            document.querySelectorAll('.font-size-btn').forEach(b => {
                b.classList.toggle('bg-secondary-container/60', b.dataset.font === size);
                b.classList.toggle('border-secondary', b.dataset.font === size);
            });
        });
    });

    // Font size buttons in the settings section row (profile page)
    document.querySelectorAll('.font-size-row-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const size = btn.dataset.font;
            localStorage.setItem('sos_font', size);
            document.documentElement.setAttribute('data-font', size);
            const lbl = document.getElementById('font-size-label');
            if (lbl) lbl.textContent = size.charAt(0).toUpperCase() + size.slice(1);
        });
    });
    // Init font-size label
    const initFontLabel = document.getElementById('font-size-label');
    if (initFontLabel) {
        const cur = localStorage.getItem('sos_font') || 'normal';
        initFontLabel.textContent = cur.charAt(0).toUpperCase() + cur.slice(1);
    }

    // Quick-settings theme toggle (in sheet)
    document.getElementById('qs-theme-toggle')?.addEventListener('click', () => {
        const isDark = !document.documentElement.classList.contains('dark');
        document.documentElement.classList.toggle('dark', isDark);
        localStorage.setItem('sos_theme', isDark ? 'dark' : 'light');
        // Sync both toggle knobs
        const syncKnob  = (id) => { const el = document.getElementById(id); if (el) el.style.transform = isDark ? 'translateX(20px)' : ''; };
        const syncLabel = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
        syncKnob('qs-theme-knob');
        syncKnob('theme-toggle-knob');
        syncLabel('qs-theme-label', isDark ? 'Dark Mode' : 'Light Mode');
        syncLabel('theme-label',    isDark ? 'Dark Mode' : 'Light Mode');
        syncLabel('qs-theme-icon',  isDark ? 'light_mode' : 'dark_mode');
        syncLabel('theme-icon',     isDark ? 'light_mode' : 'dark_mode');
        document.getElementById('theme-toggle-btn')?.style && (document.getElementById('theme-toggle-btn').style.background = isDark ? '#00284d' : '');
    });

    // Save display name from sheet
    document.getElementById('qs-save-name')?.addEventListener('click', async () => {
        const val = document.getElementById('qs-display-name')?.value.trim();
        if (!val) return;
        try {
            await Users.updateProfile(user.employee_id, { full_name: val });
            const stored = JSON.parse(localStorage.getItem('sos_user') || '{}');
            stored.full_name = val;
            localStorage.setItem('sos_user', JSON.stringify(stored));
            const nameEl2 = document.getElementById('profile-name');
            if (nameEl2) nameEl2.textContent = val;
            const msg = document.getElementById('qs-name-msg');
            if (msg) { msg.classList.remove('hidden'); setTimeout(() => msg.classList.add('hidden'), 2500); }
            await Logs.write('Display name updated', 'profile', val, 'info');
        } catch (err) { console.error('[QS] name save failed', err); }
    });

    // ─── 3. AVATAR CHANGE ───
    const avatarInput = document.getElementById('avatar-file-input');
    const avatarBadge = document.getElementById('avatar-badge');
    const avatarRing  = document.getElementById('avatar-ring');

    const triggerUpload = () => avatarInput?.click();
    avatarBadge?.addEventListener('click', triggerUpload);
    avatarRing?.addEventListener('click', triggerUpload);

    avatarInput?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // In a real app we'd upload to Supabase Storage. 
        // For this demo, we'll convert to Base64 (data URL) and save to the users table.
        const reader = new FileReader();
        reader.onload = async (ev) => {
            const dataUrl = ev.target.result;
            if (avatarImg) avatarImg.src = dataUrl;
            try {
                await Users.updateProfile(user.employee_id, { avatar_url: dataUrl });
                await Logs.write('Updated profile photo', 'profile');
                // Show toast
                const toast = document.getElementById('upload-toast');
                if (toast) {
                    toast.classList.remove('hidden');
                    setTimeout(() => toast.classList.add('hidden'), 3000);
                }
            } catch (err) {
                console.error('[S.O.S] Avatar update failed:', err);
            }
        };
        reader.readAsDataURL(file);
    });

    // ─── 4. PASSWORD UPDATE ───
    const savePwdBtn = document.getElementById('btn-save-password');
    savePwdBtn?.addEventListener('click', async () => {
        const curr  = document.getElementById('pwd-current')?.value?.trim();
        const nw    = document.getElementById('pwd-new')?.value?.trim();
        const conf  = document.getElementById('pwd-confirm')?.value?.trim();
        const errEl  = document.getElementById('pwd-error');
        const succEl = document.getElementById('pwd-success');

        const showErr = (msg) => {
            if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
        };
        if (errEl)  errEl.classList.add('hidden');
        if (succEl) succEl.classList.add('hidden');

        if (!curr)              return showErr('Please enter your current password.');
        if (!nw)                return showErr('Please enter a new password.');
        if (nw.length < 6)     return showErr('New password must be at least 6 characters.');
        if (nw !== conf)        return showErr('New password and confirmation do not match.');

        try {
            // Verify current password against stored hash before allowing change
            const { hashPassword } = await import('./supabase.js');
            const currHash   = await hashPassword(curr);
            const freshProfile = await Users.getProfile(user.employee_id);
            if (freshProfile?.password && freshProfile.password !== currHash) {
                return showErr('Current password is incorrect.');
            }

            await Users.updatePassword(user.employee_id, nw);
            await Logs.write('Updated account password', 'security', null, 'warning');
            ['pwd-current','pwd-new','pwd-confirm'].forEach(id => {
                const el = document.getElementById(id); if (el) el.value = '';
            });
            if (succEl) { succEl.classList.remove('hidden'); setTimeout(() => succEl.classList.add('hidden'), 3000); }
        } catch (err) {
            showErr('Update failed. Check your connection and try again.');
        }
    });

    // ─── 5. JOB CARD PORTAL (Managed vs Archive) ───
    const manageMonthEl = document.getElementById('manage-month');
    if (manageMonthEl) {
        const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        manageMonthEl.textContent = `${months[new Date().getMonth()]} ${new Date().getFullYear()}`;
    }
    await loadProfileJobCards(user.employee_id);
}

/** Segmented Job Card loading for Profile */
async function loadProfileJobCards(userId) {
    const manageList = document.getElementById('manage-list');
    const archiveList = document.getElementById('archive-list');
    const manageEmpty = document.getElementById('manage-empty');
    const archiveEmpty = document.getElementById('archive-empty');

    const now = new Date();
    const currMonth = now.getMonth();
    const currYear = now.getFullYear();

    try {
        // Managed: Current Month
        const managedJobs = await JobCards.list(null, false, currMonth, currYear);
        // Archive: everything before current month
        const archivedJobs = await JobCards.list(null, false, null, currYear); // Modified list to handle lt boundaries

        renderJobCardSubset(managedJobs, manageList, manageEmpty, 'No active job cards this month.');
        renderJobCardSubset(archivedJobs.filter(j => {
            const d = new Date(j.created_at);
            return d.getMonth() !== currMonth || d.getFullYear() !== currYear;
        }), archiveList, archiveEmpty, 'No archived job cards yet.');

    } catch (err) {
        console.error('[S.O.S] Failed to load job cards:', err);
    }
}

function renderJobCardSubset(jobs, container, emptyEl, emptyMsg) {
    if (!container) return;
    container.innerHTML = '';
    
    if (!jobs || jobs.length === 0) {
        if (emptyEl) {
            emptyEl.classList.remove('hidden');
            const p = emptyEl.querySelector('p.text-sm');
            if (p) p.textContent = emptyMsg;
        }
        return;
    }
    
    if (emptyEl) emptyEl.classList.add('hidden');
    
    container.innerHTML = jobs.map((job, idx) => `
        <div class="job-card-item bg-surface-container-lowest rounded-xl p-4 border border-outline-variant/15 hover:bg-surface-container-high transition-colors"
             style="animation-delay: ${idx * 0.05}s">
            <div class="flex items-start justify-between gap-3">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1">
                        <span class="material-symbols-outlined text-secondary text-sm" style="font-variation-settings:'FILL' 1">assignment</span>
                        <span class="text-sm font-bold text-on-surface truncate">${escHtml(job.facility)}</span>
                    </div>
                    <p class="text-xs text-on-surface-variant">Machine: <strong>${escHtml(job.machine_model || '—')}</strong></p>
                    <p class="text-xs text-on-surface-variant truncate">Serial: <strong>${escHtml(job.serial_number || '—')}</strong></p>
                </div>
                <div class="flex flex-col items-end gap-2 flex-shrink-0">
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tighter bg-tertiary-fixed-dim text-on-tertiary-fixed-variant">
                        <span class="material-symbols-outlined text-[9px]" style="font-variation-settings:'FILL' 1">check_circle</span>
                        ${escHtml(job.status)}
                    </span>
                    <span class="text-[10px] text-on-surface-variant font-medium">${formatDisplayDate(job.created_at)}</span>
                </div>
            </div>
            <div class="mt-3 pt-3 border-t border-outline-variant/10 flex justify-end">
                <button onclick="printJob('${job.id}')" class="text-[10px] text-secondary font-bold uppercase flex items-center gap-1 hover:underline active:scale-95 transition-transform">
                    <span class="material-symbols-outlined text-sm">picture_as_pdf</span>
                    Generate Report
                </button>
            </div>
        </div>
    `).join('');
}

// ============================================================
// AI ASSISTANT
// ============================================================
function initAIAssistant() {
    const fabBtn    = document.getElementById('ai-fab-btn');
    const chatPanel = document.getElementById('ai-chat-panel');
    const fabIcon   = document.getElementById('ai-fab-icon');
    const closeBtn  = document.getElementById('ai-close-btn');
    const sendBtn   = document.getElementById('ai-send-btn');
    const aiInput   = document.getElementById('ai-input');
    const imgBtn    = document.getElementById('ai-img-btn');
    const imgInput  = document.getElementById('ai-img-input');
    const imgPreview= document.getElementById('ai-img-preview');

    if (!fabBtn || !chatPanel) return;

    let open           = false;
    let pendingImageB64= null;   // base64 data URL of staged image

    // ── Panel toggle ──────────────────────────────────────────
    const togglePanel = () => {
        open = !open;
        if (open) {
            chatPanel.classList.remove('hidden');
            chatPanel.classList.add('flex');
            if (fabIcon) fabIcon.textContent = 'close';
        } else {
            chatPanel.classList.add('hidden');
            chatPanel.classList.remove('flex');
            if (fabIcon) fabIcon.textContent = 'smart_toy';
        }
    };
    fabBtn .addEventListener('click', togglePanel);
    closeBtn?.addEventListener('click', () => { open = true; togglePanel(); });

    // ── Image staging ─────────────────────────────────────────
    imgBtn?.addEventListener('click', () => imgInput?.click());
    imgInput?.addEventListener('change', () => {
        const file = imgInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
            pendingImageB64 = e.target.result;
            if (imgPreview) {
                imgPreview.innerHTML = `
                    <div class="relative inline-block">
                        <img src="${pendingImageB64}" class="h-14 w-14 object-cover rounded-lg border border-outline-variant/30"/>
                        <button id="ai-img-clear" class="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-error text-white flex items-center justify-center text-[9px] font-black leading-none">✕</button>
                    </div>`;
                imgPreview.classList.remove('hidden');
                document.getElementById('ai-img-clear')?.addEventListener('click', clearImage);
            }
        };
        reader.readAsDataURL(file);
        imgInput.value = '';
    });

    const clearImage = () => {
        pendingImageB64 = null;
        if (imgPreview) { imgPreview.innerHTML = ''; imgPreview.classList.add('hidden'); }
    };

    // ── Main send handler ─────────────────────────────────────
    const doSend = async () => {
        const val = aiInput?.value.trim();
        if (!val && !pendingImageB64) return;

        const userText = val || '(analysing image)';
        aiInput.value  = '';
        document.getElementById('ai-suggestions')?.classList.add('hidden');

        // Show user message (with thumbnail if image)
        aiAddMessage(userText, true, pendingImageB64);
        const imageB64  = pendingImageB64;
        clearImage();

        // Typing indicator
        const typingId = aiAddTyping();

        try {
            const me = getCurrentAuth();

            // 1. Gather live Supabase context
            const [active, completed, parts, notices] = await Promise.allSettled([
                JobCards.list('active',    false),
                JobCards.list('completed', false),
                Parts.list(),
                Announcements.list(3),
            ]);
            const activeJobs    = active.status    === 'fulfilled' ? (active.value    || []) : [];
            const completedJobs = completed.status === 'fulfilled' ? (completed.value || []) : [];
            const partsList     = parts.status     === 'fulfilled' ? (parts.value     || []) : [];
            const noticesList   = notices.status   === 'fulfilled' ? (notices.value   || []) : [];

            const now = new Date();
            const todayDone = completedJobs.filter(j => {
                const d = new Date(j.created_at);
                return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
            }).length;

            const liveContext = [
                `Technician: ${me.full_name} (${me.role}), ID: ${me.employee_id}`,
                `Active jobs: ${activeJobs.length}${activeJobs[0] ? ` — latest at "${activeJobs[0].facility}" (${activeJobs[0].machine_model})` : ''}`,
                `Jobs completed today: ${todayDone} | this month: ${completedJobs.length}`,
                `Part requests: ${partsList.length} total (${partsList.filter(p=>p.status==='PENDING').length} pending, ${partsList.filter(p=>p.status==='APPROVED').length} approved, ${partsList.filter(p=>p.status==='RECEIVED').length} received)`,
                noticesList[0] ? `Latest announcement: "${noticesList[0].message.slice(0,100)}"` : 'No recent announcements',
            ].join('\n');

            // 2. Search knowledge base for relevant entries
            let knowledgeContext = '';
            try {
                const kbResults = await KnowledgeBase.search(val || 'general');
                if (kbResults.length) {
                    knowledgeContext = kbResults.slice(0, 4).map(e =>
                        `[${e.category.toUpperCase()}] ${e.title}${e.effective_date ? ` (${e.effective_date})` : ''}:\n${e.content}`
                    ).join('\n\n');
                }
            } catch { /* kb search failure is non-fatal */ }

            // 3. Call Claude
            const reply = await callAI(
                imageB64 ? `${userText}\n\nPlease analyse the attached image and help me diagnose any faults or issues you can see.` : userText,
                imageB64,
                knowledgeContext,
                liveContext
            );

            aiRemoveTyping(typingId);
            aiAddMessage(reply, false);

            // Log AI usage
            Logs.write(`AI assistant query`, 'ai', userText.slice(0, 80), 'info').catch(() => {});

        } catch (err) {
            aiRemoveTyping(typingId);
            console.error('[AI]', err);
            const errText = String(err);
            let friendlyMsg = 'I had trouble reaching the AI. Please check your connection.';
            if (errText.includes('credit') || errText.includes('billing') || errText.includes('quota'))
                friendlyMsg = 'The AI service needs credits. Ask your admin to top up the Anthropic or Groq account.';
            else if (errText.includes('401') || errText.includes('api-key') || errText.includes('authentication'))
                friendlyMsg = 'AI authentication failed — the API key may be invalid. Contact your administrator.';
            else if (errText.includes('Failed to fetch') || errText.includes('NetworkError'))
                friendlyMsg = 'Cannot reach the AI — check your internet connection and try again.';
            aiAddMessage(friendlyMsg, false);
        }
    };

    sendBtn?.addEventListener('click', doSend);
    aiInput?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) doSend(); });
}

function aiAddTyping() {
    const msgBox = document.getElementById('ai-messages');
    if (!msgBox) return null;
    const id = `typing-${Date.now()}`;
    const wrapper = document.createElement('div');
    wrapper.className = 'flex items-start gap-2';
    wrapper.id = id;
    wrapper.innerHTML = `
        <div class="w-6 h-6 rounded-full bg-primary-container flex items-center justify-center flex-shrink-0 mt-0.5">
            <span class="material-symbols-outlined text-[#4bd9e5] text-xs" style="font-variation-settings:'FILL' 1">smart_toy</span>
        </div>
        <div class="bg-surface-container text-on-surface-variant text-xs rounded-2xl rounded-tl-sm px-3 py-2 leading-relaxed shadow-sm flex gap-1 items-center">
            <span class="w-1.5 h-1.5 rounded-full bg-secondary animate-bounce" style="animation-delay:0ms"></span>
            <span class="w-1.5 h-1.5 rounded-full bg-secondary animate-bounce" style="animation-delay:150ms"></span>
            <span class="w-1.5 h-1.5 rounded-full bg-secondary animate-bounce" style="animation-delay:300ms"></span>
        </div>`;
    msgBox.appendChild(wrapper);
    msgBox.scrollTop = msgBox.scrollHeight;
    return id;
}

function aiRemoveTyping(id) {
    if (id) document.getElementById(id)?.remove();
}

function aiAddMessage(text, isUser, imageB64 = null) {
    const msgBox = document.getElementById('ai-messages');
    if (!msgBox) return;
    const wrapper = document.createElement('div');
    wrapper.className = `flex items-start gap-2 ${isUser ? 'flex-row-reverse' : ''}`;

    const bubble = document.createElement('div');
    bubble.className = isUser
        ? 'bg-primary-container text-on-surface text-xs rounded-2xl rounded-tr-sm px-3 py-2 max-w-[85%] leading-relaxed shadow-sm space-y-1.5'
        : 'bg-surface-container text-on-surface text-xs rounded-2xl rounded-tl-sm px-3 py-2 max-w-[85%] leading-relaxed shadow-sm whitespace-pre-wrap';

    if (imageB64 && isUser) {
        const img = document.createElement('img');
        img.src = imageB64;
        img.className = 'h-24 w-full object-cover rounded-lg';
        bubble.appendChild(img);
    }

    const textNode = document.createElement('span');
    textNode.textContent = text;
    bubble.appendChild(textNode);

    wrapper.appendChild(bubble);
    msgBox.appendChild(wrapper);
    msgBox.scrollTop = msgBox.scrollHeight;
}

// Global: called from inline onclick in dashboard.html and profile.html
function aiSendSuggestion(text) {
    const aiInput = document.getElementById('ai-input');
    if (aiInput) aiInput.value = text;
    document.getElementById('ai-send-btn')?.click();
}

/** Global: View switcher for Job Card Portal */
function switchJobTab(type) {
    const manageBtn = document.getElementById('tab-manage');
    const archiveBtn = document.getElementById('tab-archive');
    const managePanel = document.getElementById('panel-manage');
    const archivePanel = document.getElementById('panel-archive');

    if (type === 'manage') {
        manageBtn?.classList.add('bg-surface-container-lowest', 'text-on-surface', 'shadow-sm');
        manageBtn?.classList.remove('text-on-surface-variant');
        archiveBtn?.classList.remove('bg-surface-container-lowest', 'text-on-surface', 'shadow-sm');
        archiveBtn?.classList.add('text-on-surface-variant');
        managePanel?.classList.remove('hidden');
        archivePanel?.classList.add('hidden');
    } else {
        archiveBtn?.classList.add('bg-surface-container-lowest', 'text-on-surface', 'shadow-sm');
        archiveBtn?.classList.remove('text-on-surface-variant');
        manageBtn?.classList.remove('bg-surface-container-lowest', 'text-on-surface', 'shadow-sm');
        manageBtn?.classList.add('text-on-surface-variant');
        archivePanel?.classList.remove('hidden');
        managePanel?.classList.add('hidden');
    }
}

/** Global: Security Logs Modal Trigger */
async function openLogsModal() {
    const modal = document.getElementById('logs-modal');
    const content = document.getElementById('logs-content');
    const list = document.getElementById('logs-list-container');
    
    if (!modal || !list) return;

    // Loading state
    list.innerHTML = `<div class="p-8 text-center animate-pulse"><span class="material-symbols-outlined text-outline text-4xl mb-2">security</span><p class="text-xs text-on-surface-variant italic">Decrypting security logs...</p></div>`;
    
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0', 'pointer-events-none');
        content?.classList.remove('translate-y-full', 'sm:scale-95');
    });

    try {
        const logs = await Logs.list(50, true);
        if (!logs || !logs.length) {
            list.innerHTML = `<p class="text-center text-xs text-on-surface-variant py-8 italic">No security events found.</p>`;
            return;
        }

        list.innerHTML = logs.map(log => `
            <div class="bg-surface-container p-3 rounded-xl border-l-2 ${log.severity === 'warning' ? 'border-error' : 'border-secondary'} flex items-start gap-3">
                <span class="material-symbols-outlined text-lg ${log.severity === 'warning' ? 'text-error' : 'text-secondary'} mt-0.5">
                    ${log.category === 'auth' ? 'person_pin' : log.category === 'security' ? 'policy' : 'info'}
                </span>
                <div class="flex-1">
                    <div class="flex items-center justify-between mb-0.5">
                        <span class="text-[11px] font-bold text-on-surface">${escHtml(log.user_name)}</span>
                        <span class="text-[9px] text-on-surface-variant opacity-60">${formatRelativeTime(log.created_at)}</span>
                    </div>
                    <p class="text-[10px] text-on-surface-variant leading-tight mb-1">${escHtml(log.action)}</p>
                    ${log.detail ? `<p class="text-[9px] bg-surface-container-lowest px-2 py-1 rounded border border-outline-variant/10 text-on-surface-variant/80 italic">${escHtml(log.detail)}</p>` : ''}
                </div>
            </div>
        `).join('');
    } catch (err) {
        list.innerHTML = `<p class="text-center text-xs text-error py-8">Failed to decrypt logs: ${err.message}</p>`;
    }
}

/** Global: PDF Report Generator for a Job Card */
async function printJob(jobId) {
    // In a real app we'd fetch the specific ID. 
    // For this context, we'll try to find it in the current view or fetch it.
    try {
        const jobs = await JobCards.list(null, true);
        const job = jobs.find(j => j.id === jobId || String(j.id) === String(jobId));
        if (!job) return;

        const win = window.open('', '_blank');
        win.document.write(`
            <html><head><title>Job Card — ${escHtml(job.facility)}</title>
            <style>
                body { font-family: 'Inter', sans-serif; padding: 40px; color: #001c39; }
                .header { border-bottom: 2px solid #00284d; padding-bottom: 20px; margin-bottom: 30px; }
                h1 { margin: 0; color: #00132a; font-size: 24px; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #c3c6cf; padding: 12px; text-align: left; font-size: 13px; }
                th { background: #e6eeff; color: #366287; text-transform: uppercase; font-size: 11px; }
                .footer { margin-top: 40px; font-size: 10px; color: #73777f; text-align: center; }
            </style></head><body>
            <div class="header">
                <h1>2nd Opinion Systems — Service Report</h1>
                <p>Digital Job Card #${job.id}</p>
            </div>
            <table>
                <tr><th>Facility</th><td>${escHtml(job.facility)}</td></tr>
                <tr><th>Date</th><td>${formatDisplayDate(job.created_at)}</td></tr>
                <tr><th>Technician</th><td>${escHtml(job.technician_name)}</td></tr>
                <tr><th>Machine</th><td>${escHtml(job.machine_model)}</td></tr>
                <tr><th>Serial</th><td>${escHtml(job.serial_number)}</td></tr>
                <tr><th>Fault</th><td>${escHtml(job.fault_description)}</td></tr>
                <tr><th>Work Done</th><td>${escHtml(job.work_performed)}</td></tr>
                <tr><th>Parts</th><td>${escHtml(job.parts_used || 'None')}</td></tr>
            </table>
            <div class="footer">Generated by S.O.S. Field Operations Portal</div>
            </body></html>
        `);
        win.document.close();
        win.print();
    } catch (err) {
        console.error('[S.O.S] Print failed:', err);
    }
}

// ============================================================
// UTILITIES
// ============================================================
function getPriorityBorder(urgency) {
    const u = (urgency || '').toUpperCase();
    if (u === 'CRITICAL' || u === 'URGENT' || u === 'EMERGENCY') return 'border-error';
    if (u === 'HIGH') return 'border-secondary';
    return 'border-tertiary';
}

function getPriorityBadgeClass(urgency) {
    const u = (urgency || '').toUpperCase();
    if (u === 'CRITICAL' || u === 'URGENT' || u === 'EMERGENCY') return 'bg-error-container text-on-error-container';
    if (u === 'HIGH') return 'bg-secondary-container text-on-secondary-container';
    return 'bg-surface-container-high text-on-surface-variant';
}

function formatRelativeTime(dateStr) {
    if (!dateStr) return '';
    const diffMin = Math.round((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (diffMin < 1)  return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHrs = Math.round(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return new Date(dateStr).toLocaleDateString();
}

function formatDisplayDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }) + ', ' +
           d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function skeletonCards(n) {
    return Array(n).fill(`
        <div class="bg-surface-container-lowest p-6 rounded-xl border-l-4 border-outline-variant/20 shadow-sm animate-pulse">
            <div class="h-4 bg-outline-variant/30 rounded w-2/3 mb-4"></div>
            <div class="h-3 bg-outline-variant/20 rounded w-1/2 mb-6"></div>
            <div class="h-8 bg-outline-variant/20 rounded w-1/3 ml-auto"></div>
        </div>`).join('');
}

function skeletonRows(n) {
    return Array(n).fill(`
        <tr class="animate-pulse">
            <td class="px-6 py-4"><div class="h-3 bg-outline-variant/30 rounded w-3/4"></div></td>
            <td class="px-6 py-4"><div class="h-3 bg-outline-variant/20 rounded w-1/2"></div></td>
            <td class="px-6 py-4"><div class="h-3 bg-outline-variant/20 rounded w-1/4"></div></td>
            <td class="px-6 py-4 text-right"><div class="h-3 bg-outline-variant/20 rounded w-1/3 ml-auto"></div></td>
        </tr>`).join('');
}
