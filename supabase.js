/**
 * S.O.S. — Supabase Client & Data Layer
 * All database interactions go through this module.
 *
 * @typedef {{ id:string, technician_id:string, technician_name:string, facility:string,
 *             machine_model:string, serial_number:string, fault_description:string,
 *             work_performed:string, parts_used:string, status:'active'|'completed'|'draft',
 *             signature_data:string|null, created_at:string }} JobCard
 *
 * @typedef {{ id:string, requested_by:string, technician_name:string, part_name:string,
 *             urgency:'NORMAL'|'URGENT'|'CRITICAL', quantity:number,
 *             status:'PENDING'|'APPROVED'|'RECEIVED', created_at:string }} Part
 *
 * @typedef {{ id:string, employee_id:string, username:string, full_name:string,
 *             role:'technician'|'admin', title:string, avatar_url:string|null,
 *             is_active:boolean }} SosUser
 *
 * @typedef {{ id:string, sender_name:string, message:string,
 *             criticality:'news'|'urgent'|'critical', created_at:string }} Announcement
 *
 * @typedef {{ id:string, author_name:string, category:string, title:string,
 *             body:string, urgency:'normal'|'urgent'|'resolved',
 *             helpful_count:number, created_at:string }} Thread
 *
 * @typedef {{ id:string, title:string, category:string, content:string,
 *             tags:string|null, effective_date:string|null }} KBEntry
 */

const SUPABASE_URL = 'https://ktkczqvxoifzosmkaoco.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0a2N6cXZ4b2lmem9zbWthb2NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxODcyNDgsImV4cCI6MjA4OTc2MzI0OH0.m5B30L1SiOhlnifRNaKvLP_JEaqy65zGLBM_Nft2bl8';

/**
 * Core fetch wrapper for Supabase REST API
 */
async function sbFetch(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || 'return=representation',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('[Supabase]', res.status, err);
    throw new Error(err);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ============================================================
// AUTH IDENTITY GETTER
// ============================================================
export function getCurrentAuth() {
  try {
    const userStr = localStorage.getItem('sos_user');
    if (userStr) return JSON.parse(userStr);
  } catch (e) {}
  return { employee_id: 'UNKNOWN', full_name: 'Anonymous', role: 'technician' };
}

// ============================================================
// JOB CARDS
// ============================================================
export const JobCards = {
  /** Insert a new job card. Returns the saved row. */
  async create(data) {
    const user = getCurrentAuth();
    return sbFetch('job_cards', {
      method: 'POST',
      body: JSON.stringify({
        technician_id:   data.technicianId   || user.employee_id,
        technician_name: data.technicianName || user.full_name,
        facility:        data.facility,
        machine_model:   data.machine,
        serial_number:   data.serial,
        fault_description: data.faultDescription,
        work_performed:  data.workPerformed,
        parts_used:      data.partsUsed,
        signature_data:  data.signatureData  || null,
        status:          data.status || 'completed',
      }),
    });
  },

  /** Save a draft job card */
  async saveDraft(data) {
    return sbFetch('job_cards', {
      method: 'POST',
      body: JSON.stringify({ ...data, status: 'draft' }),
    });
  },

  /** Fetch job cards (filtered by user unless admin, or if global flag is set) */
  async list(status = null, global = false, month = null, year = null) {
    let path = 'job_cards?order=created_at.desc';
    if (status) path += `&status=eq.${status}`;
    
    // Add month/year filtering if provided
    if (month !== null && year !== null) {
      // Create date boundaries (YYYY-MM-01 to YYYY-MM-lastday)
      const startDate = new Date(year, month, 1).toISOString();
      const endDate = new Date(year, month + 1, 0, 23, 59, 59).toISOString();
      path += `&created_at=gte.${startDate}&created_at=lte.${endDate}`;
    } else if (year !== null) {
      // Just year filtering (archive)
      path += `&created_at=lt.${new Date(year, month || 0, 1).toISOString()}`;
    }
    
    const user = getCurrentAuth();
    // global=true is an explicit opt-in (e.g. admin oversight views, printJob).
    // global=false (default) always scopes to the current user regardless of role.
    if (!global) {
      path += `&technician_id=eq.${encodeURIComponent(user.employee_id)}`;
    }

    return sbFetch(path, { prefer: 'return=representation' });
  },

  /** Update status of a job card by ID */
  async updateStatus(id, status) {
    return sbFetch(`job_cards?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
    });
  },
};

// ============================================================
// PARTS
// ============================================================
export const Parts = {
  /** Request a part */
  async create(data) {
    const user = getCurrentAuth();
    return sbFetch('parts', {
      method: 'POST',
      body: JSON.stringify({
        requested_by:    data.requestedBy    || user.employee_id,
        technician_name: data.technicianName || user.full_name,
        part_name:       data.partName,
        urgency:         data.urgency        || 'NORMAL',
        quantity:        data.quantity       || 1,
        notes:           data.notes          || null,
        status:          'PENDING',
      }),
    });
  },

  /** List parts (filtered by user unless admin) */
  async list(status = null) {
    let path = 'parts?order=created_at.desc';
    if (status) path += `&status=eq.${status}`;
    
    const user = getCurrentAuth();
    if (user.role !== 'admin') {
      path += `&requested_by=eq.${encodeURIComponent(user.employee_id)}`;
    }
    
    return sbFetch(path);
  },

  /** Update a part's status (PENDING → APPROVED → RECEIVED) */
  async updateStatus(id, status) {
    return sbFetch(`parts?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
    });
  },
};

// ============================================================
// LOGS
// ============================================================
export const Logs = {
  /** Write an audit log entry */
  async write(action, category = 'general', detail = null, severity = 'info') {
    const user = getCurrentAuth();
    return sbFetch('logs', {
      method: 'POST',
      body: JSON.stringify({
        user_id:   user.employee_id,
        user_name: user.full_name,
        action,
        category,
        detail,
        severity,
      }),
    });
  },

  /** Fetch recent logs (filtered by user unless admin, or if global flag is set) */
  async list(limit = 50, global = false) {
    let path = `logs?order=created_at.desc&limit=${limit}`;
    const user = getCurrentAuth();
    if (user.role !== 'admin' && !global) {
      path += `&user_id=eq.${encodeURIComponent(user.employee_id)}`;
    }
    return sbFetch(path);
  },
};

// ============================================================
// PERFORMANCE & STATISTICS
// ============================================================
export const PerformanceStats = {
  /** Upsert a performance record for a given period */
  async upsert(data) {
    const user = getCurrentAuth();
    return sbFetch('performance', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        period_start:      data.periodStart,
        period_end:        data.periodEnd,
        technician_id:     data.technicianId   || user.employee_id,
        technician_name:   data.technicianName || user.full_name,
        jobs_completed:    data.jobsCompleted  || 0,
        jobs_total:        data.jobsTotal      || 0,
        avg_resolution_hrs: data.avgResolutionHrs || null,
        sla_percentage:    data.slaPercentage  || null,
        travel_hrs:        data.travelHrs      || null,
        parts_requested:   data.partsRequested || 0,
        parts_received:    data.partsReceived  || 0,
        notes:             data.notes          || null,
      }),
    });
  },

  /** Fetch performance history for a technician (admin can fetch anything, tech defaults to own) */
  async list(technicianId = null) {
    const user = getCurrentAuth();
    const targetId = technicianId || user.employee_id;
    return sbFetch(`performance?technician_id=eq.${encodeURIComponent(targetId)}&order=period_start.desc`);
  },
};

// ============================================================
// ANNOUNCEMENTS
// ============================================================
export const Announcements = {
  /** Create a new broadcast announcement */
  async create(data) {
    const user = getCurrentAuth();
    return sbFetch('announcements', {
      method: 'POST',
      body: JSON.stringify({
        sender_id:    data.senderId  || user.employee_id || 'admin',
        sender_name:  data.senderName  || user.full_name  || 'Administrator',
        sender_title: data.senderTitle || user.title      || 'Official',
        message:      data.message,
        criticality:  data.criticality || 'news',
        expires_at:   data.expires_at  || null,
      }),
    });
  },

  /** List all active announcements, most recent first */
  async list(limit = 20) {
    return sbFetch(`announcements?order=created_at.desc&limit=${limit}`);
  },
};

// ============================================================
// SUPABASE REALTIME — Announcements live feed
// ============================================================
/**
 * Opens a Supabase Realtime WebSocket and calls `onNew(row)` whenever
 * a new announcement is inserted. Returns an unsubscribe function.
 * @param {function(object): void} onNew
 * @returns {function} unsubscribe
 */
export function subscribeAnnouncements(onNew) {
  const wsUrl = SUPABASE_URL.replace('https://', 'wss://') +
    `/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=1.0.0`;

  const ws = new WebSocket(wsUrl);
  let heartbeat;

  ws.addEventListener('open', () => {
    // Join the postgres_changes channel for INSERT on announcements
    ws.send(JSON.stringify({
      topic: 'realtime:public:announcements',
      event: 'phx_join',
      payload: {
        config: {
          broadcast:       { ack: false },
          presence:        { key: '' },
          postgres_changes: [{ event: 'INSERT', schema: 'public', table: 'announcements' }],
        },
      },
      ref: '1',
    }));
    // Keep-alive heartbeat every 25s
    heartbeat = setInterval(() => {
      ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: null }));
    }, 25_000);
  });

  ws.addEventListener('message', (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.event === 'postgres_changes' && msg.payload?.data?.record) {
        onNew(msg.payload.data.record);
      }
    } catch (_) { /* ignore malformed frames */ }
  });

  ws.addEventListener('error', (e) => console.warn('[S.O.S] Realtime WS error:', e));

  return function unsubscribe() {
    clearInterval(heartbeat);
    ws.close();
  };
}

// ============================================================
// USERS & PROFILE
// ============================================================
export const Users = {
  /** Get full profile for a user */
  async getProfile(userId) {
    const data = await sbFetch(`users?employee_id=eq.${encodeURIComponent(userId)}&limit=1`);
    return data && data.length ? data[0] : null;
  },

  /** Update user profile (avatar, etc.) */
  async updateProfile(userId, data) {
    return sbFetch(`users?employee_id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  /** Update user password — always stores as SHA-256 hash */
  async updatePassword(userId, newPassword) {
    const hash = await hashPassword(newPassword);
    return sbFetch(`users?employee_id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ password: hash }),
    });
  },
};

// ============================================================
// THREADS (Discussion / Collaboration Hub)
// ============================================================
export const Threads = {
  /** Create a new thread post */
  async create(data) {
    const user = getCurrentAuth();
    return sbFetch('threads', {
      method: 'POST',
      body: JSON.stringify({
        author_id:       data.authorId   || user.employee_id,
        author_name:     data.authorName || user.full_name || 'Technician',
        category:        data.category,
        title:           data.title,
        body:            data.body,
        urgency:         data.urgency || 'normal',
        attachment_urls: data.attachmentUrls || null,
      }),
    });
  },

  /** List threads, optionally filtered by category */
  async list(category = null, limit = 30) {
    let path = `threads?order=created_at.desc&limit=${limit}`;
    if (category) path += `&category=eq.${encodeURIComponent(category)}`;
    return sbFetch(path);
  },

  /** Increment the helpful count on a thread */
  async markHelpful(id, currentCount) {
    return sbFetch(`threads?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ helpful_count: (currentCount || 0) + 1 }),
    });
  },

  /** Mark a thread as resolved */
  async resolve(id) {
    return sbFetch(`threads?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ urgency: 'resolved', updated_at: new Date().toISOString() }),
    });
  },

  /** Get contributor stats — returns array of {author_id, author_name, count} */
  async getContributors(limit = 5) {
    const data = await sbFetch('threads?select=author_id,author_name&limit=200');
    if (!data || !data.length) return [];
    const tally = {};
    data.forEach(t => {
      const key = t.author_id;
      if (!tally[key]) tally[key] = { author_id: key, author_name: t.author_name, count: 0 };
      tally[key].count++;
    });
    return Object.values(tally)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  },
};

// ============================================================
// PASSWORD HASHING  (Web Crypto API — SHA-256)
// ============================================================
/**
 * Returns a hex SHA-256 digest of "sos_v1_<plain>".
 * Used for client-side password hashing before storing/comparing.
 */
export async function hashPassword(plain) {
  const encoded = new TextEncoder().encode('sos_v1_' + plain);
  const buffer  = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Returns true if the stored value looks like one of our SHA-256 hashes */
export function isHashed(stored) {
  return typeof stored === 'string' && stored.length === 64 && /^[0-9a-f]+$/.test(stored);
}

// ============================================================
// KNOWLEDGE BASE (AI Reference Material)
// ============================================================
export const KnowledgeBase = {
  /** Add a new knowledge entry */
  async create(data) {
    const user = getCurrentAuth();
    return sbFetch('knowledge_base', {
      method: 'POST',
      body: JSON.stringify({
        title:          data.title,
        category:       data.category,
        content:        data.content,
        tags:           data.tags           || null,
        effective_date: data.effectiveDate  || null,
        added_by:       user.employee_id,
      }),
    });
  },

  /** List all entries, optionally filtered by category */
  async list(category = null) {
    let path = 'knowledge_base?order=created_at.desc';
    if (category) path += `&category=eq.${encodeURIComponent(category)}`;
    return sbFetch(path);
  },

  /** Search knowledge base entries by keyword (client-side filter) */
  async search(query) {
    const all = await sbFetch('knowledge_base?order=created_at.desc');
    if (!all || !query) return all || [];
    const q = query.toLowerCase();
    return all.filter(e =>
      e.title.toLowerCase().includes(q) ||
      e.content.toLowerCase().includes(q) ||
      (e.tags && e.tags.toLowerCase().includes(q))
    );
  },

  /** Delete an entry by ID */
  async remove(id) {
    return sbFetch(`knowledge_base?id=eq.${id}`, { method: 'DELETE', prefer: '' });
  },
};

// ============================================================
// AI ASSISTANT — Claude API proxy via Vite dev server
// ============================================================
/**
 * Call Claude claude-sonnet-4-6 with optional image and knowledge context.
 * Routed through /api/claude → Vite proxy → api.anthropic.com
 */
export async function callAI(message, imageBase64 = null, knowledgeContext = '', liveContext = '') {
  const userContent = [];

  if (imageBase64) {
    const mimeMatch = imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,/);
    const mediaType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    userContent.push({
      type: 'image',
      source: {
        type:       'base64',
        media_type: mediaType,
        data:       imageBase64.replace(/^data:image\/[a-zA-Z+]+;base64,/, ''),
      },
    });
  }

  userContent.push({ type: 'text', text: message });

  const systemPrompt = [
    'You are an expert field service technician assistant for S.O.S. (Service Operations System).',
    'You help technicians diagnose equipment faults, interpret error codes, and recommend step-by-step repairs.',
    'Be concise, practical, and use technical language appropriate for field engineers.',
    'When analysing a photo, describe exactly what you see, identify any visible damage or fault indicators, and give actionable next steps.',
    knowledgeContext ? `\n## Company Knowledge Base\n${knowledgeContext}` : '',
    liveContext     ? `\n## Live System Context\n${liveContext}`          : '',
  ].filter(Boolean).join('\n');

  // In dev: Vite proxy rewrites /api/claude → api.anthropic.com (key from .env)
  // In production: Netlify redirects /api/claude → /.netlify/functions/claude (key from env var)
  const res = await fetch('/api/claude/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 1024,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[AI]', res.status, err);
    throw new Error(err);
  }

  const data = await res.json();
  return data.content?.[0]?.text || 'No response from AI.';
}

// ============================================================
// Convenience: sync localStorage completedJobs → Supabase
// ============================================================
export async function syncLocalJobsToSupabase() {
  const jobs = JSON.parse(localStorage.getItem('completedJobs') || '[]');
  if (!jobs.length) return;
  for (const job of jobs) {
    try {
      await JobCards.create({
        facility:         job.facility,
        machine:          job.machine,
        serial:           job.serial,
        faultDescription: job.faultService,
        workPerformed:    job.workPerformed,
        partsUsed:        job.partsUsed,
        status:           job.status === 'Completed' ? 'completed' : 'active',
      });
    } catch (e) { /* skip duplicates */ }
  }
  await Logs.write('Local job cards synced to Supabase', 'job_card', `${jobs.length} records`, 'info');
}

// ============================================================
// Convenience: sync localStorage partRequests → Supabase
// ============================================================
export async function syncLocalPartsToSupabase() {
  const parts = JSON.parse(localStorage.getItem('partRequests') || '[]');
  if (!parts.length) return;
  for (const p of parts) {
    try {
      await Parts.create({
        partName: p.name || p.partName,
        urgency:  p.urgency,
        status:   p.status,
      });
    } catch (e) { /* skip */ }
  }
  await Logs.write('Local part requests synced to Supabase', 'parts', `${parts.length} records`, 'info');
}

// ============================================================
// HEALTH CHECK — validates every table is reachable
// ============================================================
/**
 * Pings each Supabase table and returns a status map.
 * @returns {Promise<Record<string,{ok:boolean,status:number,note:string}>>}
 */
export async function healthCheck() {
  const tables = ['users', 'job_cards', 'parts', 'logs', 'announcements', 'threads', 'knowledge_base', 'performance'];
  const results = {};

  await Promise.all(tables.map(async table => {
    const start = Date.now();
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?limit=1`, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      });
      const ms = Date.now() - start;
      results[table] = {
        ok:     res.ok,
        status: res.status,
        ms,
        note:   res.ok ? `OK (${ms}ms)` : `HTTP ${res.status}`,
      };
    } catch (err) {
      results[table] = { ok: false, status: 0, ms: 0, note: `Network error: ${err.message}` };
    }
  }));

  return results;
}
