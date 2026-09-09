export interface State {
  name: string;
  location: string;
  health: number;
  inventory: string[];
  itemTypes?: Record<string, 'food' | 'drink'>;
  copper?: number;
  flags: string[];
  visits: number;
  last_scene: string;
}

export function purchase(current: State, item: string, price: number, kind: 'food' | 'drink' | 'other' = 'other'): State {
  const balance = current.copper ?? 0;
  if (current.location !== 'tavern') throw new Error('Return to the tavern before buying.');
  if (!Number.isSafeInteger(balance) || balance < price) throw new Error('Not enough copper. Nothing was spent.');
  if (current.inventory.length >= 40) throw new Error('Your pack is full. Nothing was spent.');
  const state = structuredClone(current);
  const key = item.toLowerCase();
  const priorKind = Object.hasOwn(state.itemTypes ?? {}, key) ? state.itemTypes![key] : undefined;
  if (state.inventory.some(label => label.toLowerCase() === key) && (priorKind ?? 'other') !== kind)
    throw new Error('An item with that name already has a different type. Ask for a different offer.');
  if (kind !== 'other') { state.itemTypes ??= {}; state.itemTypes[key] = kind; }
  state.copper = balance - price;
  state.inventory.push(item);
  state.last_scene = `Ara hands you ${item}. Paid ${price} copper. Your purse holds ${state.copper} copper.`;
  return state;
}

const TAVERN = 'Ara wipes a glass that remembers rain. Narm is arguing with the fire again.';
export function initialState(handle: string): State {
  return { name: handle, location: 'tavern', health: 100, inventory: [], flags: [], visits: 0, last_scene: TAVERN };
}

export function advance(current: State, command: string): State {
  const state = structuredClone(current);
  const match = /^(drink|eat|use|ale)(?:\s+(.*))?$/.exec(command);
  if (match) {
    const action = match[1] === 'ale' ? 'drink' : match[1];
    const requested = match[2]?.trim();
    if (!requested) throw new Error(`Use ${action} <item name> to consume one item from your inventory.`);
    const index = state.inventory.findIndex(label => label.toLowerCase() === requested);
    if (index < 0) throw new Error('You do not have that item. Nothing was consumed.');
    const item = state.inventory[index], key = item.toLowerCase();
    const kind = Object.hasOwn(state.itemTypes ?? {}, key) ? state.itemTypes![key] : undefined;
    if (!kind) throw new Error('That item has no supported use. Nothing was consumed.');
    if ((action === 'drink' && kind !== 'drink') || (action === 'eat' && kind !== 'food'))
      throw new Error(`You cannot ${action} ${item}. Try ${kind === 'drink' ? 'drink' : 'eat'} ${item}.`);
    state.inventory.splice(index, 1);
    if (!state.inventory.some(label => label.toLowerCase() === key)) delete state.itemTypes![key];
    state.last_scene = `You ${kind === 'drink' ? 'drink' : 'eat'} ${item}. One serving consumed.`;
    return state;
  }
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
    default: throw new Error('Try tavern, woods, explore, search, rest, drink <item>, eat <item> or use <item>.');
  }
  return state;
}
