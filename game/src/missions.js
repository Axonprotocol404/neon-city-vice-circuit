// Mission chain for "Neon City: Vice Circuit". Six chained story missions:
// courier run, chase, delivery, heist, escape, and a final showdown. Each has
// an objective position, marker on the minimap, reward money and short
// text-dialog lines shown in the HUD.
import { CITY, MISSION, WORLD } from './config.js';

/** Story text (all original characters and places). */
const SCRIPT = {
  intro: [
    { who: 'MARLA', text: 'You made it to Neon Verge. The city eats strangers — try not to be dinner.' },
    { who: 'MARLA', text: 'First job: a sealed case, midnight drop at the Crimson Docks. Drive it there.' },
  ],
  chase: [
    { who: 'MARLA', text: 'The Kestrel Crew saw your face. Lose the tail or end it.' },
    { who: 'KESTREL', text: 'That case is ours, courier!' },
  ],
  delivery: [
    { who: 'MARLA', text: 'The case is wired to a timer now. Glassrow Exchange, before the clock dies.' },
    { who: 'VOSS', text: 'I paid for silence, not sirens. Deliver it clean.' },
  ],
  heist: [
    { who: 'MARLA', text: 'Time to pay you back: the Meridian Vault, Sable Park. Six minutes inside and out.' },
    { who: 'VOSS', text: 'An inside man left the freight door open. Do not make me regret it.' },
  ],
  escape: [
    { who: 'MARLA', text: 'The alarm sang the second you touched the vault. Outrun the whole precinct to Voltrow.' },
  ],
  showdown: [
    { who: 'MARLA', text: 'Voss put a price on both of us. End this at the Hallowdome.' },
    { who: 'VOSS', text: 'Neon burns out, courier. So will you.' },
  ],
  outro: [
    { who: 'MARLA', text: 'The Circuit is yours now. Neon City never sleeps — neither do its debts.' },
  ],
};

/**
 * Mission definitions. `pos` is the world target, `kind` tells main.js what
 * interaction completes it: reach, drive-to, survive, destroy.
 */
export function missionList(city) {
  const roads = city.roads;
  const at = (i, j) => ({ x: roads[i % roads.length] + CITY.laneOffset + 40, y: roads[j % roads.length] + CITY.laneOffset + 40 });
  return [
    {
      id: 'courier', title: 'Midnight Courier', kind: 'reach', pos: at(7, 6),
      dialog: SCRIPT.intro, reward: MISSION.reward[0],
      brief: 'Take the case to the Crimson Docks drop.',
      time: 150,
    },
    {
      id: 'chase', title: 'Kestrel Tail', kind: 'survive', pos: at(4, 2),
      dialog: SCRIPT.chase, reward: MISSION.reward[1],
      brief: 'Lose your tail: stay free for 40 seconds (wanted level will rise).',
      time: 40, raiseWanted: 2,
    },
    {
      id: 'delivery', title: 'Hot Cargo', kind: 'reach', pos: at(2, 4),
      dialog: SCRIPT.delivery, reward: MISSION.reward[2],
      brief: 'Deliver the wired case to the Meridian Exchange before the timer dies.',
      time: 120,
    },
    {
      id: 'heist', title: 'The Meridian Vault', kind: 'reach', pos: at(2, 2),
      dialog: SCRIPT.heist, reward: MISSION.reward[3],
      brief: 'Get to the vault door in Sable Park.',
      time: 90,
    },
    {
      id: 'escape', title: 'Circuit Break', kind: 'survive', pos: at(3, 1),
      dialog: SCRIPT.escape, reward: MISSION.reward[4],
      brief: 'Escape the precinct sweep: reach Voltrow Heights with heat 3+ for 60 s.',
      time: 60, raiseWanted: 3,
    },
    {
      id: 'showdown', title: 'Hallowdome Reckoning', kind: 'reach', pos: at(6, 6),
      dialog: SCRIPT.showdown, reward: MISSION.reward[5],
      brief: 'Confront Voss at the Hallowdome. Keep the engine warm.',
      time: 120,
    },
  ];
}

export function createMissions(city) {
  const list = missionList(city);
  return {
    city,
    list,
    index: 0,          // which mission is active (list.length = all done)
    state: 'idle',     // idle -> active -> done
    timer: 0,          // mission countdown (0 = none)
    dialogQueue: [],
    dialogLine: 0,
    dialogTimer: 0,
    surviveProgress: 0,
    completed: [],
  };
}

export function currentMission(m) {
  return m.index < m.list.length ? m.list[m.index] : null;
}

/** Begin the next mission; shows its dialog lines. */
export function startMission(m, player) {
  const def = currentMission(m);
  if (!def) return null;
  m.state = 'active';
  m.timer = def.time;
  m.surviveProgress = 0;
  m.dialogQueue = def.dialog.slice();
  m.dialogLine = 0;
  m.dialogTimer = 4.2;
  if (def.raiseWanted) player.wanted = Math.max(player.wanted, def.raiseWanted);
  return def;
}

/** Called every step while a mission is active. Returns events. */
export function updateMissions(m, player, dt, events) {
  // Dialog playback: one line at a time, ~4 s each.
  if (m.dialogQueue.length) {
    m.dialogTimer -= dt;
    if (m.dialogTimer <= 0) {
      m.dialogQueue.shift();
      m.dialogLine += 1;
      m.dialogTimer = 4.2;
    }
  }

  const def = currentMission(m);
  if (!def || m.state !== 'active') return;

  if (m.timer > 0) {
    m.timer -= dt;
    if (m.timer <= 0) {
      // Timeout: mission failed, restart it (progress not lost).
      m.state = 'idle';
      events.push({ type: 'missionFail', id: def.id });
      return;
    }
  }

  const dist = Math.hypot(def.pos.x - player.x, def.pos.y - player.y);
  if (def.kind === 'reach' && dist < MISSION.markerRadius) {
    completeMission(m, player, def, events);
  } else if (def.kind === 'survive') {
    // Survive = simply stay alive under heat while the timer runs out.
    m.surviveProgress += dt;
    if (m.surviveProgress >= def.time) {
      completeMission(m, player, def, events);
    }
  }
}

function completeMission(m, player, def, events) {
  m.state = 'done';
  m.completed.push(def.id);
  player.money += def.reward;
  events.push({ type: 'missionComplete', id: def.id, reward: def.reward });
  m.index += 1;
  if (m.index >= m.list.length) {
    m.dialogQueue = SCRIPT.outro.slice();
    m.dialogTimer = 6;
    events.push({ type: 'storyEnd' });
  }
}

/** Advance the dialog manually (skip button). */
export function skipDialog(m) {
  if (m.dialogQueue.length) {
    m.dialogQueue.shift();
    m.dialogTimer = 4.2;
  }
}

/** Marker for the minimap: the active mission target. */
export function missionMarker(m) {
  const def = currentMission(m);
  return def && m.state === 'active' ? def : null;
}

/** Save/load: mission progress and index. */
export function missionsSave(m) {
  return { index: m.index, completed: m.completed.slice() };
}

export function missionsLoad(m, data) {
  if (!data) return;
  if (Number.isInteger(data.index)) m.index = Math.max(0, Math.min(m.list.length, data.index));
  if (Array.isArray(data.completed)) m.completed = data.completed.slice();
  m.state = 'idle';
}
