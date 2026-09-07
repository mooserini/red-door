"""Red Door commands run in the server process, independent of the terminal."""
import random

COMMANDS = "tavern, woods, explore, search, rest, drink"


def advance(state, command):
    if command in ('tavern', 'home'):
        state.update(location='tavern', last_scene='Ara wipes a glass that remembers rain. Narm is arguing with the fire again.')
    elif command in ('woods', 'forest'):
        state.update(location='woods_edge', last_scene='The trees lean inward. A blue lantern flickers far off the path.')
    elif command in ('explore', 'deeper'):
        state['location'] = 'woods'
        if 'tarnished coin' not in state['inventory'] and random.random() < .75:
            state['inventory'].append('tarnished coin')
            state['last_scene'] = 'You find a tarnished coin beneath a root. It is warm.'
        else:
            state['last_scene'] = 'You find wet leaves, old tracks, and the sensation of being expected.'
    elif command in ('search', 'look'):
        if state['location'] == 'tavern':
            state['last_scene'] = 'Narm says, “Search the woods. The tavern has already given up its secrets.”'
        else:
            state['visits'] += 1
            if 'lost shoe' not in state['inventory'] and state['visits'] % 2 == 0:
                state['inventory'].append('lost shoe')
                state['last_scene'] = 'You find one excellent lost shoe. Its previous owner remains a mystery.'
            else:
                state['last_scene'] = 'You search the undergrowth. Something searches back, but lacks paperwork.'
    elif command in ('rest', 'sleep'):
        state.update(location='tavern', health=100, last_scene='You take the room upstairs. Rain taps the window like an old password.')
    elif command in ('drink', 'ale'):
        state.update(location='tavern', last_scene='The barkeep serves something warm, brown, and legally deniable. For a moment, the fire shows you a door in the woods.')
    else:
        raise ValueError('Try ' + COMMANDS + '.')
    return state


def describe(receipt):
    state = receipt['state']
    places = {'tavern': 'The Old Tavern', 'woods_edge': 'Dark Woods edge', 'woods': 'The Dark Woods'}
    return '\r\n'.join([
        '\x1b[32;1m' + places.get(state['location'], state['location']) + '\x1b[0m',
        state['last_scene'], '',
        'Health: %s | Inventory: %s' % (state['health'], ', '.join(state['inventory']) or 'empty'),
        '\x1b[90mSaved on the Mac: revision %s | receipt %s\x1b[0m' % (receipt['revision'], receipt['receipt_hash'][:12]),
        '',
    ])
