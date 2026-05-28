/* global React */
// mascot.jsx — DogeOS marks. Geometric, no meme.

const { useEffect, useRef } = React;

// Compact logomark: a wedge "snout" forming a stylized D + ear notch.
// Pure primitives, no fancy paths.
function DogeMark({ size = 28, color = 'currentColor', goldColor = 'var(--gold)' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="2" y="6" width="28" height="22" rx="6" fill={color} opacity="0.14"/>
      {/* head */}
      <path d="M6 14 Q6 6 14 6 L22 6 Q26 6 26 10 L26 22 Q26 26 22 26 L11 26 Q6 26 6 22 Z" fill={color}/>
      {/* ear */}
      <path d="M22 6 L28 2 L26 12 Z" fill={color}/>
      {/* snout */}
      <rect x="13" y="16" width="11" height="7" rx="3" fill="var(--bg)" opacity="0.92"/>
      {/* eye */}
      <circle cx="13" cy="13" r="1.6" fill={goldColor}/>
      {/* nose */}
      <circle cx="22.5" cy="19" r="1.4" fill={goldColor}/>
    </svg>
  );
}

// Wordmark "DogeOS" with custom kerning
function Wordmark({ height = 18, color = 'currentColor' }) {
  return (
    <span style={{
      fontFamily: 'var(--font-display)',
      fontWeight: 700,
      fontSize: height,
      letterSpacing: 0,
      color,
      lineHeight: 1,
      display: 'inline-flex',
      alignItems: 'baseline',
      gap: 0,
    }}>
      <span>Doge</span>
      <span style={{ color: 'var(--primary)' }}>OS</span>
    </span>
  );
}

function Logo({ size = 24, height = 17, showWord = true, color = 'currentColor' }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <DogeMark size={size} color={color}/>
      {showWord ? <Wordmark height={height} color={color}/> : null}
    </span>
  );
}

// Big sitting doge — used for empty/loading states. Still geometric, built
// from primitives. About 220×220.
function DogeMascot({ size = 200, mood = 'idle' }) {
  // moods: idle, sniff, thinking, success, sad, sleep
  const moodEyes = {
    idle:     { ly: 0,  ry: 0,  closed: false },
    sniff:    { ly: 0,  ry: 0,  closed: false },
    thinking: { ly: -1, ry: -1, closed: false },
    success:  { ly: -2, ry: -2, closed: false },
    sad:      { ly: 2,  ry: 2,  closed: false },
    sleep:    { ly: 0,  ry: 0,  closed: true },
  }[mood] || { ly:0, ry:0, closed:false };

  const tongue = mood === 'sniff' || mood === 'success';
  const z = mood === 'sleep';

  return (
    <svg width={size} height={size} viewBox="0 0 220 220" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="bodyFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"  stopColor="oklch(0.74 0.16 65)"/>
          <stop offset="100%" stopColor="oklch(0.58 0.16 50)"/>
        </linearGradient>
        <linearGradient id="bellyFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"  stopColor="oklch(0.92 0.05 80)"/>
          <stop offset="100%" stopColor="oklch(0.84 0.07 75)"/>
        </linearGradient>
      </defs>

      {/* ground shadow */}
      <ellipse cx="110" cy="200" rx="62" ry="6" fill="oklch(0 0 0 / 0.35)"/>

      {/* tail */}
      <path d="M 170 150 Q 196 132 192 108 Q 188 92 174 100" stroke="url(#bodyFill)" strokeWidth="16" strokeLinecap="round" fill="none"/>

      {/* haunch / body */}
      <ellipse cx="110" cy="150" rx="62" ry="50" fill="url(#bodyFill)"/>
      {/* belly */}
      <ellipse cx="110" cy="168" rx="40" ry="28" fill="url(#bellyFill)"/>

      {/* front paws */}
      <rect x="80"  y="170" width="18" height="28" rx="8" fill="url(#bellyFill)"/>
      <rect x="122" y="170" width="18" height="28" rx="8" fill="url(#bellyFill)"/>

      {/* head */}
      <ellipse cx="110" cy="92" rx="54" ry="46" fill="url(#bodyFill)"/>
      {/* ears (triangles) */}
      <path d="M 64 56 L 56 24 L 88 50 Z" fill="url(#bodyFill)"/>
      <path d="M 156 56 L 164 24 L 132 50 Z" fill="url(#bodyFill)"/>
      <path d="M 70 50 L 68 36 L 82 50 Z" fill="oklch(0.45 0.12 40)"/>
      <path d="M 150 50 L 152 36 L 138 50 Z" fill="oklch(0.45 0.12 40)"/>

      {/* face mask (lighter cream around snout) */}
      <ellipse cx="110" cy="108" rx="36" ry="26" fill="url(#bellyFill)"/>

      {/* eyes */}
      {moodEyes.closed ? (
        <>
          <path d="M 90 92 q 6 4 12 0" stroke="oklch(0.2 0.02 60)" strokeWidth="3" strokeLinecap="round" fill="none"/>
          <path d="M 118 92 q 6 4 12 0" stroke="oklch(0.2 0.02 60)" strokeWidth="3" strokeLinecap="round" fill="none"/>
        </>
      ) : (
        <>
          <circle cx="96" cy={88 + moodEyes.ly}  r="4" fill="oklch(0.15 0.02 60)"/>
          <circle cx="124" cy={88 + moodEyes.ry} r="4" fill="oklch(0.15 0.02 60)"/>
          <circle cx="97" cy={87 + moodEyes.ly} r="1.2" fill="white"/>
          <circle cx="125" cy={87 + moodEyes.ry} r="1.2" fill="white"/>
        </>
      )}

      {/* nose */}
      <ellipse cx="110" cy="108" rx="5" ry="4" fill="oklch(0.18 0.02 60)"/>
      {/* mouth */}
      <path d="M 110 112 L 110 118 Q 110 122 105 122 M 110 118 Q 110 122 115 122" stroke="oklch(0.2 0.02 60)" strokeWidth="2" strokeLinecap="round" fill="none"/>

      {/* tongue */}
      {tongue && (
        <path d="M 108 120 Q 110 130 113 130 Q 116 130 116 122 Z" fill="oklch(0.72 0.16 25)"/>
      )}

      {/* sleep Z */}
      {z && (
        <g fontFamily="var(--font-mono)" fill="oklch(0.84 0.012 75)" fontSize="14" fontWeight="600">
          <text x="156" y="56" opacity="0.9">z</text>
          <text x="170" y="40" opacity="0.6">z</text>
          <text x="180" y="26" opacity="0.35">z</text>
        </g>
      )}
    </svg>
  );
}

// Minimal silhouette mascot — used as background flourish, no face
function DogeSilhouette({ size = 180, color = 'currentColor', opacity = 0.10 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 220 220" fill="none" aria-hidden="true" style={{ opacity }}>
      <ellipse cx="110" cy="150" rx="62" ry="50" fill={color}/>
      <ellipse cx="110" cy="92" rx="54" ry="46" fill={color}/>
      <path d="M 64 56 L 56 24 L 88 50 Z" fill={color}/>
      <path d="M 156 56 L 164 24 L 132 50 Z" fill={color}/>
      <path d="M 170 150 Q 196 132 192 108 Q 188 92 174 100" stroke={color} strokeWidth="16" strokeLinecap="round" fill="none"/>
    </svg>
  );
}

Object.assign(window, { DogeMark, Wordmark, Logo, DogeMascot, DogeSilhouette });
