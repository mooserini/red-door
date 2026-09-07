export interface State {
  name: string;
  location: string;
  health: number;
  inventory: string[];
  flags: string[];
  visits: number;
  last_scene: string;
}

const TAVERN = 'Ara wipes a glass that remembers rain. Narm is arguing with the fire again.';
export function initialState(handle: string): State {
  return { name: handle, location: 'tavern', health: 100, inventory: [], flags: [], visits: 0, last_scene: TAVERN };
}

export function advance(current: State, command: string): State {
  const state = structuredClone(current);
  switch (command) {
    case 'tavern': case 'home':
      state.location = 'tavern'; state.last_scene = TAVERN; break;
    case 'woods': case 'forest':
      state.location = 'woods_edge';
      state.last_scene = 'The trees lean inward. A blue lantern flickers far off the path.'; break;
    case 'explore': case 'deeper':
      state.location = 'woods';
      if (!state.inventory.includes('tarnished coin') && crypto.getRandomValues(new Uint32Array(1))[0] < 0xc0000000) {
        state.inventory.push('tarnished coin');
        state.last_scene = 'You find a tarnished coin beneath a root. It is warm.';
      } else state.last_scene = 'You find wet leaves, old tracks, and the sensation of being expected.';
      break;
    case 'search': case 'look':
      if (state.location === 'tavern') state.last_scene = 'Narm says, “Search the woods. The tavern has already given up its secrets.”';
      else {
        state.visits++;
        if (!state.inventory.includes('lost shoe') && state.visits % 2 === 0) {
          state.inventory.push('lost shoe');
          state.last_scene = 'You find one excellent lost shoe. Its previous owner remains a mystery.';
        } else state.last_scene = 'You search the undergrowth. Something searches back, but lacks paperwork.';
      }
      break;
    case 'rest': case 'sleep':
      state.location = 'tavern'; state.health = 100;
      state.last_scene = 'You take the room upstairs. Rain taps the window like an old password.'; break;
    case 'drink': case 'ale':
      state.location = 'tavern';
      state.last_scene = 'The barkeep serves something warm, brown, and legally deniable. For a moment, the fire shows you a door in the woods.'; break;
    default: throw new Error('invalid_command');
  }
  return state;
}
