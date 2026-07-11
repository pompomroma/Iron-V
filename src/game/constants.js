// All combat / feel tuning in one place.

export const ARENA = {
  RADIUS: 13.5,          // playable floor radius (fighters are clamped inside)
  FLOOR_SIZE: 90,        // visual ground plane size
};

export const FIGHTER = {
  HEIGHT: 2.06,
  BODY_RADIUS: 0.62,     // for pair separation
  MIN_SEPARATION: 1.42,  // fighters push apart below this distance

  WALK_SPEED: 4.1,       // strafe (A/D)
  FORWARD_SPEED: 4.6,    // approach (W)
  BACK_SPEED: 3.4,       // retreat (S)
  ACCEL: 34,             // ground acceleration
  FRICTION: 16,

  MAX_HP: 100,
  MAX_STAMINA: 100,
  MAX_GUARD: 100,
  MAX_ULT: 100,
};

export const LIGHT = {
  WINDUP: 0.20,          // telegraph: long enough to react-dodge, still snappy
  ACTIVE: 0.10,
  RECOVER: 0.22,
  DAMAGE: 4.5,
  RANGE: 2.65,           // center-to-center at contact
  STAMINA: 8,
  GUARD_DAMAGE: 11,
  CHIP: 0.5,             // hp damage through block
  HITSTUN: 0.26,
  KNOCKBACK: 2.6,
  LUNGE: 5.2,            // forward gap-closing speed during windup+active
  ULT_GAIN_DEAL: 4.0,
  ULT_GAIN_TAKE: 5.5,
};

export const HEAVY = {
  WINDUP: 0.42,          // big readable telegraph — dodge or counter it
  ACTIVE: 0.12,
  RECOVER: 0.40,
  DAMAGE: 11,
  RANGE: 2.95,
  STAMINA: 16,
  GUARD_DAMAGE: 34,
  CHIP: 1.5,
  HITSTUN: 0.46,
  KNOCKBACK: 5.4,
  LUNGE: 6.4,
  ULT_GAIN_DEAL: 9,
  ULT_GAIN_TAKE: 12,
};

export const FEINT = {
  STAMINA: 6,            // extra cost per switch (light->heavy or heavy->light)
  WINDUP_SCALE: 0.9,     // switched-into attack winds up slightly faster
  BLEND: 0.11,           // animation crossfade seconds for the switch
};

export const BLOCK = {
  GUARD_REGEN: 15,       // per second while not blocking
  GUARD_REGEN_DELAY: 0.9,
  BREAK_STUN: 1.65,      // stunned this long when guard shatters
  GUARD_AFTER_BREAK: 55, // guard meter restored to this after the stun
  STAMINA_REGEN_MULT: 0.55, // stamina regens slower while holding block
};

export const DASH = {
  DURATION: 0.32,
  SPEED: 13.5,           // initial burst, decays over duration
  IFRAMES: 0.22,         // invulnerable window from dash start
  STAMINA: 20,
  COOLDOWN: 0.42,
};

// Fraction of an attack's recover phase that can be cancelled into the next
// attack (or a dash) — lets punch strings flow continuously instead of
// bouncing through the idle pose between every swing.
export const CHAIN_WINDOW = 0.45;

export const STAMINA = {
  REGEN: 26,             // per second
  REGEN_DELAY: 0.65,     // after last spend
};

export const COUNTER = {
  MULT: 1.5,             // damage multiplier when hitting someone mid-windup
  SLOWMO: 0.35,          // brief timescale dip
  SLOWMO_TIME: 0.22,
};

export const ULT = {
  DAMAGE: 26,            // spread over the cinematic flurry + final blow
  RANGE: 4.2,            // must be roughly this close to connect
  WHIFF_REFUND: 55,      // meter refunded if used out of range
  DURATION: 5.2,         // cinematic length (real seconds)
};

export const ROUNDS = {
  TO_WIN: 3,             // first to N round wins takes the match
  KO_SLOWMO: 0.22,
  KO_SLOWMO_TIME: 1.5,   // real seconds of KO slow-mo
};

// Distinct, original color identities for the two fighters.
export const PALETTES = {
  P1: {
    name: 'VOLT',
    skin: 0xc98d5f,
    hair: 0x15181f,
    top: 0x11141c,
    topTrim: 0x27e6ff,
    shorts: 0x161a24,
    shortsTrim: 0x27e6ff,
    gloves: 0x0d2f38,
    gloveGlow: 0x2ee6ff,   // cyan
    boots: 0x0e1118,
    accent: 0x2ee6ff,
    trail: 0x59f2ff,
  },
  P2: {
    name: 'EMBER',
    skin: 0x8a5a3b,
    hair: 0x1a0f0f,
    top: 0x1c1114,
    topTrim: 0xff4d6d,
    shorts: 0x201318,
    shortsTrim: 0xff4d6d,
    gloves: 0x3a0d16,
    gloveGlow: 0xff4664,   // magenta-red
    boots: 0x140d10,
    accent: 0xff4664,
    trail: 0xff7a5c,
  },
};

export const AI_LEVELS = {
  easy:   { reaction: 0.42, blockProb: 0.28, evadeProb: 0.10, feintProb: 0.10, aggression: 0.45, comboMax: 2, thinkMin: 0.16, thinkMax: 0.30 },
  normal: { reaction: 0.27, blockProb: 0.50, evadeProb: 0.20, feintProb: 0.22, aggression: 0.70, comboMax: 3, thinkMin: 0.12, thinkMax: 0.22 },
  hard:   { reaction: 0.18, blockProb: 0.70, evadeProb: 0.32, feintProb: 0.35, aggression: 0.92, comboMax: 4, thinkMin: 0.08, thinkMax: 0.16 },
};
// Each round the player wins, AI sharpens slightly (applied multiplicatively).
export const AI_ROUND_RAMP = { reaction: 0.92, blockProb: 1.08, aggression: 1.06 };
