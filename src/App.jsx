import { DiscordSDK } from '@discord/embedded-app-sdk';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

// ─── Spinner keyframes ─────────────────────────────────────────────────
const spinnerStyle = document.createElement('style');
spinnerStyle.textContent = `@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`;
document.head.appendChild(spinnerStyle);

// ─── Client API proxy ──────────────────────────────────────────────────
const db = {
  async select(table, { select = '*', filters = {} } = {}) {
    const res = await fetch('/api/supabase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'select', table, select, filters }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'select error');
    return json.data;
  },
  async upsert(table, data, { onConflict, ignoreDuplicates = false } = {}) {
    const res = await fetch('/api/supabase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'upsert', table, data, onConflict, ignoreDuplicates }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'upsert error');
    return json.data;
  },
  async update(table, data, filters = {}) {
    const res = await fetch('/api/supabase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', table, data, filters }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'update error');
    return json.data;
  },
};

// ─── Constantes ────────────────────────────────────────────────────────
// ─── Constantes XP ─────────────────────────────────────────────────────
const LEVEL_CAP   = 250;
const DAILY_XP_CAP = 20;

function xpRequired(level, limitbreak = false) {
  if (!limitbreak) {
    return 20 + Math.floor(level / 10) * 5;
  }
  return 40 + Math.floor((level - LEVEL_CAP) / 10) * 5;
}

// ─── Constante limite de stats ──────────────────────────────────────────
const STAT_LIMIT = 1050; // max avant limitbreak

const RANKS = ['E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS', 'Z'];
const RANK_RATIO = Object.fromEntries(RANKS.map((r, i) => [r, (i + 1) / RANKS.length]));
const getNextRank = (rank) => {
  const idx = RANKS.indexOf(rank);
  if (idx < 0 || idx >= RANKS.length - 1) return rank;
  return RANKS[idx + 1];
};

const NEN_COLORS = {
  Inconnu: '#888', Renforceur: '#e85d04', Émetteur: '#4cc9f0',
  Transformateur: '#7b2fff', Manipulateur: '#2dc653', Matérialisateur: '#f72585', Spécialiste: '#ffd60a',
};

const NEN_TYPES = ['Inconnu', 'Renforceur', 'Émetteur', 'Transformateur', 'Manipulateur', 'Matérialisateur', 'Spécialiste'];

const HATSU_BRANCHES = [
  { key: 'renforcement', label: 'Renf.', nenType: 'Renforceur' },
  { key: 'transformation', label: 'Trans.', nenType: 'Transformateur' },
  { key: 'materialisation', label: 'Matér.', nenType: 'Matérialisateur' },
  { key: 'specialisation', label: 'Spéc.', nenType: 'Spécialiste' },
  { key: 'manipulation', label: 'Manip.', nenType: 'Manipulateur' },
  { key: 'emission', label: 'Émiss.', nenType: 'Émetteur' },
];

const NEN_ABILITY_LIST = [
  { key: 'ten', label: 'Ten' },
  { key: 'ren', label: 'Ren' },
  { key: 'zetsu', label: 'Zetsu' },
  { key: 'in_', label: 'In' },
  { key: 'en', label: 'En' },
  { key: 'ken', label: 'Ken' },
  { key: 'gyo', label: 'Gyo' },
];

// ─── Helpers ───────────────────────────────────────────────────────────
const proxyImg = (url) => (url && url.trim()) ? `/api/image?url=${encodeURIComponent(url.trim())}` : '';

const isValidUrl = (str) => {
  try {
    const url = new URL(str.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const safeSession = {
  getItem(key) {
    try { return sessionStorage.getItem(key); } catch { return null; }
  },
  setItem(key, value) {
    try { sessionStorage.setItem(key, value); } catch { /* quota ou mode privé : on ignore */ }
  },
};

async function fetchProfile(discordId) {
  const rows = await db.select('players', {
    select: '*, stats(*), nen_abilities(*), hatsu_affinities(*)',
    filters: { discord_id: `eq.${discordId}` },
  });
  if (!rows || rows.length === 0) throw new Error('Joueur introuvable.');
  const data = rows[0];
  return {
    ...data,
    stats: Array.isArray(data.stats) ? data.stats[0] ?? {} : data.stats ?? {},
    nen_abilities: Array.isArray(data.nen_abilities) ? data.nen_abilities[0] ?? {} : data.nen_abilities ?? {},
    hatsu_affinities: Array.isArray(data.hatsu_affinities) ? data.hatsu_affinities[0] ?? {} : data.hatsu_affinities ?? {},
    techniques: [],
    nen_reserve: data.nen_reserve ?? 0,
    nen_points: data.nen_points ?? 0,
    affinity_points: data.affinity_points ?? 0,
  };
}

async function fetchTechniques(discordId) {
  const rows = await db.select('techniques', {
    select: '*',
    filters: { discord_id: `eq.${discordId}` },
  });
  return Array.isArray(rows) ? rows : [];
}

// ─── Radar Chart ───────────────────────────────────────────────────────
function RadarChart({ labels, values, color, title }) {
  const size = 280, cx = 140, cy = 140, r = 75, n = labels.length, levels = 5;
  const angle = useCallback((i) => (Math.PI * 2 * i) / n - Math.PI / 2, [n]);
  const maxVal = Math.max(...values, 1);
  const gridPolygons = useMemo(() =>
    Array.from({ length: levels }).map((_, lvl) =>
      Array.from({ length: n }).map((_, i) => {
        const ratio = (lvl + 1) / levels;
        return `${cx + r * ratio * Math.cos(angle(i))},${cy + r * ratio * Math.sin(angle(i))}`;
      }).join(' ')
    ), [n, angle]);
  const dataPoints = useMemo(() =>
    values.map((v, i) => {
      const ratio = v / maxVal;
      return { x: cx + r * ratio * Math.cos(angle(i)), y: cy + r * ratio * Math.sin(angle(i)) };
    }), [values, maxVal, angle]);
  const polygon = dataPoints.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, width: '100%' }}>
      <span style={{ fontFamily: "'Cinzel', serif", fontSize: 12, color, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 2 }}>{title}</span>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible' }}>
        {gridPolygons.map((pts, lvl) => <polygon key={lvl} points={pts} fill="none" stroke={color} strokeOpacity={0.12} strokeWidth={1} />)}
        {Array.from({ length: n }).map((_, i) => (
          <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos(angle(i))} y2={cy + r * Math.sin(angle(i))} stroke={color} strokeOpacity={0.2} strokeWidth={1} />
        ))}
        <polygon points={polygon} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={2} strokeOpacity={0.9} />
        {dataPoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3} fill={color} />)}
        {Array.from({ length: n }).map((_, i) => {
          const lx = cx + (r + 20) * Math.cos(angle(i));
          const ly = cy + (r + 20) * Math.sin(angle(i));
          return (
            <text key={i} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
              fontSize={14} fill="#ffffff" fontFamily="'Cinzel', serif" fontWeight="600">
              {labels[i]}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

// ─── HatsuStar ─────────────────────────────────────────────────────────
function HatsuStar({ hatsu, nenType, pendingKey, pendingNext }) {
  const size = 320, cx = 160, cy = 160, r = 85, n = 6, levels = RANKS.length;

  const angle = useCallback((i) => (Math.PI * 2 * i) / n - Math.PI / 2, [n]);

  const dataPoints = useMemo(() => {
    return HATSU_BRANCHES.map((b, i) => {
      let rank;
      if (b.key === pendingKey && pendingNext) {
        rank = pendingNext;
      } else {
        rank = hatsu?.[b.key] || 'E';
      }
      const ratio = rank === '✖' ? 0 : (RANK_RATIO[rank] ?? (1 / RANKS.length));
      return { x: cx + r * ratio * Math.cos(angle(i)), y: cy + r * ratio * Math.sin(angle(i)) };
    });
  }, [hatsu, angle, pendingKey, pendingNext]);

  const polygon = dataPoints.map(p => `${p.x},${p.y}`).join(' ');
  const activeIdx = HATSU_BRANCHES.findIndex(b => b.nenType === nenType);
  const pendingIdx = HATSU_BRANCHES.findIndex(b => b.key === pendingKey);
  const activeColor = NEN_COLORS[nenType] || '#888';
  const pendingColor = '#ffd60a';

  const gridPolygons = useMemo(() =>
    Array.from({ length: levels }).map((_, lvl) =>
      Array.from({ length: n }).map((_, i) => {
        const ratio = (lvl + 1) / levels;
        return `${cx + r * ratio * Math.cos(angle(i))},${cy + r * ratio * Math.sin(angle(i))}`;
      }).join(' ')
    ), [n, angle]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, width: '100%' }}>
      <span style={{ fontFamily: "'Cinzel', serif", fontSize: 12, color: '#c4b89a', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 2 }}>Affinités Hatsu</span>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible' }}>
        {gridPolygons.map((pts, lvl) => <polygon key={lvl} points={pts} fill="none" stroke="#fff" strokeOpacity={0.06} strokeWidth={1} />)}
        {HATSU_BRANCHES.map((b, i) => {
          const isActive = i === activeIdx;
          const isPending = i === pendingIdx;
          const strokeColor = isPending ? pendingColor : (isActive ? activeColor : '#fff');
          const strokeOpacity = isPending ? 0.8 : (isActive ? 0.4 : 0.1);
          const strokeWidth = isPending ? 2 : (isActive ? 1.5 : 1);
          return <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos(angle(i))} y2={cy + r * Math.sin(angle(i))} stroke={strokeColor} strokeOpacity={strokeOpacity} strokeWidth={strokeWidth} />;
        })}
        <polygon points={polygon} fill="#fff" fillOpacity={0.03} stroke="#fff" strokeWidth={1} strokeOpacity={0.15} />
        {pendingIdx >= 0 && (() => {
          const p = dataPoints[pendingIdx];
          return <>
            <line x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={pendingColor} strokeWidth={3} strokeOpacity={0.9} strokeDasharray="5,5" />
            <circle cx={p.x} cy={p.y} r={9} fill={pendingColor} fillOpacity={0.3} stroke={pendingColor} strokeWidth={2} />
            <circle cx={p.x} cy={p.y} r={4} fill={pendingColor} />
          </>;
        })()}
        {activeIdx >= 0 && !pendingKey && (() => {
          const p = dataPoints[activeIdx];
          return <>
            <line x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={activeColor} strokeWidth={2.5} strokeOpacity={0.85} />
            <circle cx={p.x} cy={p.y} r={7} fill={activeColor} fillOpacity={0.2} stroke={activeColor} strokeWidth={1.5} />
            <circle cx={p.x} cy={p.y} r={3} fill={activeColor} />
          </>;
        })()}
        {dataPoints.map((p, i) => {
          if (i === activeIdx && !pendingKey) return null;
          if (i === pendingIdx) return null;
          return <circle key={i} cx={p.x} cy={p.y} r={3} fill="#c4b89a" fillOpacity={0.45} />;
        })}
        {HATSU_BRANCHES.map((b, i) => {
          const lx = cx + (r + 22) * Math.cos(angle(i));
          const ly = cy + (r + 22) * Math.sin(angle(i));
          let rank;
          if (b.key === pendingKey && pendingNext) {
            rank = pendingNext;
          } else {
            rank = hatsu?.[b.key] || 'E';
          }
          const isActive = i === activeIdx;
          const isPending = i === pendingIdx;
          const col = isPending ? pendingColor : (isActive ? activeColor : '#d4c8b0');
          const fontWeight = isPending || isActive ? 'bold' : '500';
          const opacity = isPending || isActive ? 1 : 0.78;
          return (
            <g key={i}>
              <text x={lx} y={ly - 9} textAnchor="middle" dominantBaseline="middle"
                fontSize={14} fill={col} fontFamily="'Cinzel', serif"
                opacity={opacity} fontWeight={fontWeight}>
                {b.label}
              </text>
              <text x={lx} y={ly + 10} textAnchor="middle" dominantBaseline="middle"
                fontSize={15} fill={col} fontFamily="monospace"
                fontWeight={fontWeight} opacity={opacity}>
                {rank}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── NenBars ────────────────────────────────────────────────────────────
function NenBars({ mastery, reserve, points, color }) {
  const safeMastery = Math.max(0, Math.min(mastery || 0, 10));
  const maxPoints = Math.max(0, (reserve || 0) * 10);
  const safePoints = Math.max(0, Math.min(points || 0, maxPoints));
  const reserveRatio = maxPoints > 0 ? safePoints / maxPoints : 0;
  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
        <span style={{ fontSize: 11, color: '#c4b89a', fontFamily: "'Cinzel', serif", letterSpacing: 2, textTransform: 'uppercase' }}>Maîtrise Nen</span>
        <span style={{ fontSize: 13, fontFamily: 'monospace', color, fontWeight: 'bold' }}>{safeMastery} / 10</span>
      </div>
      <div style={{ display: 'flex', gap: 3, marginBottom: 12 }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} style={{ flex: 1, height: 6, borderRadius: 2, background: i < safeMastery ? color : '#2a2010', opacity: i < safeMastery ? (0.4 + (i / 10) * 0.6) : 1 }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
        <span style={{ fontSize: 11, color: '#c4b89a', fontFamily: "'Cinzel', serif", letterSpacing: 2, textTransform: 'uppercase' }}>Réserve Nen</span>
        <span style={{ fontSize: 13, fontFamily: 'monospace', color, fontWeight: 'bold' }}>{safePoints} / {maxPoints}</span>
      </div>
      <div style={{ width: '100%', height: 8, borderRadius: 3, background: '#2a2010', overflow: 'hidden', marginBottom: 8 }}>
        <div style={{ width: `${reserveRatio * 100}%`, height: '100%', background: color, transition: 'width 0.2s' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#c4b89a' }}>
        <span>Réserve: <b style={{ color: '#e0d5c5' }}>{reserve || 0}</b></span>
      </div>
    </div>
  );
}

// ─── NenAbilitiesGrid ──────────────────────────────────────────────────
function NenAbilitiesGrid({ abilities, color }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#c4b89a', fontFamily: "'Cinzel', serif", letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8, opacity: 0.7 }}>Techniques de base</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {NEN_ABILITY_LIST.map(({ key, label }) => {
          const unlocked = abilities?.[key] === 1;
          return (
            <div key={key} style={{ padding: '5px 12px', borderRadius: 20, border: `1px solid ${unlocked ? color : '#2a2010'}`, background: unlocked ? `${color}18` : 'transparent', color: unlocked ? color : '#383028', fontSize: 11, fontFamily: "'Cinzel', serif", letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 8 }}>{unlocked ? '◆' : '◇'}</span>{label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── useHoldAction ─────────────────────────────────────────────────────
// Déclenche action() immédiatement au mousedown, puis accélère progressivement
// tant que le bouton reste appuyé. S'arrête proprement au mouseup/mouseleave/touchend.
function useHoldAction(action, { initialDelay = 400, minInterval = 40, acceleration = 0.82 } = {}) {
  const timerRef = useRef(null);
  const repeatRef = useRef(null);
  const currentInterval = useRef(150);
  const actionRef = useRef(action);
  actionRef.current = action;

  const stop = useCallback(() => {
    clearTimeout(timerRef.current);
    clearTimeout(repeatRef.current);
    timerRef.current = null;
    repeatRef.current = null;
    currentInterval.current = 150;
  }, []);

  const start = useCallback(() => {
    actionRef.current();
    timerRef.current = setTimeout(function tick() {
      actionRef.current();
      currentInterval.current = Math.max(minInterval, currentInterval.current * acceleration);
      repeatRef.current = setTimeout(tick, currentInterval.current);
    }, initialDelay);
  }, [initialDelay, minInterval, acceleration]);

  useEffect(() => () => stop(), [stop]);

  return {
    onMouseDown: start,
    onMouseUp: stop,
    onMouseLeave: stop,
    onTouchStart: (e) => { e.preventDefault(); start(); },
    onTouchEnd: stop,
  };
}

// ─── StatRow ───────────────────────────────────────────────────────────
const btnStyle = (color, disabled) => ({
  width: 36, height: 36,
  padding: 0,
  boxSizing: 'border-box',
  background: disabled ? '#111' : '#1a1208',
  border: `1px solid ${disabled ? '#222' : color + '40'}`,
  color: disabled ? '#333' : '#e0d5c5',
  borderRadius: 6,
  cursor: disabled ? 'default' : 'pointer',
  fontSize: 20,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1,
  opacity: disabled ? 0.4 : 1,
  flexShrink: 0,
  userSelect: 'none',
  WebkitUserSelect: 'none',
});

function StatRow({ label, value, onInc, onDec, color, canInc, canDec, limitbreak }) {
  const STAT_MAX    = 1200;
  const limitRatio  = STAT_LIMIT / STAT_MAX; // position du trait limite (~87.5%)
  const statPercentage = Math.min((value / STAT_MAX) * 100, 100);
  const atLimit = value >= STAT_LIMIT;

  const incHandlers = useHoldAction(onInc);
  const decHandlers = useHoldAction(onDec);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
      <div style={{ fontSize: 16, fontWeight: 600, color: '#c4b89a', fontFamily: "'Cinzel', serif", letterSpacing: 1, width: 110, minWidth: 110, flexShrink: 0, textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>{label}</div>
      <button
        {...(canDec ? decHandlers : {})}
        disabled={!canDec}
        style={btnStyle(color, !canDec)}
      >-</button>
      <div style={{ width: 40, height: 36, boxSizing: 'border-box', textAlign: 'center', fontSize: 18, fontWeight: 'bold', color: atLimit ? '#f72585' : '#fff', fontFamily: 'monospace', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{value}</div>
      <button
        {...(canInc ? incHandlers : {})}
        disabled={!canInc}
        style={btnStyle(color, !canInc)}
      >+</button>
      {/* Barre avec trait limite */}
      <div style={{ flex: 1, height: 6, background: '#2a2010', borderRadius: 3, position: 'relative', minWidth: 40, alignSelf: 'center' }}>
        <div style={{ width: `${statPercentage}%`, height: '100%', background: atLimit ? '#f72585' : color, borderRadius: 3, transition: 'width 0.2s' }} />
        {/* Trait limite à 1050 */}
        {!limitbreak && (
          <div style={{
            position: 'absolute',
            left: `${limitRatio * 100}%`,
            top: -3, bottom: -3,
            width: 2,
            background: '#ff0000',
            borderRadius: 1,
          }} />
        )}
      </div>
    </div>
  );
}

// ─── APP ───────────────────────────────────────────────────────────────
export default function App() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [discordId, setDiscordId] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [localStats, setLocalStats] = useState({});
  const [localReserve, setLocalReserve] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savingAffinity, setSavingAffinity] = useState(false);
  const [pendingAffinity, setPendingAffinity] = useState(null);
  const [imageHover, setImageHover] = useState(false);
  const [imageEditMode, setImageEditMode] = useState(false);
  const [newImageUrl, setNewImageUrl] = useState('');
  const [imageUrlError, setImageUrlError] = useState('');
  const [techniquesLoading, setTechniquesLoading] = useState(false);
  const [isWideScreen, setIsWideScreen] = useState(false);
  const [dailyXp, setDailyXp] = useState(0);

  const cacheKey = useMemo(
    () => discordId ? `hxh_profile_cache_${discordId}` : null,
    [discordId]
  );

  const loadTechniques = useCallback(async (userId) => {
    if (!userId) return;
    setTechniquesLoading(true);
    try {
      const list = await fetchTechniques(userId);
      setProfile(prev => (prev ? { ...prev, techniques: list } : prev));
    } finally {
      setTechniquesLoading(false);
    }
  }, []);

  const hydrateFromRemote = useCallback(async (userId, username) => {
    await db.upsert('players', { discord_id: userId, username }, { onConflict: 'discord_id', ignoreDuplicates: true });
    await Promise.all([
      db.upsert('stats', { discord_id: userId }, { onConflict: 'discord_id', ignoreDuplicates: true }),
      db.upsert('nen_abilities', { discord_id: userId }, { onConflict: 'discord_id', ignoreDuplicates: true }),
      db.upsert('hatsu_affinities', { discord_id: userId }, { onConflict: 'discord_id', ignoreDuplicates: true }),
    ]);
    const p = await fetchProfile(userId);
    setProfile(prev => ({ ...p, techniques: prev?.techniques ?? [] }));
    setLocalStats({ ...p.stats });
    setLocalReserve(p.nen_reserve ?? 0);

    // Charge l'XP journalier
    const today = new Date().toISOString().slice(0, 10);
    const dailyRows = await db.select('rp_daily_xp', {
      select: 'xp_earned',
      filters: { discord_id: `eq.${userId}`, date: `eq.${today}` },
    }).catch(() => []);
    setDailyXp(dailyRows?.[0]?.xp_earned ?? 0);

    void loadTechniques(userId);
  }, [loadTechniques]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 700px)');
    const apply = () => setIsWideScreen(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    async function setup() {
      let renderedFromCache = false;
      try {
        const isInDiscord = window.location.search.includes('frame_id');
        if (!isInDiscord) {
          setError('Cette application doit être lancée depuis Discord.');
          setLoading(false);
          return;
        }

        const sdk = new DiscordSDK(import.meta.env.VITE_CLIENT_ID);
        await sdk.ready();

        const { code } = await sdk.commands.authorize({
          client_id: import.meta.env.VITE_CLIENT_ID,
          response_type: 'code',
          prompt: 'none',
          scope: ['identify'],
        });

        const tokenRes = await fetch('/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        if (!tokenRes.ok) throw new Error('Échec du token.');
        const { access_token } = await tokenRes.json();
        await sdk.commands.authenticate({ access_token });

        const userRes = await fetch('https://discord.com/api/v10/users/@me', {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        if (!userRes.ok) throw new Error('Impossible de récupérer l\'utilisateur Discord.');
        const user = await userRes.json();
        setDiscordId(user.id);

        const rawCached = safeSession.getItem(`hxh_profile_cache_${user.id}`);
        if (rawCached) {
          try {
            const cached = JSON.parse(rawCached);
            if (cached && typeof cached === 'object') {
              setProfile(cached);
              setLocalStats({ ...(cached.stats ?? {}) });
              setLocalReserve(cached.nen_reserve ?? 0);
              renderedFromCache = true;
              setLoading(false);
            }
          } catch {
            // Cache invalide : on ignore et on recharge depuis le serveur
          }
        }

        if (renderedFromCache) {
          void hydrateFromRemote(user.id, user.username).catch((err) => setError(err.message));
        } else {
          await hydrateFromRemote(user.id, user.username);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        if (!renderedFromCache) setLoading(false);
      }
    }
    setup();
  }, [hydrateFromRemote]);

  useEffect(() => {
    if (!cacheKey || !profile) return;
    safeSession.setItem(cacheKey, JSON.stringify(profile));
  }, [cacheKey, profile]);

  const nenColor = profile ? (NEN_COLORS[profile.nen_type] || '#888') : '#888';
  const MIN_STAT = 1;

  const totalSpent = useMemo(() => {
    if (!localStats || !profile?.stats) return 0;
    const spentStats = ['force', 'vitesse', 'resistance', 'technique']
      .reduce((acc, k) => acc + ((localStats[k] || 0) - (profile.stats[k] || 0)), 0);
    const spentReserve = (localReserve || 0) - (profile?.nen_reserve || 0);
    return spentStats + spentReserve;
  }, [localStats, localReserve, profile?.stats, profile?.nen_reserve]);

  const pointsLeft = profile ? profile.stat_points - totalSpent : 0;
  const isInfinitePoints = profile?.stat_points >= 999999;

  const incStat = useCallback((k) => {
    if (!isInfinitePoints && pointsLeft <= 0) return;
    const limitbreak = profile?.limitbreak ?? false;
    setLocalStats(prev => {
      const cur = prev[k] || 0;
      if (!limitbreak && cur >= STAT_LIMIT) return prev;
      if (cur >= 1200) return prev; // plafond absolu même en limitbreak
      return { ...prev, [k]: cur + 1 };
    });
  }, [pointsLeft, isInfinitePoints, profile?.limitbreak]);

  const decStat = useCallback((k) => {
    const base = profile?.stats?.[k] ?? MIN_STAT;
    setLocalStats(prev => ((prev[k] || MIN_STAT) <= base ? prev : { ...prev, [k]: prev[k] - 1 }));
  }, [profile?.stats]);

  const incReserve = useCallback(() => {
    if (!isInfinitePoints && pointsLeft <= 0) return;
    setLocalReserve(prev => (prev || 0) + 1);
  }, [pointsLeft, isInfinitePoints]);

  const decReserve = useCallback(() => {
    const base = profile?.nen_reserve ?? 0;
    setLocalReserve(prev => ((prev || 0) <= base ? prev : prev - 1));
  }, [profile?.nen_reserve]);

  const saveStats = async () => {
    if (!discordId || saving) return;
    if (totalSpent <= 0) return;
    setSaving(true);
    try {
      await db.update('stats', localStats, { 'discord_id': `eq.${discordId}` });
      await db.update('players', { nen_reserve: localReserve }, { 'discord_id': `eq.${discordId}` });
      if (!isInfinitePoints) {
        await db.update('players', { stat_points: pointsLeft }, { 'discord_id': `eq.${discordId}` });
      }
      const updated = await fetchProfile(discordId);
      setProfile(prev => ({ ...updated, techniques: prev?.techniques ?? [] }));
      setLocalStats({ ...updated.stats });
      setLocalReserve(updated.nen_reserve ?? 0);
      void loadTechniques(discordId);
    } finally {
      setSaving(false);
    }
  };

  const upgradeAffinity = (key) => {
    if (!discordId || savingAffinity) return;
    if ((profile?.affinity_points ?? 0) <= 0) return;
    const current = profile?.hatsu_affinities?.[key];
    if (!current || current === '✖' || current === 'Z') return;
    const next = getNextRank(current);
    if (next === current) return;
    setPendingAffinity({ key, current, next });
  };

  const confirmAffinity = async () => {
    if (!pendingAffinity || !discordId) return;
    setSavingAffinity(true);
    try {
      await db.update('hatsu_affinities', { [pendingAffinity.key]: pendingAffinity.next }, { 'discord_id': `eq.${discordId}` });
      await db.update('players', { affinity_points: (profile.affinity_points ?? 0) - 1 }, { 'discord_id': `eq.${discordId}` });
      const updated = await fetchProfile(discordId);
      setProfile(prev => ({ ...updated, techniques: prev?.techniques ?? [] }));
      setPendingAffinity(null);
      void loadTechniques(discordId);
    } finally {
      setSavingAffinity(false);
    }
  };

  const cancelAffinity = () => setPendingAffinity(null);

  const saveCharacter = async () => {
    if (!discordId || saving) return;
    setSaving(true);
    try {
      await db.update('players', editData, { 'discord_id': `eq.${discordId}` });
      const updated = await fetchProfile(discordId);
      setProfile(prev => ({ ...updated, techniques: prev?.techniques ?? [] }));
      setEditing(false);
      void loadTechniques(discordId);
    } finally {
      setSaving(false);
    }
  };

  const saveImage = async () => {
    const trimmed = newImageUrl.trim();
    if (!trimmed || !discordId) return;
    if (!isValidUrl(trimmed)) {
      setImageUrlError('URL invalide. Elle doit commencer par http:// ou https://');
      return;
    }
    setImageUrlError('');
    await db.update('players', { char_image: trimmed }, { 'discord_id': `eq.${discordId}` });
    const updated = await fetchProfile(discordId);
    setProfile(prev => ({ ...updated, techniques: prev?.techniques ?? [] }));
    setImageEditMode(false);
    setNewImageUrl('');
    void loadTechniques(discordId);
  };

  if (loading) return (
    <div style={S.center}>
      <div style={S.spinner} />
      <p style={{ color: '#c4b89a', fontFamily: "'Cinzel', serif", letterSpacing: 3, marginTop: 20 }}>CHARGEMENT...</p>
    </div>
  );
  if (error) return (
    <div style={S.center}>
      <p style={{ color: '#f72585', fontFamily: "'Cinzel', serif" }}>❌ {error}</p>
    </div>
  );

  const physLabels = ['Force', '  Vitesse', 'Rés. ', 'Tech.'];
  const physVals = [localStats.force ?? 1, localStats.vitesse ?? 1, localStats.resistance ?? 1, localStats.technique ?? 1];
  const hasChanges = totalSpent !== 0;

  return (
    <div style={S.root}>
      <div style={{ ...S.bgAccent, background: `radial-gradient(ellipse at 80% 20%, ${nenColor}18 0%, transparent 60%)` }} />
      <div style={S.scroll}>

        {/* HEADER */}
        <div style={S.header}>
          <div style={S.imageWrap} onMouseEnter={() => setImageHover(true)} onMouseLeave={() => setImageHover(false)} onClick={() => setImageEditMode(true)}>
            {profile.char_image
              ? <img src={proxyImg(profile.char_image)} alt="perso" style={S.charImg} />
              : <div style={{ ...S.charImg, ...S.charImgPlaceholder }}><span style={{ fontSize: 40 }}>👤</span></div>}
            {imageHover && <div style={S.imageOverlay}><span style={{ fontSize: 20 }}>✏️</span></div>}
          </div>
          <div style={S.headerInfo}>
            {(profile.char_name || profile.char_surname) ? (
              <>
                <div style={S.charSurname}>{profile.char_surname}</div>
                <div style={S.charName}>{profile.char_name}</div>
              </>
            ) : (
              <div style={{ color: '#555', fontFamily: "'Cinzel', serif", fontSize: 13 }}>Personnage sans nom</div>
            )}
            <div style={{ ...S.nenBadge, borderColor: nenColor, color: nenColor }}>◈ {profile.nen_type}</div>
            <div style={S.infoRow}><span>📍</span><span>{profile.location || 'Inconnu'}</span></div>
            <div style={S.infoRow}><span>⭐</span><span>Réputation : {profile.reputation}</span></div>
            <div style={S.jenny}>💰 {profile.jenny?.toLocaleString()} Jenny</div>
            {/* Barre d'XP */}
            {(() => {
              const lb = profile.limitbreak ?? false;
              const needed = xpRequired(profile.level, lb);
              const xpInLevel = profile.xp % needed;
              const xpRatio = Math.min(xpInLevel / needed, 1);
              const isBlocked = !lb && profile.level >= LEVEL_CAP;
              const xpColor = isBlocked ? '#ff0000' : lb ? '#ff4444' : nenColor;
              return (
                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                    <span style={{ fontSize: 11, color: '#c4b89a', letterSpacing: 2, textTransform: 'uppercase' }}>
                      Niv. {profile.level}{lb ? ' ✦' : ''}
                      {isBlocked ? <span style={{ color: '#f72585', marginLeft: 6, fontSize: 10 }}>BLOQUÉ</span> : null}
                    </span>
                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: xpColor }}>
                      {xpInLevel} / {needed} XP
                    </span>
                  </div>
                  <div style={{ width: '100%', height: 5, background: '#2a2010', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${xpRatio * 100}%`, height: '100%', background: xpColor, borderRadius: 3, transition: 'width 0.3s' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                    <span style={{ fontSize: 10, color: '#666', fontFamily: 'monospace' }}>
                      XP aujourd'hui : <span style={{ color: dailyXp >= DAILY_XP_CAP ? '#f72585' : '#c4b89a' }}>{dailyXp}</span>/{DAILY_XP_CAP}
                    </span>
                  </div>
                </div>
              );
            })()}
            <button onClick={() => { setEditData({ char_name: profile.char_name, char_surname: profile.char_surname }); setEditing(true); }}
              style={{ ...S.editBtn, borderColor: nenColor + '60', color: nenColor }}>✦ Modifier</button>
          </div>
        </div>

        {/* RESSOURCES NEN */}
        <div style={S.section}>
          <NenBars mastery={profile.nen_mastery} reserve={profile.nen_reserve} points={profile.nen_points} color={nenColor} />
        </div>

        {/* TECHNIQUES DE BASE */}
        <div style={S.section}><NenAbilitiesGrid abilities={profile.nen_abilities} color={nenColor} /></div>

        {/* TECHNIQUES RP */}
        {(techniquesLoading || profile.techniques?.length > 0) && (
          <div style={S.section}>
            <div style={S.sectionTitle}>Techniques</div>
            {techniquesLoading ? (
              <div style={{ color: '#888', fontSize: 12 }}>Chargement des techniques...</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {profile.techniques.map(t => (
                  <div key={t.id} style={{ ...S.listItem, borderColor: nenColor + '30' }}>
                    <span style={{ color: nenColor, marginRight: 8, fontSize: 10 }}>◆</span>
                    <div>
                      <div style={{ fontSize: 13 }}>{t.name}</div>
                      {t.description && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{t.description}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* POINTS */}
        <div style={S.pointsBar}>
          <span style={{ color: '#c4b89a', fontSize: 12, fontFamily: "'Cinzel', serif", letterSpacing: 1 }}>POINTS DISPONIBLES</span>
          <span style={{ color: pointsLeft > 0 ? '#ffd60a' : '#555', fontSize: 18, fontWeight: 'bold', fontFamily: 'monospace' }}>
            {isInfinitePoints ? '∞' : pointsLeft}
          </span>
        </div>

        {/* STATS */}
        <div style={{ ...S.statBlock, flexDirection: isWideScreen ? 'row' : 'column', alignItems: isWideScreen ? 'flex-start' : 'stretch', gap: isWideScreen ? 18 : 0 }}>
          <div style={{ display: 'flex', justifyContent: 'center', width: isWideScreen ? 280 : '100%', flexShrink: 0 }}>
            <RadarChart labels={physLabels} values={physVals} color="#e85d04" title="Physique" />
          </div>
          <div style={{ marginTop: isWideScreen ? 0 : 12, width: '100%', flex: isWideScreen ? 1 : 'unset' }}>
            {[['force', 'Force'], ['vitesse', 'Vitesse'], ['resistance', 'Résistance'], ['technique', 'Technique']].map(([k, l]) => (
              <StatRow key={k} label={l} value={localStats[k] || MIN_STAT}
                onInc={() => incStat(k)} onDec={() => decStat(k)} color="#e85d04"
                canInc={(isInfinitePoints || pointsLeft > 0) && (profile?.limitbreak || (localStats[k] || MIN_STAT) < STAT_LIMIT)}
                canDec={(localStats[k] || MIN_STAT) > (profile?.stats?.[k] ?? MIN_STAT)}
                limitbreak={profile?.limitbreak ?? false} />
            ))}
            <StatRow
              label="Réserve Nen"
              value={localReserve || 0}
              onInc={incReserve}
              onDec={decReserve}
              color="#4cc9f0"
              canInc={(isInfinitePoints || pointsLeft > 0) && (profile?.limitbreak || (localReserve || 0) < STAT_LIMIT)}
              canDec={(localReserve || 0) > (profile?.nen_reserve ?? 0)}
              limitbreak={profile?.limitbreak ?? false}
            />
          </div>
        </div>
        {hasChanges && (
          <button onClick={saveStats} disabled={saving} style={{ ...S.saveBtn, borderColor: '#ffd60a', color: '#ffd60a' }}>
            {saving ? 'Sauvegarde...' : '✦ Confirmer la répartition'}
          </button>
        )}

        {/* HATSU */}
        <div style={{ ...S.statBlock, marginTop: 12, flexDirection: isWideScreen ? 'row' : 'column', alignItems: isWideScreen ? 'flex-start' : 'stretch', gap: isWideScreen ? 18 : 0 }}>
          <div style={{ display: 'flex', justifyContent: 'center', width: isWideScreen ? 'auto' : '100%' }}>
            <HatsuStar hatsu={profile.hatsu_affinities} nenType={profile.nen_type} pendingKey={pendingAffinity?.key} pendingNext={pendingAffinity?.next} />
          </div>
          <div style={{ marginTop: isWideScreen ? 0 : 10, width: '100%', flex: isWideScreen ? 1 : 'unset' }}>
            <div style={S.sectionTitle}>Améliorer les affinités</div>
            <div style={{ fontSize: 12, color: '#c4b89a', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>Points d'affinité disponibles:</span>
              <span style={{ color: '#ffd60a', fontWeight: 'bold', fontFamily: 'monospace' }}>{profile.affinity_points ?? 0}</span>
            </div>
            {!pendingAffinity ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {HATSU_BRANCHES.map((b) => {
                  const rank = profile.hatsu_affinities?.[b.key] ?? 'E';
                  const blocked = rank === '✖' || rank === 'Z' || (profile.affinity_points ?? 0) <= 0 || savingAffinity;
                  return (
                    <button key={b.key} disabled={blocked} onClick={() => upgradeAffinity(b.key)}
                      style={{ ...S.editBtn, width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderColor: blocked ? '#333' : (nenColor + '66'), color: blocked ? '#666' : nenColor, padding: '12px 14px', fontSize: 14, fontWeight: 'bold' }}>
                      <span>{b.label} ({rank})</span>
                      <span>{rank === '✖' ? '✖' : rank === 'Z' ? 'MAX' : '+1'}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div>
                <div style={{ padding: '12px 14px', background: '#ffd60a10', border: '1px solid #ffd60a40', borderRadius: 8, marginBottom: 10, fontSize: 13, color: '#ffd60a' }}>
                  Prévisualisation: {HATSU_BRANCHES.find(b => b.key === pendingAffinity.key)?.label} ({pendingAffinity.current} → {pendingAffinity.next})
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={confirmAffinity} disabled={savingAffinity} style={{ ...S.editBtn, flex: 1, borderColor: '#ffd60a', color: '#ffd60a', fontWeight: 'bold', fontSize: 13 }}>
                    {savingAffinity ? 'Confirmation...' : '✦ Confirmer'}
                  </button>
                  <button onClick={cancelAffinity} disabled={savingAffinity} style={{ ...S.editBtn, flex: 1, borderColor: '#333', color: '#666' }}>Annuler</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MODAL PERSONNAGE */}
      {editing && (
        <div style={S.modalBg} onClick={() => setEditing(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <h2 style={S.modalTitle}>Modifier le personnage</h2>
            <label style={S.label}>Prénom</label>
            <input style={S.input} value={editData.char_name || ''} onChange={e => setEditData(p => ({ ...p, char_name: e.target.value }))} placeholder="Prénom" />
            <label style={S.label}>Nom</label>
            <input style={S.input} value={editData.char_surname || ''} onChange={e => setEditData(p => ({ ...p, char_surname: e.target.value }))} placeholder="Nom de famille" />
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={() => setEditing(false)} style={{ ...S.editBtn, flex: 1, borderColor: '#333', color: '#666' }}>Annuler</button>
              <button onClick={saveCharacter} disabled={saving} style={{ ...S.editBtn, flex: 1, borderColor: nenColor, color: nenColor }}>
                {saving ? '...' : 'Sauvegarder'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL IMAGE */}
      {imageEditMode && (
        <div style={S.modalBg} onClick={() => { setImageEditMode(false); setImageUrlError(''); }}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <h2 style={S.modalTitle}>Image du personnage</h2>
            <label style={S.label}>URL de l'image</label>
            <input
              style={{ ...S.input, borderColor: imageUrlError ? '#f72585' : '#ffffff15' }}
              value={newImageUrl}
              onChange={e => { setNewImageUrl(e.target.value); setImageUrlError(''); }}
              placeholder="https://..."
              autoFocus
            />
            {imageUrlError && (
              <div style={{ color: '#f72585', fontSize: 11, marginTop: 6 }}>{imageUrlError}</div>
            )}
            {newImageUrl.trim() && !imageUrlError && (
              <img src={proxyImg(newImageUrl.trim())} alt="preview"
                style={{ width: '100%', height: 160, objectFit: 'cover', borderRadius: 8, marginTop: 10 }}
                onError={e => { e.target.style.display = 'none'; }} />
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={() => { setImageEditMode(false); setNewImageUrl(''); setImageUrlError(''); }} style={{ ...S.editBtn, flex: 1, borderColor: '#333', color: '#666' }}>Annuler</button>
              <button onClick={saveImage} style={{ ...S.editBtn, flex: 1, borderColor: nenColor, color: nenColor }}>Confirmer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── STYLES ────────────────────────────────────────────────────────────
const S = {
  root: { minHeight: '100vh', background: '#0d0a06', color: '#e0d5c5', fontFamily: "'Cinzel', serif", position: 'relative', overflow: 'hidden' },
  bgAccent: { position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', transition: 'background 1s' },
  scroll: { position: 'relative', zIndex: 1, padding: '20px 8px 40px', maxWidth: 980, margin: '0 auto' },
  center: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0d0a06' },
  spinner: { width: 48, height: 48, borderRadius: '50%', border: '2px solid #ffd60a30', borderTop: '2px solid #ffd60a', animation: 'spin 1s linear infinite' },
  header: { display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 12, padding: 16, background: '#ffffff06', borderRadius: 12, border: 'none' },
  imageWrap: { position: 'relative', cursor: 'pointer', flexShrink: 0, borderRadius: 10, overflow: 'hidden', width: 110, height: 140, border: '1px solid #ffffff15' },
  charImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  charImgPlaceholder: { background: '#1a1208', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  imageOverlay: { position: 'absolute', inset: 0, background: '#00000070', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(1px)' },
  headerInfo: { flex: 1, display: 'flex', flexDirection: 'column', gap: 6 },
  charSurname: { fontSize: 12, color: '#c4b89a', letterSpacing: 3, textTransform: 'uppercase', opacity: 0.7 },
  charName: { fontSize: 22, fontWeight: 'bold', color: '#fff', letterSpacing: 1, lineHeight: 1.2 },
  nenBadge: { display: 'inline-block', fontSize: 12, padding: '3px 10px', border: '1px solid', borderRadius: 20, letterSpacing: 2, width: 'fit-content' },
  infoRow: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#c4b89a' },
  jenny: { fontSize: 13, color: '#ffd60a', letterSpacing: 1 },
  editBtn: { background: 'transparent', border: '1px solid', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 11, letterSpacing: 1, fontFamily: "'Cinzel', serif", width: 'fit-content' },
  section: { marginBottom: 12, padding: '14px 16px', background: '#ffffff05', borderRadius: 12, border: 'none' },
  sectionTitle: { fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', color: '#c4b89a', opacity: 0.9, marginBottom: 10 },
  listItem: { display: 'flex', alignItems: 'flex-start', padding: '6px 10px', background: '#ffffff04', borderRadius: 6, border: '1px solid' },
  pointsBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', margin: '12px 0', background: '#ffffff06', borderRadius: 8, border: 'none' },
  statBlock: { background: '#ffffff05', borderRadius: 12, border: 'none', padding: 14, display: 'flex', flexDirection: 'column', alignItems: 'stretch' },
  saveBtn: { width: '100%', marginTop: 12, background: '#ffd60a0d', border: '1px solid', borderRadius: 8, padding: '12px', cursor: 'pointer', fontSize: 13, letterSpacing: 2, fontFamily: "'Cinzel', serif" },
  modalBg: { position: 'fixed', inset: 0, background: '#000000b0', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, backdropFilter: 'blur(4px)' },
  modal: { background: '#0f0c08', border: '1px solid #ffffff15', borderRadius: 14, padding: 24, width: '90%', maxWidth: 340 },
  modalTitle: { margin: '0 0 20px', fontSize: 16, color: '#e0d5c5', letterSpacing: 2 },
  label: { display: 'block', fontSize: 11, color: '#666', letterSpacing: 1, marginBottom: 6, marginTop: 12, textTransform: 'uppercase' },
  input: { width: '100%', background: '#1a1208', border: '1px solid #ffffff15', borderRadius: 6, padding: '8px 10px', color: '#e0d5c5', fontFamily: "'Cinzel', serif", fontSize: 13, boxSizing: 'border-box', outline: 'none' },
};