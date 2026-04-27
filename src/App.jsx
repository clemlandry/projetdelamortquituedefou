import { DiscordSDK } from '@discord/embedded-app-sdk';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

// Import rank images
import erank from './Ressources/erank.png';
import drank from './Ressources/drank.png';
import crank from './Ressources/crank.png';
import brank from './Ressources/brank.png';
import arank from './Ressources/arank.png';
import srank from './Ressources/srank.png';
import ssrank from './Ressources/ssrank.png';
import sssrank from './Ressources/sssrank.png';
import zrank from './Ressources/zrank.png';

// ─── Animations ────────────────────────────────────────────────────────
const styleEl = document.createElement('style');
styleEl.textContent = `
  @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Rajdhani:wght@400;500;600;700&display=swap');
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
  @keyframes shimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
  @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
  .ac-tab { transition: all 0.2s ease; position: relative; }
  .ac-tab::after { content:''; position:absolute; bottom:-1px; left:0; right:0; height:2px; background:transparent; transition: background 0.2s; }
  .ac-tab.active::after { background: var(--accent); }
  .ac-btn:hover { filter: brightness(1.15); transform: translateY(-1px); }
  .ac-btn:active { transform: translateY(0); }
  .ac-card { animation: fadeIn 0.3s ease forwards; }
  .hold-btn:active { background: rgba(255,255,255,0.08) !important; }
`;
document.head.appendChild(styleEl);

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
const LEVEL_CAP = 250;
const DAILY_XP_CAP = 20;

function xpRequired(level, limitbreak = false) {
  if (!limitbreak || level <= LEVEL_CAP) return 20 + Math.floor(level / 10) * 5;
  return 40 + Math.floor((level - LEVEL_CAP) / 10) * 5;
}

const STAT_LIMIT = 1050;

const RANKS = ['E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS', 'Z'];
const RANK_RATIO = Object.fromEntries(RANKS.map((r, i) => [r, (i + 1) / RANKS.length]));
const getNextRank = (rank) => {
  const idx = RANKS.indexOf(rank);
  if (idx < 0 || idx >= RANKS.length - 1) return rank;
  return RANKS[idx + 1];
};

const NEN_COLORS = {
  Inconnu: '#7a8fa6',
  Renforcement: '#e85d04',
  Émission: '#4cc9f0',
  Transformation: '#9b5de5',
  Manipulation: '#2dc653',
  Matérialisation: '#f72585',
  Spécialisation: '#ffd60a',
  Émetteur: '#4cc9f0',
  Transformateur: '#9b5de5',
  Manipulateur: '#2dc653',
  Matérialisateur: '#f72585',
  Spécialiste: '#ffd60a',
};

const NEN_TYPES = ['Inconnu', 'Renforcement', 'Émission', 'Transformation', 'Manipulation', 'Matérialisation', 'Spécialisation'];

const RANK_IMAGES = { E: erank, D: drank, C: crank, B: brank, A: arank, S: srank, SS: ssrank, SSS: sssrank, Z: zrank };

const HATSU_BRANCHES = [
  { key: 'renforcement', label: 'RENF.', nenType: 'Renforcement' },
  { key: 'transformation', label: 'TRANS.', nenType: 'Transformation' },
  { key: 'materialisation', label: 'MATÉR.', nenType: 'Matérialisation' },
  { key: 'specialisation', label: 'SPÉC.', nenType: 'Spécialisation' },
  { key: 'manipulation', label: 'MANIP.', nenType: 'Manipulation' },
  { key: 'emission', label: 'ÉMISS.', nenType: 'Émission' },
];

const NEN_ABILITY_LIST = [
  { key: 'ten', label: 'TEN' },
  { key: 'ren', label: 'REN' },
  { key: 'zetsu', label: 'ZETSU' },
  { key: 'in_', label: 'IN' },
  { key: 'en', label: 'EN' },
  { key: 'ken', label: 'KEN' },
  { key: 'gyo', label: 'GYO' },
];

// ─── Helpers ───────────────────────────────────────────────────────────
const proxyImg = (url) => (url && url.trim()) ? `/api/image?url=${encodeURIComponent(url.trim())}` : '';
const isValidUrl = (str) => {
  try {
    const url = new URL(str.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch { return false; }
};
const safeSession = {
  getItem(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
  setItem(key, value) { try { sessionStorage.setItem(key, value); } catch {} },
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
  const rows = await db.select('techniques', { select: '*', filters: { discord_id: `eq.${discordId}` } });
  return Array.isArray(rows) ? rows : [];
}

// ─── StarRating ────────────────────────────────────────────────────────
function StarRating({ value = 1, max = 5, color }) {
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      {Array.from({ length: max }).map((_, i) => (
        <svg key={i} width={16} height={16} viewBox="0 0 16 16">
          <polygon
            points="8,1 10,6 15,6 11,9.5 12.5,15 8,12 3.5,15 5,9.5 1,6 6,6"
            fill={i < value ? color : 'transparent'}
            stroke={i < value ? color : '#4a5a6a'}
            strokeWidth={1}
          />
        </svg>
      ))}
    </div>
  );
}

// ─── HexBadge ──────────────────────────────────────────────────────────
function HexBadge({ children, color, size = 44 }) {
  return (
    <div style={{ position: 'relative', width: size, height: size * 1.15, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width={size} height={size * 1.15} viewBox="0 0 44 50" style={{ position: 'absolute' }}>
        <polygon points="22,2 42,13 42,37 22,48 2,37 2,13"
          fill={color + '22'} stroke={color} strokeWidth={1.5} />
      </svg>
      <span style={{ position: 'relative', zIndex: 1, fontSize: size * 0.38, color }}>{children}</span>
    </div>
  );
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
      <span style={{ fontFamily: 'Oswald, sans-serif', fontSize: 11, color, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 2 }}>{title}</span>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible' }}>
        {gridPolygons.map((pts, lvl) => <polygon key={lvl} points={pts} fill={lvl % 2 === 0 ? color + '08' : 'none'} stroke={color} strokeOpacity={0.15} strokeWidth={1} />)}
        {Array.from({ length: n }).map((_, i) => (
          <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos(angle(i))} y2={cy + r * Math.sin(angle(i))} stroke={color} strokeOpacity={0.25} strokeWidth={1} />
        ))}
        <polygon points={polygon} fill={color} fillOpacity={0.2} stroke={color} strokeWidth={2} strokeOpacity={1} />
        {dataPoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={4} fill={color} stroke="#1a2535" strokeWidth={1} />)}
        {Array.from({ length: n }).map((_, i) => {
          const lx = cx + (r + 22) * Math.cos(angle(i));
          const ly = cy + (r + 22) * Math.sin(angle(i));
          return (
            <text key={i} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
              fontSize={12} fill="#c8d8e8" fontFamily="Oswald, sans-serif" fontWeight="600" letterSpacing="1">
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
  const size = 300, cx = 150, cy = 150, r = 80, n = 6, levels = RANKS.length;
  const angle = useCallback((i) => (Math.PI * 2 * i) / n - Math.PI / 2, [n]);
  const dataPoints = useMemo(() => HATSU_BRANCHES.map((b, i) => {
    let rank = b.key === pendingKey && pendingNext ? pendingNext : (hatsu?.[b.key] || 'E');
    const ratio = rank === '✖' ? 0 : (RANK_RATIO[rank] ?? (1 / RANKS.length));
    return { x: cx + r * ratio * Math.cos(angle(i)), y: cy + r * ratio * Math.sin(angle(i)) };
  }), [hatsu, angle, pendingKey, pendingNext]);

  const polygon = dataPoints.map(p => `${p.x},${p.y}`).join(' ');
  const activeIdx = HATSU_BRANCHES.findIndex(b => b.nenType === nenType);
  const pendingIdx = HATSU_BRANCHES.findIndex(b => b.key === pendingKey);
  const activeColor = NEN_COLORS[nenType] || '#7a8fa6';
  const pendingColor = '#ffd60a';

  const gridPolygons = useMemo(() =>
    Array.from({ length: levels }).map((_, lvl) =>
      Array.from({ length: n }).map((_, i) => {
        const ratio = (lvl + 1) / levels;
        return `${cx + r * ratio * Math.cos(angle(i))},${cy + r * ratio * Math.sin(angle(i))}`;
      }).join(' ')
    ), [n, angle]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
      <span style={{ fontFamily: 'Oswald, sans-serif', fontSize: 11, color: '#8aa0b8', letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>Affinités Hatsu</span>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible' }}>
        {gridPolygons.map((pts, lvl) => (
          <polygon key={lvl} points={pts} fill={lvl % 2 === 0 ? '#ffffff05' : 'none'} stroke="#ffffff" strokeOpacity={0.07} strokeWidth={1} />
        ))}
        {HATSU_BRANCHES.map((b, i) => {
          const isActive = i === activeIdx, isPending = i === pendingIdx;
          return <line key={i} x1={cx} y1={cy}
            x2={cx + r * Math.cos(angle(i))} y2={cy + r * Math.sin(angle(i))}
            stroke={isPending ? pendingColor : isActive ? activeColor : '#ffffff'}
            strokeOpacity={isPending ? 0.8 : isActive ? 0.4 : 0.1}
            strokeWidth={isPending ? 2 : isActive ? 1.5 : 1} />;
        })}
        <polygon points={polygon} fill="#ffffff" fillOpacity={0.04} stroke="#ffffff" strokeWidth={1} strokeOpacity={0.2} />
        {pendingIdx >= 0 && (() => {
          const p = dataPoints[pendingIdx];
          return <>
            <line x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={pendingColor} strokeWidth={3} strokeOpacity={0.9} strokeDasharray="5,4" />
            <circle cx={p.x} cy={p.y} r={9} fill={pendingColor} fillOpacity={0.25} stroke={pendingColor} strokeWidth={2} />
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
          return <circle key={i} cx={p.x} cy={p.y} r={3} fill="#8aa0b8" fillOpacity={0.5} />;
        })}
        {HATSU_BRANCHES.map((b, i) => {
          const lx = cx + (r + 26) * Math.cos(angle(i));
          const ly = cy + (r + 26) * Math.sin(angle(i));
          const rank = b.key === pendingKey && pendingNext ? pendingNext : (hatsu?.[b.key] || 'E');
          const isActive = i === activeIdx, isPending = i === pendingIdx;
          const col = isPending ? pendingColor : (isActive ? activeColor : '#a0b8cc');
          const rankImg = RANK_IMAGES[rank];
          return (
            <g key={i}>
              <text x={lx} y={ly - 9} textAnchor="middle" dominantBaseline="middle"
                fontSize={11} fill={col} fontFamily="Oswald, sans-serif"
                opacity={isPending || isActive ? 1 : 0.75} fontWeight="600" letterSpacing="1">
                {b.label}
              </text>
              {rank === '✖' ? (
                <text x={lx} y={ly + 10} textAnchor="middle" dominantBaseline="middle"
                  fontSize={14} fill={col} fontFamily="monospace" fontWeight="bold">✖</text>
              ) : rankImg ? (
                <image href={rankImg} x={lx - 10} y={ly + 2} width={20} height={20} />
              ) : (
                <text x={lx} y={ly + 10} textAnchor="middle" dominantBaseline="middle"
                  fontSize={13} fill={col} fontFamily="Oswald, sans-serif" fontWeight="bold">{rank}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── NenBars ───────────────────────────────────────────────────────────
function NenBars({ mastery, reserve, points, color }) {
  const safeMastery = Math.min(Math.max(mastery || 0, 0), 10);
  const safePoints = Math.max(points || 0, 0);
  const maxPoints = Math.max(reserve || 0, safePoints, 1);
  const reserveRatio = Math.min((reserve || 0) / maxPoints, 1);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={T.label}>Maîtrise Nen</span>
        <span style={{ fontSize: 14, fontFamily: 'Oswald, sans-serif', color, fontWeight: '600' }}>{safeMastery} <span style={{ color: '#4a5a70', fontSize: 11 }}>/ 10</span></span>
      </div>
      <div style={{ display: 'flex', gap: 3, marginBottom: 14 }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} style={{
            flex: 1, height: 7, borderRadius: 2,
            background: i < safeMastery ? color : '#1e2d3d',
            boxShadow: i < safeMastery ? `0 0 6px ${color}80` : 'none',
            transition: 'all 0.2s',
          }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={T.label}>Réserve Nen</span>
        <span style={{ fontSize: 14, fontFamily: 'Oswald, sans-serif', color, fontWeight: '600' }}>
          {safePoints} <span style={{ color: '#4a5a70', fontSize: 11 }}>/ {maxPoints}</span>
        </span>
      </div>
      <div style={{ width: '100%', height: 8, borderRadius: 4, background: '#1e2d3d', overflow: 'hidden', marginBottom: 6, position: 'relative' }}>
        <div style={{ width: `${reserveRatio * 100}%`, height: '100%', background: `linear-gradient(90deg, ${color}88, ${color})`, transition: 'width 0.3s', boxShadow: `0 0 8px ${color}60` }} />
      </div>
      <div style={{ fontSize: 11, color: '#4a5a70', fontFamily: 'Rajdhani, sans-serif' }}>
        Réserve: <span style={{ color: '#8aa0b8' }}>{reserve || 0}</span>
      </div>
    </div>
  );
}

// ─── NenAbilitiesGrid ──────────────────────────────────────────────────
function NenAbilitiesGrid({ abilities, color }) {
  return (
    <div>
      <div style={T.sectionTitle}>Techniques de base</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {NEN_ABILITY_LIST.map(({ key, label }) => {
          const unlocked = abilities?.[key] === 1;
          return (
            <div key={key} style={{
              padding: '5px 13px',
              borderRadius: 3,
              border: `1px solid ${unlocked ? color + 'aa' : '#1e2d3d'}`,
              background: unlocked ? `${color}18` : '#0d1824',
              color: unlocked ? color : '#2a3a4a',
              fontSize: 11,
              fontFamily: 'Oswald, sans-serif',
              letterSpacing: 2,
              display: 'flex', alignItems: 'center', gap: 5,
              boxShadow: unlocked ? `0 0 8px ${color}30` : 'none',
            }}>
              <span style={{ fontSize: 7 }}>{unlocked ? '◆' : '◇'}</span>{label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── useHoldAction ─────────────────────────────────────────────────────
function useHoldAction(action, enabled, { initialDelay = 400, minInterval = 40, acceleration = 0.82 } = {}) {
  const timerRef = useRef(null);
  const repeatRef = useRef(null);
  const currentInterval = useRef(150);
  const actionRef = useRef(action);
  const enabledRef = useRef(enabled);
  actionRef.current = action;
  enabledRef.current = enabled;

  const stop = useCallback(() => {
    clearTimeout(timerRef.current); clearTimeout(repeatRef.current);
    timerRef.current = null; repeatRef.current = null; currentInterval.current = 150;
  }, []);

  const start = useCallback(() => {
    if (!enabledRef.current) return;
    actionRef.current();
    timerRef.current = setTimeout(function tick() {
      if (!enabledRef.current) { stop(); return; }
      actionRef.current();
      currentInterval.current = Math.max(minInterval, currentInterval.current * acceleration);
      repeatRef.current = setTimeout(tick, currentInterval.current);
    }, initialDelay);
  }, [initialDelay, minInterval, acceleration, stop]);

  useEffect(() => () => stop(), [stop]);
  return {
    onMouseDown: start, onMouseUp: stop, onMouseLeave: stop,
    onTouchStart: (e) => { e.preventDefault(); start(); }, onTouchEnd: stop,
  };
}

// ─── StatRow ───────────────────────────────────────────────────────────
function StatRow({ label, value, onInc, onDec, color, canInc, canDec, limitbreak }) {
  const STAT_MAX = 1200;
  const limitRatio = STAT_LIMIT / STAT_MAX;
  const statPercentage = Math.min((value / STAT_MAX) * 100, 100);
  const atLimit = !limitbreak && value >= STAT_LIMIT;
  const incHandlers = useHoldAction(onInc, canInc);
  const decHandlers = useHoldAction(onDec, canDec);
  const barColor = atLimit ? '#f72585' : color;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#8aa0b8', fontFamily: 'Oswald, sans-serif', letterSpacing: 2, width: 105, minWidth: 105, flexShrink: 0, textAlign: 'right' }}>{label.toUpperCase()}</div>
      <button className="hold-btn" {...(canDec ? decHandlers : {})} disabled={!canDec}
        style={{ width: 32, height: 32, padding: 0, background: canDec ? '#1a2535' : '#0d1824', border: `1px solid ${canDec ? color + '50' : '#1e2d3d'}`, color: canDec ? '#c8d8e8' : '#2a3a4a', borderRadius: 3, cursor: canDec ? 'pointer' : 'default', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}>−</button>
      <div style={{ width: 40, textAlign: 'center', fontSize: 16, fontWeight: 'bold', color: atLimit ? '#f72585' : '#e8f4ff', fontFamily: 'Oswald, sans-serif', flexShrink: 0 }}>{value}</div>
      <button className="hold-btn" {...(canInc ? incHandlers : {})} disabled={!canInc}
        style={{ width: 32, height: 32, padding: 0, background: canInc ? '#1a2535' : '#0d1824', border: `1px solid ${canInc ? color + '50' : '#1e2d3d'}`, color: canInc ? '#c8d8e8' : '#2a3a4a', borderRadius: 3, cursor: canInc ? 'pointer' : 'default', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}>+</button>
      <div style={{ flex: 1, height: 5, background: '#1a2535', borderRadius: 2, position: 'relative', minWidth: 40 }}>
        <div style={{ width: `${statPercentage}%`, height: '100%', background: `linear-gradient(90deg, ${barColor}88, ${barColor})`, borderRadius: 2, transition: 'width 0.2s', boxShadow: `0 0 6px ${barColor}50` }} />
        {!limitbreak && (
          <div style={{ position: 'absolute', left: `${limitRatio * 100}%`, top: -2, bottom: -2, width: 1.5, background: '#ff3060', borderRadius: 1 }} />
        )}
      </div>
    </div>
  );
}

// ─── Tabs ──────────────────────────────────────────────────────────────
const TABS = ['PROFIL', 'NEN', 'STATISTIQUES', 'TECHNIQUES'];

function TabBar({ active, onChange }) {
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid #1e2d3d', marginBottom: 0, background: '#0a1520' }}>
      {TABS.map(tab => (
        <button key={tab} onClick={() => onChange(tab)}
          className={`ac-tab${active === tab ? ' active' : ''}`}
          style={{
            flex: 1, padding: '10px 4px', background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'Oswald, sans-serif', fontSize: 11, letterSpacing: 2,
            color: active === tab ? 'var(--accent)' : '#3a5060',
            fontWeight: active === tab ? '600' : '400',
            transition: 'color 0.2s',
          }}>
          {tab}
        </button>
      ))}
    </div>
  );
}

// ─── APP ───────────────────────────────────────────────────────────────
export default function App() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [discordId, setDiscordId] = useState(null);
  const [activeTab, setActiveTab] = useState('PROFIL');
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
  const [dailyXp, setDailyXp] = useState(0);
  const [isWideScreen, setIsWideScreen] = useState(window.innerWidth >= 640);

  useEffect(() => {
    const handler = () => setIsWideScreen(window.innerWidth >= 640);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const loadTechniques = useCallback(async (id) => {
    setTechniquesLoading(true);
    try {
      const techs = await fetchTechniques(id);
      setProfile(prev => prev ? { ...prev, techniques: techs } : prev);
    } finally {
      setTechniquesLoading(false);
    }
  }, []);

  const hydrateFromRemote = useCallback(async (id, username) => {
    const data = await fetchProfile(id);
    setProfile(data);
    setLocalStats({ ...data.stats });
    setLocalReserve(data.nen_reserve ?? 0);
    setLoading(false);
    void loadTechniques(id);
  }, [loadTechniques]);

  const cacheKey = discordId ? `hxh_profile_${discordId}` : null;

  useEffect(() => {
    async function setup() {
      try {
        const sdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);
        await sdk.ready();
        const { code } = await sdk.commands.authorize({
          client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
          response_type: 'code',
          state: '',
          prompt: 'none',
          scope: ['identify', 'guilds'],
        });
        const res = await fetch('/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const { access_token } = await res.json();
        const auth = await sdk.commands.authenticate({ access_token });
        const user = auth.user;
        setDiscordId(user.id);

        let renderedFromCache = false;
        if (cacheKey) {
          try {
            const cached = safeSession.getItem(`hxh_profile_${user.id}`);
            if (cached) {
              const parsed = JSON.parse(cached);
              setProfile(parsed);
              setLocalStats({ ...parsed.stats });
              setLocalReserve(parsed.nen_reserve ?? 0);
              setLoading(false);
              renderedFromCache = true;
            }
          } catch {}
        }

        if (renderedFromCache) {
          void hydrateFromRemote(user.id, user.username).catch((err) => setError(err.message));
        } else {
          await hydrateFromRemote(user.id, user.username);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    setup();
  }, [hydrateFromRemote]);

  useEffect(() => {
    if (!cacheKey || !profile) return;
    safeSession.setItem(cacheKey, JSON.stringify(profile));
  }, [cacheKey, profile]);

  const nenColor = profile ? (NEN_COLORS[profile.nen_type] || '#7a8fa6') : '#7a8fa6';
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
      if (cur >= 1200) return prev;
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
    if (!discordId || saving || totalSpent <= 0) return;
    setSaving(true);
    try {
      await db.update('stats', localStats, { 'discord_id': `eq.${discordId}` });
      await db.update('players', { nen_reserve: localReserve }, { 'discord_id': `eq.${discordId}` });
      if (!isInfinitePoints) await db.update('players', { stat_points: pointsLeft }, { 'discord_id': `eq.${discordId}` });
      const updated = await fetchProfile(discordId);
      setProfile(prev => ({ ...updated, techniques: prev?.techniques ?? [] }));
      setLocalStats({ ...updated.stats });
      setLocalReserve(updated.nen_reserve ?? 0);
      void loadTechniques(discordId);
    } finally { setSaving(false); }
  };

  const upgradeAffinity = (key) => {
    if (!discordId || savingAffinity || (profile?.affinity_points ?? 0) <= 0) return;
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
    } finally { setSavingAffinity(false); }
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
    } finally { setSaving(false); }
  };

  const saveImage = async () => {
    const trimmed = newImageUrl.trim();
    if (!trimmed || !discordId) return;
    if (!isValidUrl(trimmed)) { setImageUrlError('URL invalide. Elle doit commencer par http:// ou https://'); return; }
    setImageUrlError('');
    await db.update('players', { char_image: trimmed }, { 'discord_id': `eq.${discordId}` });
    const updated = await fetchProfile(discordId);
    setProfile(prev => ({ ...updated, techniques: prev?.techniques ?? [] }));
    setImageEditMode(false);
    setNewImageUrl('');
    void loadTechniques(discordId);
  };

  if (loading) return (
    <div style={{ ...S.center, background: '#060f18' }}>
      <svg width={60} height={60} viewBox="0 0 60 60" style={{ animation: 'spin 2s linear infinite' }}>
        <polygon points="30,4 56,18 56,42 30,56 4,42 4,18" fill="none" stroke={nenColor} strokeWidth={1.5} />
        <polygon points="30,12 48,22 48,38 30,48 12,38 12,22" fill="none" stroke={nenColor} strokeWidth={1} strokeOpacity={0.4} />
      </svg>
      <p style={{ color: '#4a7090', fontFamily: 'Oswald, sans-serif', letterSpacing: 4, marginTop: 16, fontSize: 12 }}>CHARGEMENT...</p>
    </div>
  );

  if (error) return (
    <div style={S.center}>
      <p style={{ color: '#f72585', fontFamily: 'Oswald, sans-serif', letterSpacing: 2 }}>ERREUR — {error}</p>
    </div>
  );

  const physLabels = ['FORCE', 'VITESSE', 'RÉS.', 'TECH.'];
  const physVals = [localStats.force ?? 1, localStats.vitesse ?? 1, localStats.resistance ?? 1, localStats.technique ?? 1];
  const hasChanges = totalSpent !== 0;

  // Rank stars derived from level
  const starValue = Math.min(Math.ceil((profile.level || 1) / 50), 5);

  return (
    <div style={{ ...S.root, '--accent': nenColor }}>
      {/* Animated background */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        background: `radial-gradient(ellipse at 70% 10%, ${nenColor}22 0%, transparent 55%),
                     radial-gradient(ellipse at 20% 80%, ${nenColor}0f 0%, transparent 45%),
                     linear-gradient(180deg, #060f18 0%, #0a1420 100%)`,
      }} />
      {/* Subtle grid overlay */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', opacity: 0.03,
        backgroundImage: 'linear-gradient(#4cc9f0 1px, transparent 1px), linear-gradient(90deg, #4cc9f0 1px, transparent 1px)',
        backgroundSize: '40px 40px',
      }} />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 640, margin: '0 auto', paddingBottom: 40 }}>

        {/* ── HEADER BAND ── */}
        <div style={{ background: 'linear-gradient(180deg, #0d1e2e 0%, #091420 100%)', borderBottom: '1px solid #1a2d40', padding: '10px 14px 0' }}>

          {/* Top info bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 28, height: 28, border: `1px solid ${nenColor}60`, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', background: nenColor + '15' }}>
                <svg width={14} height={14} viewBox="0 0 14 14">
                  <polygon points="7,1 13,4 13,10 7,13 1,10 1,4" fill="none" stroke={nenColor} strokeWidth={1.2} />
                </svg>
              </div>
              <span style={{ fontFamily: 'Oswald, sans-serif', fontSize: 11, color: '#4a7090', letterSpacing: 2 }}>HxH · GUILDE</span>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontFamily: 'Oswald, sans-serif', fontSize: 13, color: '#ffd60a', fontWeight: '600' }}>
                  {profile.jenny?.toLocaleString() ?? 0}
                </span>
                <span style={{ fontSize: 9, color: '#4a5a70', fontFamily: 'Oswald, sans-serif', letterSpacing: 1 }}>JENNY</span>
              </div>
            </div>
          </div>

          {/* Character info row */}
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 0 }}>
            {/* Portrait */}
            <div
              style={{ position: 'relative', width: 90, height: 115, flexShrink: 0, borderRadius: 4, overflow: 'hidden', border: `1px solid ${nenColor}50`, cursor: 'pointer', background: '#0d1824' }}
              onMouseEnter={() => setImageHover(true)}
              onMouseLeave={() => setImageHover(false)}
              onClick={() => setImageEditMode(true)}
            >
              {profile.char_image
                ? <img src={proxyImg(profile.char_image)} alt="perso" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36 }}>👤</div>}
              {imageHover && (
                <div style={{ position: 'absolute', inset: 0, background: '#00000090', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(2px)' }}>
                  <span style={{ fontSize: 18 }}>✏️</span>
                </div>
              )}
              {/* Corner accent */}
              <div style={{ position: 'absolute', top: 0, left: 0, width: 10, height: 10, borderTop: `2px solid ${nenColor}`, borderLeft: `2px solid ${nenColor}` }} />
              <div style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderBottom: `2px solid ${nenColor}`, borderRight: `2px solid ${nenColor}` }} />
            </div>

            {/* Name + stats */}
            <div style={{ flex: 1, paddingTop: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                <div>
                  {profile.char_surname && <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: 11, color: '#4a7090', letterSpacing: 3, textTransform: 'uppercase' }}>{profile.char_surname}</div>}
                  <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 22, fontWeight: '700', color: '#e8f4ff', letterSpacing: 1, lineHeight: 1.1 }}>
                    {profile.char_name || <span style={{ color: '#2a3a4a' }}>Sans nom</span>}
                  </div>
                </div>
                <StarRating value={starValue} max={5} color={nenColor} />
              </div>

              {/* Type badge */}
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 8,
                padding: '3px 10px', borderRadius: 2,
                border: `1px solid ${nenColor}60`, background: nenColor + '18',
                fontFamily: 'Oswald, sans-serif', fontSize: 11, letterSpacing: 2, color: nenColor,
              }}>
                <span style={{ fontSize: 7 }}>◆</span> {profile.nen_type}
              </div>

              {/* Level + XP */}
              {(() => {
                const lb = profile.limitbreak ?? false;
                const needed = xpRequired(profile.level, lb);
                const safeXp = Math.max(0, profile.xp ?? 0);
                const xpRatio = Math.min(safeXp / needed, 1);
                const isBlocked = !lb && profile.level >= LEVEL_CAP;
                const xpColor = isBlocked ? '#f72585' : lb ? '#ff6644' : nenColor;
                return (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontFamily: 'Oswald, sans-serif', fontSize: 11, color: '#4a7090', letterSpacing: 2 }}>
                        NIV. {profile.level}{lb ? ' ✦' : ''}
                        {isBlocked && <span style={{ color: '#f72585', marginLeft: 6, fontSize: 9 }}>BLOQUÉ</span>}
                      </span>
                      <span style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: 11, color: xpColor }}>
                        {safeXp} / {needed} XP
                      </span>
                    </div>
                    <div style={{ width: '100%', height: 4, background: '#1a2535', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
                      <div style={{ width: `${xpRatio * 100}%`, height: '100%', background: `linear-gradient(90deg, ${xpColor}88, ${xpColor})`, borderRadius: 2, boxShadow: `0 0 6px ${xpColor}60` }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                      <span style={{ fontSize: 10, color: '#2a4050', fontFamily: 'Rajdhani, sans-serif' }}>
                        XP AUJOURD'HUI: <span style={{ color: dailyXp >= DAILY_XP_CAP ? '#f72585' : '#4a7090' }}>{dailyXp}</span>/{DAILY_XP_CAP}
                      </span>
                      <span style={{ fontSize: 10, color: '#2a4050', fontFamily: 'Rajdhani, sans-serif' }}>
                        {profile.location || '—'}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Tabs */}
          <TabBar active={activeTab} onChange={setActiveTab} />
        </div>

        {/* ── TAB CONTENT ── */}
        <div style={{ padding: '14px 14px', minHeight: 300 }} className="ac-card">

          {/* PROFIL TAB */}
          {activeTab === 'PROFIL' && (
            <div>
              <div style={S.card}>
                <div style={T.sectionTitle}>Informations</div>
                <InfoRow icon="📍" label="Localisation" value={profile.location || 'Inconnue'} />
                <InfoRow icon="⭐" label="Réputation" value={profile.reputation ?? 0} />
                <InfoRow icon="🏅" label="Rang" value={profile.rank || '—'} color={nenColor} />
              </div>

              <button className="ac-btn" onClick={() => { setEditData({ char_name: profile.char_name, char_surname: profile.char_surname }); setEditing(true); }}
                style={{ ...S.acBtn, borderColor: nenColor + '70', color: nenColor, marginTop: 8, width: '100%' }}>
                ✦ MODIFIER LE PERSONNAGE
              </button>
            </div>
          )}

          {/* NEN TAB */}
          {activeTab === 'NEN' && (
            <div>
              <div style={S.card}>
                <NenBars mastery={profile.nen_mastery} reserve={profile.nen_reserve} points={profile.nen_points} color={nenColor} />
              </div>
              <div style={{ ...S.card, marginTop: 10 }}>
                <NenAbilitiesGrid abilities={profile.nen_abilities} color={nenColor} />
              </div>

              {/* Affinités Hatsu */}
              <div style={{ ...S.card, marginTop: 10 }}>
                <div style={{ display: 'flex', flexDirection: isWideScreen ? 'row' : 'column', gap: 16, alignItems: isWideScreen ? 'flex-start' : 'stretch' }}>
                  <div style={{ display: 'flex', justifyContent: 'center', width: isWideScreen ? 'auto' : '100%' }}>
                    <HatsuStar hatsu={profile.hatsu_affinities} nenType={profile.nen_type} pendingKey={pendingAffinity?.key} pendingNext={pendingAffinity?.next} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={T.sectionTitle}>Améliorer les affinités</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                      <span style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: 12, color: '#4a7090' }}>Points d'affinité:</span>
                      <span style={{ fontFamily: 'Oswald, sans-serif', color: '#ffd60a', fontWeight: '600', fontSize: 16 }}>{profile.affinity_points ?? 0}</span>
                    </div>
                    {!pendingAffinity ? (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        {HATSU_BRANCHES.map((b) => {
                          const rank = profile.hatsu_affinities?.[b.key] ?? 'E';
                          const blocked = rank === '✖' || rank === 'Z' || (profile.affinity_points ?? 0) <= 0 || savingAffinity;
                          const rankImg = RANK_IMAGES[rank];
                          const bColor = blocked ? '#1e2d3d' : nenColor;
                          return (
                            <button key={b.key} disabled={blocked} onClick={() => upgradeAffinity(b.key)} className="ac-btn"
                              style={{ background: '#0d1824', border: `1px solid ${blocked ? '#1a2535' : nenColor + '50'}`, borderRadius: 3, padding: '8px 10px', cursor: blocked ? 'default' : 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'Oswald, sans-serif', fontSize: 11, letterSpacing: 1, color: blocked ? '#2a3a4a' : nenColor, transition: 'all 0.15s' }}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                {b.label}
                                {rank === '✖' ? ' ✖' : rankImg ? <img src={rankImg} alt={rank} style={{ width: 16, height: 16 }} /> : ` ${rank}`}
                              </span>
                              <span style={{ fontSize: 10, opacity: 0.7 }}>{rank === '✖' ? '✖' : rank === 'Z' ? 'MAX' : '+1'}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div>
                        <div style={{ padding: '10px 12px', background: '#ffd60a0d', border: '1px solid #ffd60a30', borderRadius: 3, marginBottom: 10, fontSize: 12, color: '#ffd60a', fontFamily: 'Oswald, sans-serif', letterSpacing: 1 }}>
                          APERÇU: {HATSU_BRANCHES.find(b => b.key === pendingAffinity.key)?.label}
                          {RANK_IMAGES[pendingAffinity.current] && <img src={RANK_IMAGES[pendingAffinity.current]} alt="" style={{ width: 16, height: 16, marginLeft: 6, verticalAlign: 'middle' }} />}
                          {' → '}
                          {RANK_IMAGES[pendingAffinity.next] && <img src={RANK_IMAGES[pendingAffinity.next]} alt="" style={{ width: 16, height: 16, marginLeft: 4, verticalAlign: 'middle' }} />}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={confirmAffinity} disabled={savingAffinity} className="ac-btn"
                            style={{ ...S.acBtn, flex: 1, borderColor: '#ffd60a', color: '#ffd60a' }}>
                            {savingAffinity ? '...' : '✦ CONFIRMER'}
                          </button>
                          <button onClick={cancelAffinity} disabled={savingAffinity} className="ac-btn"
                            style={{ ...S.acBtn, flex: 1, borderColor: '#1e2d3d', color: '#3a5060' }}>ANNULER</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STATISTIQUES TAB */}
          {activeTab === 'STATISTIQUES' && (
            <div>
              {/* Points bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#0d1824', border: '1px solid #1a2d40', borderRadius: 4, marginBottom: 12 }}>
                <span style={{ fontFamily: 'Oswald, sans-serif', fontSize: 11, color: '#4a7090', letterSpacing: 2 }}>POINTS DISPONIBLES</span>
                <span style={{ fontFamily: 'Oswald, sans-serif', fontSize: 20, fontWeight: '700', color: pointsLeft > 0 ? '#ffd60a' : '#2a3a4a' }}>
                  {isInfinitePoints ? '∞' : pointsLeft}
                </span>
              </div>

              <div style={{ ...S.card, flexDirection: isWideScreen ? 'row' : 'column', alignItems: isWideScreen ? 'flex-start' : 'stretch', gap: isWideScreen ? 18 : 0 }}>
                <div style={{ display: 'flex', justifyContent: 'center', width: isWideScreen ? 280 : '100%', flexShrink: 0 }}>
                  <RadarChart labels={physLabels} values={physVals} color="#e85d04" title="Physique" />
                </div>
                <div style={{ marginTop: isWideScreen ? 0 : 12, flex: 1 }}>
                  {[['force', 'Force'], ['vitesse', 'Vitesse'], ['resistance', 'Résistance'], ['technique', 'Technique']].map(([k, l]) => (
                    <StatRow key={k} label={l} value={localStats[k] || MIN_STAT}
                      onInc={() => incStat(k)} onDec={() => decStat(k)} color="#e85d04"
                      canInc={(isInfinitePoints || pointsLeft > 0) && (profile?.limitbreak || (localStats[k] || MIN_STAT) < STAT_LIMIT)}
                      canDec={(localStats[k] || MIN_STAT) > (profile?.stats?.[k] ?? MIN_STAT)}
                      limitbreak={profile?.limitbreak ?? false} />
                  ))}
                  <StatRow label="Réserve Nen" value={localReserve || 0}
                    onInc={incReserve} onDec={decReserve} color="#4cc9f0"
                    canInc={(isInfinitePoints || pointsLeft > 0) && (profile?.limitbreak || (localReserve || 0) < STAT_LIMIT)}
                    canDec={(localReserve || 0) > (profile?.nen_reserve ?? 0)}
                    limitbreak={profile?.limitbreak ?? false} />
                </div>
              </div>

              {hasChanges && (
                <button onClick={saveStats} disabled={saving} className="ac-btn"
                  style={{ ...S.acBtn, width: '100%', marginTop: 12, borderColor: '#ffd60a', color: '#ffd60a', background: '#ffd60a0d', padding: '12px', fontSize: 12, letterSpacing: 3 }}>
                  {saving ? 'SAUVEGARDE...' : '✦ CONFIRMER LA RÉPARTITION'}
                </button>
              )}
            </div>
          )}

          {/* TECHNIQUES TAB */}
          {activeTab === 'TECHNIQUES' && (
            <div>
              {techniquesLoading ? (
                <div style={{ color: '#2a3a4a', fontSize: 12, fontFamily: 'Oswald, sans-serif', letterSpacing: 2, textAlign: 'center', padding: 30 }}>CHARGEMENT...</div>
              ) : profile.techniques?.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {profile.techniques.map(t => (
                    <div key={t.id} style={{ padding: '12px 14px', background: '#0d1824', border: `1px solid ${nenColor}30`, borderRadius: 4, borderLeft: `3px solid ${nenColor}` }}>
                      <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 14, color: '#e8f4ff', letterSpacing: 1 }}>{t.name}</div>
                      {t.description && <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: 12, color: '#4a7090', marginTop: 4 }}>{t.description}</div>}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: '#2a3a4a', fontSize: 12, fontFamily: 'Oswald, sans-serif', letterSpacing: 2, textAlign: 'center', padding: '40px 0' }}>
                  AUCUNE TECHNIQUE
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* MODAL PERSONNAGE */}
      {editing && (
        <div style={S.modalBg} onClick={() => setEditing(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={T.modalTitle}>MODIFIER LE PERSONNAGE</div>
            <label style={T.label}>PRÉNOM</label>
            <input style={S.input} value={editData.char_name || ''} onChange={e => setEditData(p => ({ ...p, char_name: e.target.value }))} placeholder="Prénom" />
            <label style={T.label}>NOM</label>
            <input style={S.input} value={editData.char_surname || ''} onChange={e => setEditData(p => ({ ...p, char_surname: e.target.value }))} placeholder="Nom de famille" />
            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button onClick={() => setEditing(false)} className="ac-btn" style={{ ...S.acBtn, flex: 1, borderColor: '#1e2d3d', color: '#3a5060' }}>ANNULER</button>
              <button onClick={saveCharacter} disabled={saving} className="ac-btn" style={{ ...S.acBtn, flex: 1, borderColor: nenColor + '80', color: nenColor }}>
                {saving ? '...' : 'SAUVEGARDER'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL IMAGE */}
      {imageEditMode && (
        <div style={S.modalBg} onClick={() => { setImageEditMode(false); setImageUrlError(''); }}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={T.modalTitle}>IMAGE DU PERSONNAGE</div>
            <label style={T.label}>URL DE L'IMAGE</label>
            <input
              style={{ ...S.input, borderColor: imageUrlError ? '#f72585' : '#1e2d3d' }}
              value={newImageUrl}
              onChange={e => { setNewImageUrl(e.target.value); setImageUrlError(''); }}
              placeholder="https://..."
              autoFocus
            />
            {imageUrlError && <div style={{ color: '#f72585', fontSize: 11, marginTop: 5, fontFamily: 'Rajdhani, sans-serif' }}>{imageUrlError}</div>}
            {newImageUrl.trim() && !imageUrlError && (
              <img src={proxyImg(newImageUrl.trim())} alt="preview"
                style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 3, marginTop: 10, border: '1px solid #1e2d3d' }}
                onError={e => { e.target.style.display = 'none'; }} />
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={() => { setImageEditMode(false); setNewImageUrl(''); setImageUrlError(''); }} className="ac-btn" style={{ ...S.acBtn, flex: 1, borderColor: '#1e2d3d', color: '#3a5060' }}>ANNULER</button>
              <button onClick={saveImage} className="ac-btn" style={{ ...S.acBtn, flex: 1, borderColor: nenColor + '80', color: nenColor }}>CONFIRMER</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Info Row ──────────────────────────────────────────────────────────
function InfoRow({ icon, label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #0d1824' }}>
      <span style={{ fontFamily: 'Oswald, sans-serif', fontSize: 11, color: '#4a7090', letterSpacing: 2 }}>{icon} {label.toUpperCase()}</span>
      <span style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: 13, color: color || '#8aa0b8', fontWeight: '600' }}>{value}</span>
    </div>
  );
}

// ─── STYLES ────────────────────────────────────────────────────────────
const S = {
  root: { minHeight: '100vh', background: '#060f18', color: '#e8f4ff', fontFamily: 'Rajdhani, sans-serif', position: 'relative', overflow: 'hidden' },
  center: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#060f18' },
  card: { padding: '14px 14px', background: '#0d1824', border: '1px solid #1a2d40', borderRadius: 4, display: 'flex', flexDirection: 'column' },
  acBtn: { background: 'transparent', border: '1px solid', borderRadius: 3, padding: '8px 16px', cursor: 'pointer', fontFamily: 'Oswald, sans-serif', letterSpacing: 2, fontSize: 11, transition: 'all 0.15s' },
  modalBg: { position: 'fixed', inset: 0, background: '#000000c0', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, backdropFilter: 'blur(6px)' },
  modal: { background: '#0a1520', border: '1px solid #1e2d3d', borderRadius: 5, padding: '22px', width: '88%', maxWidth: 340, position: 'relative' },
  input: { width: '100%', background: '#060f18', border: '1px solid', borderRadius: 3, padding: '9px 12px', color: '#e8f4ff', fontFamily: 'Rajdhani, sans-serif', fontSize: 13, boxSizing: 'border-box', outline: 'none' },
};

const T = {
  sectionTitle: { fontFamily: 'Oswald, sans-serif', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', color: '#4a7090', marginBottom: 8 },
  label: { display: 'block', fontFamily: 'Oswald, sans-serif', fontSize: 10, color: '#3a5060', letterSpacing: 2, marginBottom: 5, marginTop: 12, textTransform: 'uppercase' },
  modalTitle: { fontFamily: 'Oswald, sans-serif', fontSize: 14, letterSpacing: 3, color: '#8aa0b8', marginBottom: 4 },
};